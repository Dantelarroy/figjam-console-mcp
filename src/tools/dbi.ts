import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FigJamBoardScan, FigJamNodeSummary } from "../figjam-api/figjamClient.js";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { fail, ok } from "../server/figjam-tooling.js";

type DBIEntityType = "artifact" | "container" | "connector";

interface DBIEntity {
	nodeId: string;
	entityType: DBIEntityType;
	nodeType: string;
	name: string;
	text?: string;
	alias?: string;
	containerId?: string;
	groupId?: string;
	parentId?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	updatedAt?: string;
	pluginData: Record<string, string>;
	connectorStart?: { endpointNodeId?: string; magnet?: string } | null;
	connectorEnd?: { endpointNodeId?: string; magnet?: string } | null;
}

interface DBIIndexSnapshot {
	fileKey: string | null;
	pageId: string;
	pageName: string;
	generatedAt: string;
	counts: {
		entities: number;
		artifacts: number;
		containers: number;
		connectors: number;
	};
	entities: DBIEntity[];
	aliases: Record<string, string>;
	collisions: Array<{ alias: string; nodeIds: string[] }>;
	source: "fresh" | "cache";
}

const indexInputSchema = {
	includeEntities: z.boolean().default(true),
};

const getBoardIndexInputSchema = {
	refresh: z.boolean().default(false),
	includeEntities: z.boolean().default(true),
};

const cache = new Map<string, DBIIndexSnapshot>();

function flattenNodes(nodes: FigJamNodeSummary[]): FigJamNodeSummary[] {
	const out: FigJamNodeSummary[] = [];
	const walk = (node: FigJamNodeSummary) => {
		out.push(node);
		if (Array.isArray(node.children)) {
			for (const child of node.children) walk(child);
		}
	};
	for (const node of nodes) walk(node);
	return out;
}

function classifyNodeType(type: string): DBIEntityType {
	if (type === "SECTION") return "container";
	if (type === "CONNECTOR") return "connector";
	return "artifact";
}

function keyForSnapshot(scan: FigJamBoardScan): string {
	const filePart = scan.fileKey || "no-file-key";
	return `${filePart}:${scan.pageId}`;
}

function sortEntities(entities: DBIEntity[]): DBIEntity[] {
	return [...entities].sort((a, b) => {
		const ay = typeof a.y === "number" ? a.y : Number.POSITIVE_INFINITY;
		const by = typeof b.y === "number" ? b.y : Number.POSITIVE_INFINITY;
		if (ay !== by) return ay - by;
		const ax = typeof a.x === "number" ? a.x : Number.POSITIVE_INFINITY;
		const bx = typeof b.x === "number" ? b.x : Number.POSITIVE_INFINITY;
		if (ax !== bx) return ax - bx;
		return a.nodeId.localeCompare(b.nodeId);
	});
}

function fromScan(scan: FigJamBoardScan, source: "fresh" | "cache"): DBIIndexSnapshot {
	const flat = flattenNodes(scan.nodes);
	const entities = sortEntities(
		flat.map((node) => {
			const pluginData = node.pluginData || {};
			const alias = pluginData["figjam.alias"] || undefined;
			const containerId = pluginData["figjam.containerId"] || undefined;
			const groupId = pluginData["figjam.groupId"] || undefined;
			const updatedAt = pluginData["figjam.updatedAt"] || undefined;
			return {
				nodeId: node.id,
				entityType: classifyNodeType(node.type),
				nodeType: node.type,
				name: node.name,
				text: node.text,
				alias,
				containerId,
				groupId,
				parentId: node.parentId,
				x: node.x,
				y: node.y,
				width: node.width,
				height: node.height,
				updatedAt,
				pluginData,
				connectorStart: node.connectorStart || null,
				connectorEnd: node.connectorEnd || null,
			};
		}),
	);

	const aliasMap: Record<string, string> = {};
	const aliasBuckets = new Map<string, string[]>();
	for (const entity of entities) {
		if (!entity.alias) continue;
		const key = entity.alias.trim();
		if (!key) continue;
		const bucket = aliasBuckets.get(key) || [];
		bucket.push(entity.nodeId);
		aliasBuckets.set(key, bucket);
	}
	for (const [alias, nodeIds] of aliasBuckets.entries()) {
		if (nodeIds.length === 1) {
			aliasMap[alias] = nodeIds[0];
		}
	}

	const collisions = [...aliasBuckets.entries()]
		.filter(([, nodeIds]) => nodeIds.length > 1)
		.map(([alias, nodeIds]) => ({ alias, nodeIds: [...nodeIds].sort() }))
		.sort((a, b) => a.alias.localeCompare(b.alias));

	const artifacts = entities.filter((e) => e.entityType === "artifact").length;
	const containers = entities.filter((e) => e.entityType === "container").length;
	const connectors = entities.filter((e) => e.entityType === "connector").length;

	return {
		fileKey: scan.fileKey,
		pageId: scan.pageId,
		pageName: scan.pageName,
		generatedAt: scan.generatedAt,
		counts: {
			entities: entities.length,
			artifacts,
			containers,
			connectors,
		},
		entities,
		aliases: aliasMap,
		collisions,
		source,
	};
}

function maybeStripEntities(snapshot: DBIIndexSnapshot, includeEntities: boolean) {
	if (includeEntities) return snapshot;
	return {
		...snapshot,
		entities: [],
	};
}

export function registerDBITools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"figjam_index_board",
		"Build a deterministic board index snapshot (artifacts, containers, connectors, aliases, metadata).",
		indexInputSchema,
		async ({ includeEntities }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const snapshot = fromScan(scan, "fresh");
				cache.set(keyForSnapshot(scan), snapshot);
				return ok({
					index: maybeStripEntities(snapshot, includeEntities),
				});
			} catch (error) {
				return fail(error, "Failed to build board index");
			}
		},
	);

	server.tool(
		"getBoardIndex",
		"Get cached deterministic board index. Set refresh=true to rebuild.",
		getBoardIndexInputSchema,
		async ({ refresh, includeEntities }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const cacheKey = keyForSnapshot(scan);
				const cached = cache.get(cacheKey);

				if (!refresh && cached) {
					return ok({
						index: maybeStripEntities({ ...cached, source: "cache" }, includeEntities),
					});
				}

				const snapshot = fromScan(scan, "fresh");
				cache.set(cacheKey, snapshot);
				return ok({
					index: maybeStripEntities(snapshot, includeEntities),
				});
			} catch (error) {
				return fail(error, "Failed to get board index");
			}
		},
	);
}

