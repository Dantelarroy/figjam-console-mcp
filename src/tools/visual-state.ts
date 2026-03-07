import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FigJamNodeSummary } from "../figjam-api/figjamClient.js";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { fail, ok } from "../server/figjam-tooling.js";
import { createLinkWithImageFallback } from "./link-fallback.js";
import {
	computeMeasuredColumnReflow,
	computeOverlapCount,
	computePlannedSlots,
} from "./research-layout-engine.js";
import { fallbackCardDimensions, resolveLayoutTokens, type UiPreset } from "./research-ui.js";

type FlatNode = FigJamNodeSummary & {
	alias?: string;
	role?: string;
	groupId?: string;
	containerId?: string;
	sourceUrl?: string;
	updatedAt?: string;
	runId?: string;
	itemKey?: string;
	metadata?: Record<string, unknown> | null;
};

type LinkPolicy =
	| "native_preferred"
	| "native_only"
	| "fallback_if_unfurl_fails"
	| "fallback_force_card"
	| "fallback_sticky"
	| "fallback_link_image";

const LINK_POLICY_VALUES: [LinkPolicy, ...LinkPolicy[]] = [
	"native_preferred",
	"native_only",
	"fallback_if_unfurl_fails",
	"fallback_force_card",
	"fallback_sticky",
	"fallback_link_image",
];

type DedupePolicy = "by_url" | "by_title" | "strict";
type LayoutPolicy = "auto_expand" | "strict";

function createRunId(): string {
	const rand = Math.random().toString(36).slice(2, 8);
	return `run-${Date.now().toString(36)}-${rand}`;
}

function normalizeTextValue(value?: string | null): string {
	return (value || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.slice(0, 240);
}

function itemKeyFromItem(
	item: { title: string; url?: string; groupId?: string },
	dedupePolicy: DedupePolicy,
): string {
	const title = normalizeTextValue(item.title);
	const url = normalizeTextValue(item.url);
	const theme = normalizeTextValue(item.groupId);
	if (dedupePolicy === "by_title") return `t:${title}`;
	if (dedupePolicy === "strict") return `u:${url}|t:${title}|g:${theme}`;
	return `u:${url || `t:${title}`}`;
}

function parseMetadata(raw?: string): Record<string, unknown> | null {
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
		return null;
	} catch {
		return null;
	}
}

function toLinkPolicyMode(policy: LinkPolicy): "native_only" | "fallback_sticky" | "fallback_link_image" {
	if (policy === "fallback_force_card" || policy === "fallback_link_image") return "fallback_link_image";
	if (policy === "fallback_sticky") return "fallback_sticky";
	if (policy === "native_only") return "native_only";
	return "fallback_link_image";
}

function estimateCardFootprint(input: { hasUrl: boolean; hasNote: boolean; linkPolicy: LinkPolicy; uiPreset: UiPreset }) {
	const denseTokens = resolveLayoutTokens(input.uiPreset);
	const fallback = fallbackCardDimensions(input.uiPreset);
	const base =
		!input.hasUrl
			? { width: input.uiPreset === "comfortable" ? 300 : 260, height: input.uiPreset === "comfortable" ? 220 : 200 }
			: input.linkPolicy === "fallback_force_card" || input.linkPolicy === "fallback_link_image"
				? { width: fallback.width, height: fallback.height }
				: input.uiPreset === "comfortable"
					? { width: 400, height: 280 }
					: { width: 360, height: 240 };
	return {
		width: base.width,
		height: base.height + (input.hasNote ? 200 + denseTokens.noteGap : 0),
	};
}

function inBbox(node: Pick<FlatNode, "x" | "y" | "width" | "height">, bbox: { x: number; y: number; width: number; height: number }): boolean {
	if (typeof node.x !== "number" || typeof node.y !== "number") return false;
	const width = typeof node.width === "number" ? node.width : 0;
	const height = typeof node.height === "number" ? node.height : 0;
	return (
		node.x <= bbox.x + bbox.width &&
		node.x + width >= bbox.x &&
		node.y <= bbox.y + bbox.height &&
		node.y + height >= bbox.y
	);
}

const renderReferenceCardInputSchema = {
	title: z.string().min(1).max(300),
	url: z.string().url().optional(),
	note: z.string().max(4000).optional(),
	x: z.number().default(0),
	y: z.number().default(0),
	alias: z.string().min(1).max(120).optional(),
	groupId: z.string().min(1).max(120).optional(),
	containerId: z.string().min(1).max(120).optional(),
	runId: z.string().min(1).max(120).optional(),
	itemKey: z.string().min(1).max(240).optional(),
	uiPreset: z.enum(["dense", "comfortable"]).default("dense"),
	linkPolicy: z.enum(LINK_POLICY_VALUES).default("native_preferred"),
	connectNoteToPrimary: z.boolean().default(true),
};

const renderReferenceSetInputSchema = {
	items: z
		.array(
			z.object({
				title: z.string().min(1).max(300),
				url: z.string().url().optional(),
				note: z.string().max(4000).optional(),
				alias: z.string().min(1).max(120).optional(),
				groupId: z.string().min(1).max(120).optional(),
				containerId: z.string().min(1).max(120).optional(),
			}),
		)
		.min(1)
		.max(300),
	runId: z.string().min(1).max(120).optional(),
	dedupePolicy: z.enum(["by_url", "by_title", "strict"]).default("by_url"),
	layout: z
		.object({
			mode: z.enum(["grid", "column"]).default("grid"),
			originX: z.number().default(0),
			originY: z.number().default(0),
			columns: z.number().int().min(1).max(20).default(3),
			gapX: z.number().min(0).default(420),
			gapY: z.number().min(0).default(360),
		})
		.default({}),
	layoutPolicy: z.enum(["auto_expand", "strict"]).default("auto_expand"),
	uiPreset: z.enum(["dense", "comfortable"]).default("dense"),
	maxItemsPerBatch: z.number().int().min(1).max(100).default(20),
	linkPolicy: z.enum(LINK_POLICY_VALUES).default("fallback_if_unfurl_fails"),
	continueOnError: z.boolean().default(true),
};

const readBoardStateInputSchema = {
	scope: z
		.object({
			groupId: z.string().min(1).optional(),
			containerId: z.string().min(1).optional(),
			roles: z.array(z.string().min(1)).optional(),
			types: z.array(z.string().min(1)).optional(),
		})
		.optional(),
	includeRawPluginData: z.boolean().default(false),
	groupBy: z.enum(["none", "groupId", "containerId", "role", "type"]).default("none"),
	limit: z.number().int().min(1).max(5000).default(1000),
	offset: z.number().int().min(0).default(0),
};

const getArtifactCollectionInputSchema = {
	selectors: z
		.object({
			aliases: z.array(z.string().min(1)).optional(),
			nodeIds: z.array(z.string().min(1)).optional(),
			groupId: z.string().min(1).optional(),
			containerId: z.string().min(1).optional(),
			role: z.string().min(1).optional(),
			types: z.array(z.string().min(1)).optional(),
		})
		.default({}),
	sort: z.enum(["yx", "x", "y", "name"]).default("yx"),
	limit: z.number().int().min(1).max(2000).default(500),
	offset: z.number().int().min(0).default(0),
};

const relocateArtifactsInputSchema = {
	selectors: z
		.object({
			aliases: z.array(z.string().min(1)).optional(),
			nodeIds: z.array(z.string().min(1)).optional(),
			groupId: z.string().min(1).optional(),
			containerId: z.string().min(1).optional(),
			role: z.string().min(1).optional(),
			types: z.array(z.string().min(1)).optional(),
		})
		.default({}),
	layout: z
		.object({
			mode: z.enum(["grid", "offset"]).default("grid"),
			originX: z.number().default(0),
			originY: z.number().default(0),
			columns: z.number().int().min(1).max(20).default(4),
			gapX: z.number().min(0).default(360),
			gapY: z.number().min(0).default(260),
			dx: z.number().default(0),
			dy: z.number().default(0),
		})
		.default({}),
	targetGroupId: z.string().min(1).optional(),
	targetContainerId: z.string().min(1).optional(),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const deleteArtifactsInputSchema = {
	selectors: z
		.object({
			aliases: z.array(z.string().min(1)).optional(),
			nodeIds: z.array(z.string().min(1)).optional(),
			groupId: z.string().min(1).optional(),
			containerId: z.string().min(1).optional(),
			role: z.string().min(1).optional(),
			types: z.array(z.string().min(1)).optional(),
		})
		.default({}),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const deleteByBboxInputSchema = {
	bbox: z.object({
		x: z.number(),
		y: z.number(),
		width: z.number().min(1),
		height: z.number().min(1),
	}),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const archiveByBboxInputSchema = {
	bbox: z.object({
		x: z.number(),
		y: z.number(),
		width: z.number().min(1),
		height: z.number().min(1),
	}),
	archiveGroupId: z.string().min(1).max(120).default("archived"),
	archiveRole: z.string().min(1).max(120).default("archived"),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const deleteByRunInputSchema = {
	runId: z.string().min(1).max(120),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const bulkUpsertArtifactsInputSchema = {
	items: z
		.array(
			z.object({
				target: z.object({ nodeId: z.string().min(1).optional(), alias: z.string().min(1).optional() }).optional(),
				create: z
					.object({
						kind: z.enum(["sticky", "shape", "text", "section", "link"]),
						title: z.string().min(1).max(300).optional(),
						text: z.string().min(1).max(4000).optional(),
						url: z.string().url().optional(),
						type: z.enum(["rectangle", "circle", "diamond"]).optional(),
						x: z.number().optional(),
						y: z.number().optional(),
						width: z.number().optional(),
						height: z.number().optional(),
						fillColor: z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }).optional(),
						strokeColor: z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }).optional(),
						strokeWeight: z.number().optional(),
						opacity: z.number().optional(),
						fontSize: z.number().optional(),
					})
					.optional(),
				patch: z
					.object({
						title: z.string().min(1).max(300).optional(),
						text: z.string().min(1).max(4000).optional(),
						x: z.number().optional(),
						y: z.number().optional(),
						width: z.number().optional(),
						height: z.number().optional(),
						fillColor: z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }).optional(),
						strokeColor: z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number().optional() }).optional(),
						strokeWeight: z.number().optional(),
						opacity: z.number().optional(),
						fontSize: z.number().optional(),
					})
					.optional(),
				alias: z.string().min(1).max(120).optional(),
				groupId: z.string().min(1).max(120).optional(),
				containerId: z.string().min(1).max(120).optional(),
				role: z.string().min(1).max(120).optional(),
				sourceUrl: z.string().url().optional(),
				metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
			}),
		)
		.min(1)
		.max(500),
	continueOnError: z.boolean().default(true),
};

const getBoardGraphInputSchema = {
	scope: z
		.object({
			groupId: z.string().min(1).optional(),
			containerId: z.string().min(1).optional(),
			types: z.array(z.string().min(1)).optional(),
		})
		.default({}),
	includeContainmentEdges: z.boolean().default(true),
	includeConnectorEdges: z.boolean().default(true),
	limit: z.number().int().min(1).max(5000).default(3000),
	offset: z.number().int().min(0).default(0),
};

const moveCollectionInputSchema = {
	selectors: z
		.object({
			aliases: z.array(z.string().min(1)).optional(),
			nodeIds: z.array(z.string().min(1)).optional(),
			groupId: z.string().min(1).optional(),
			containerId: z.string().min(1).optional(),
			role: z.string().min(1).optional(),
			types: z.array(z.string().min(1)).optional(),
		})
		.default({}),
	move: z
		.object({
			mode: z.enum(["absolute", "offset"]).default("offset"),
			originX: z.number().default(0),
			originY: z.number().default(0),
			columns: z.number().int().min(1).max(20).default(4),
			gapX: z.number().min(0).default(340),
			gapY: z.number().min(0).default(260),
			dx: z.number().default(0),
			dy: z.number().default(0),
		})
		.default({}),
	targetGroupId: z.string().min(1).optional(),
	targetContainerId: z.string().min(1).optional(),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const archiveCollectionInputSchema = {
	selectors: z
		.object({
			aliases: z.array(z.string().min(1)).optional(),
			nodeIds: z.array(z.string().min(1)).optional(),
			groupId: z.string().min(1).optional(),
			containerId: z.string().min(1).optional(),
			role: z.string().min(1).optional(),
			types: z.array(z.string().min(1)).optional(),
		})
		.default({}),
	archiveGroupId: z.string().min(1).max(120).default("archived"),
	archiveRole: z.string().min(1).max(120).default("archived"),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const applyLayoutToCollectionInputSchema = {
	selectors: z
		.object({
			aliases: z.array(z.string().min(1)).optional(),
			nodeIds: z.array(z.string().min(1)).optional(),
			groupId: z.string().min(1).optional(),
			containerId: z.string().min(1).optional(),
			role: z.string().min(1).optional(),
			types: z.array(z.string().min(1)).optional(),
		})
		.default({}),
	layout: z
		.object({
			mode: z.enum(["grid", "column"]).default("grid"),
			originX: z.number().default(0),
			originY: z.number().default(0),
			columns: z.number().int().min(1).max(20).default(4),
			gapX: z.number().min(0).default(340),
			gapY: z.number().min(0).default(260),
		})
		.default({}),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const exportBoardSnapshotInputSchema = {
	scope: z
		.object({
			groupId: z.string().min(1).optional(),
			containerId: z.string().min(1).optional(),
			roles: z.array(z.string().min(1)).optional(),
			types: z.array(z.string().min(1)).optional(),
		})
		.default({}),
	includeRawPluginData: z.boolean().default(true),
};

const importReferenceBundleInputSchema = {
	title: z.string().min(1).max(300).optional(),
	items: z
		.array(
			z.object({
				title: z.string().min(1).max(300),
				url: z.string().url().optional(),
				note: z.string().max(4000).optional(),
				alias: z.string().min(1).max(120).optional(),
				groupId: z.string().min(1).max(120).optional(),
				containerId: z.string().min(1).max(120).optional(),
			}),
		)
		.min(1)
		.max(400),
	layout: z
		.object({
			mode: z.enum(["grid", "column"]).default("grid"),
			originX: z.number().default(0),
			originY: z.number().default(0),
			columns: z.number().int().min(1).max(20).default(4),
			gapX: z.number().min(0).default(420),
			gapY: z.number().min(0).default(360),
		})
		.default({}),
	uiPreset: z.enum(["dense", "comfortable"]).default("dense"),
	linkPolicy: z.enum(LINK_POLICY_VALUES).default("fallback_if_unfurl_fails"),
	continueOnError: z.boolean().default(true),
};

function flattenNodes(nodes: FigJamNodeSummary[]): FlatNode[] {
	const out: FlatNode[] = [];
	const walk = (node: FigJamNodeSummary) => {
		const pd = node.pluginData || {};
		const metadata = parseMetadata(pd["figjam.metadata"]);
		out.push({
			...node,
			alias: pd["figjam.alias"],
			role: pd["figjam.role"],
			groupId: pd["figjam.groupId"],
			containerId: pd["figjam.containerId"],
			sourceUrl: pd["figjam.sourceUrl"] || pd["figjam.link.url"],
			updatedAt: pd["figjam.updatedAt"],
			runId:
				pd["figjam.runId"] ||
				(typeof metadata?.runId === "string" ? (metadata.runId as string) : undefined),
			itemKey:
				pd["figjam.itemKey"] ||
				(typeof metadata?.itemKey === "string" ? (metadata.itemKey as string) : undefined),
			metadata,
		});
		if (Array.isArray(node.children)) {
			for (const child of node.children) walk(child);
		}
	};
	for (const n of nodes) walk(n);
	return out;
}

function sortNodes(nodes: FlatNode[], mode: "yx" | "x" | "y" | "name"): FlatNode[] {
	const aNum = (value: unknown) => (typeof value === "number" ? value : Number.POSITIVE_INFINITY);
	if (mode === "x") return [...nodes].sort((a, b) => aNum(a.x) - aNum(b.x) || a.id.localeCompare(b.id));
	if (mode === "y") return [...nodes].sort((a, b) => aNum(a.y) - aNum(b.y) || a.id.localeCompare(b.id));
	if (mode === "name")
		return [...nodes].sort((a, b) => (a.name || "").localeCompare(b.name || "") || a.id.localeCompare(b.id));
	return [...nodes].sort((a, b) => aNum(a.y) - aNum(b.y) || aNum(a.x) - aNum(b.x) || a.id.localeCompare(b.id));
}

function selectNodes(nodes: FlatNode[], selectors: {
	aliases?: string[];
	nodeIds?: string[];
	groupId?: string;
	containerId?: string;
	role?: string;
	types?: string[];
}): FlatNode[] {
	const aliasSet = selectors.aliases ? new Set(selectors.aliases) : null;
	const nodeIdSet = selectors.nodeIds ? new Set(selectors.nodeIds) : null;
	const typeSet = selectors.types ? new Set(selectors.types) : null;
	return nodes.filter((n) => {
		if (aliasSet && !aliasSet.has(n.alias || "")) return false;
		if (nodeIdSet && !nodeIdSet.has(n.id)) return false;
		if (selectors.groupId && n.groupId !== selectors.groupId) return false;
		if (selectors.containerId && n.containerId !== selectors.containerId) return false;
		if (selectors.role && n.role !== selectors.role) return false;
		if (typeSet && !typeSet.has(n.type)) return false;
		return true;
	});
}

function resolveNodeByTarget(nodes: FlatNode[], target?: { nodeId?: string; alias?: string }) {
	if (!target) return null;
	if (target.nodeId) return nodes.find((n) => n.id === target.nodeId) || null;
	if (target.alias) {
		const matches = nodes.filter((n) => n.alias === target.alias);
		if (matches.length === 1) return matches[0];
		return null;
	}
	return null;
}

async function captureRenderValidation(client: Awaited<ReturnType<GetFigJamClient>>, candidateNodeIds: Array<string | null | undefined>) {
	const targetNodeIds = [...new Set(candidateNodeIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
	if (targetNodeIds.length === 0) return { attempted: false, ok: false, nodeId: null, error: "NO_NODE_FOR_VALIDATION", targetNodeIds: [], regionBounds: null, nodeCountInRegion: 0 };

	let regionBounds: { x: number; y: number; width: number; height: number } | null = null;
	let chosenNodeId: string | null = targetNodeIds[0];
	let nodeCountInRegion = 0;
	try {
		const scan = await client.scanBoardState();
		const flat = flattenNodes(scan.nodes);
		const selected = flat.filter((n) => targetNodeIds.includes(n.id) && typeof n.x === "number" && typeof n.y === "number");
		if (selected.length > 0) {
			const minX = Math.min(...selected.map((n) => n.x || 0));
			const minY = Math.min(...selected.map((n) => n.y || 0));
			const maxX = Math.max(...selected.map((n) => (n.x || 0) + (n.width || 0)));
			const maxY = Math.max(...selected.map((n) => (n.y || 0) + (n.height || 0)));
			regionBounds = { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
			nodeCountInRegion = flat.filter((n) => inBbox(n, regionBounds!)).length;
			const containerCandidate = selected.find(
				(n) =>
					typeof n.width === "number" &&
					typeof n.height === "number" &&
					n.x === regionBounds!.x &&
					n.y === regionBounds!.y &&
					n.width >= regionBounds!.width &&
					n.height >= regionBounds!.height,
			);
			if (containerCandidate?.id) chosenNodeId = containerCandidate.id;
		}
	} catch {
		// Keep best-effort validation.
	}

	if (!chosenNodeId) return { attempted: false, ok: false, nodeId: null, error: "NO_NODE_FOR_VALIDATION", targetNodeIds, regionBounds, nodeCountInRegion };
	try {
		const shot = await client.captureNodeScreenshot(chosenNodeId, 2);
		return {
			attempted: true,
			ok: true,
			nodeId: chosenNodeId,
			byteLength: shot.byteLength,
			bounds: shot.bounds,
			targetNodeIds,
			regionBounds,
			nodeCountInRegion,
		};
	} catch (error) {
		return {
			attempted: true,
			ok: false,
			nodeId: chosenNodeId,
			error: error instanceof Error ? error.message : String(error),
			targetNodeIds,
			regionBounds,
			nodeCountInRegion,
		};
	}
}

async function renderSingleReferenceCard(
	getClient: GetFigJamClient,
	input: {
		title: string;
		url?: string;
		note?: string;
		x: number;
		y: number;
		alias?: string;
		groupId?: string;
		containerId?: string;
			runId?: string;
			itemKey?: string;
			uiPreset: UiPreset;
			linkPolicy: LinkPolicy;
			connectNoteToPrimary: boolean;
		},
) {
	const client = await getClient();
	let primary: FigJamNodeSummary | null = null;
	let noteNode: FigJamNodeSummary | null = null;
	let connector: FigJamNodeSummary | null = null;
	let previewNode: FigJamNodeSummary | null = null;
	let titleNode: FigJamNodeSummary | null = null;
	let mode: "native_link" | "fallback_sticky" | "fallback_link_image" | "sticky" = "sticky";
	let fallbackReason: string | undefined;

	const metadata = {
		runId: input.runId || "",
		itemKey: input.itemKey || "",
		title: input.title,
	};
	if (input.url) {
		try {
			const normalizedPolicy = toLinkPolicyMode(input.linkPolicy);
			if (normalizedPolicy === "fallback_link_image") {
					const rendered = await createLinkWithImageFallback(getClient, {
						url: input.url,
						title: input.title,
						x: input.x,
						y: input.y,
						uiPreset: input.uiPreset,
						alias: input.alias,
						groupId: input.groupId,
						containerId: input.containerId,
						role: "reference",
					preferNative: input.linkPolicy !== "fallback_force_card",
				});
				primary = rendered.primary;
				previewNode = rendered.imageNode;
				titleNode = rendered.titleNode;
				mode = rendered.mode;
				fallbackReason = rendered.fallbackReason || undefined;
			} else {
				primary = await client.createLink({
					url: input.url,
					title: input.title,
					x: input.x,
					y: input.y,
					alias: input.alias,
					groupId: input.groupId,
					containerId: input.containerId,
					role: "reference",
					sourceUrl: input.url,
					metadata,
				});
				mode = "native_link";
			}
		} catch (error) {
			if (input.linkPolicy === "native_only") throw error;
			fallbackReason = error instanceof Error ? error.message : String(error);
			primary = await client.createSticky({
				text: `${input.title}\n${input.url}`,
				x: input.x,
				y: input.y,
				alias: input.alias,
				groupId: input.groupId,
				containerId: input.containerId,
				role: "reference_fallback",
				sourceUrl: input.url,
				metadata,
			});
			mode = "fallback_sticky";
		}
	} else {
		primary = await client.createSticky({
			text: input.title,
			x: input.x,
			y: input.y,
			alias: input.alias,
			groupId: input.groupId,
			containerId: input.containerId,
			role: "reference_note",
			metadata,
		});
		mode = "sticky";
	}

	if (input.note && input.note.trim().length > 0) {
		const noteGap = resolveLayoutTokens(input.uiPreset).noteGap;
		const noteY = input.y + Math.max(180, primary?.height || 0) + noteGap;
		noteNode = await client.createSticky({
			text: input.note.trim(),
			x: input.x,
			y: noteY,
			alias: input.alias ? `${input.alias}__note` : undefined,
			groupId: input.groupId,
			containerId: input.containerId,
			role: "note",
			metadata,
		});
		if (input.connectNoteToPrimary && primary?.id && noteNode?.id) {
			connector = await client.createConnector({ fromNodeId: primary.id, toNodeId: noteNode.id });
		}
	}

	return {
		mode,
		primary,
		titleNode,
		preview: previewNode,
		note: noteNode,
		connector,
		fallbackReason,
	};
}

export function registerVisualStateTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"figjam_render_reference_card",
		"Render one deterministic reference card (link/sticky + optional note) into FigJam.",
		renderReferenceCardInputSchema,
		async (input) => {
			try {
				const client = await getClient();
				const capabilities = await client.getRuntimeCapabilities().catch(() => ({
					supportsSections: false,
					supportsRichUnfurl: false,
					supportsImageInsert: false,
				}));
				const runId = input.runId || createRunId();
				const itemKey = input.itemKey || itemKeyFromItem(input, "by_url");
				const created = await renderSingleReferenceCard(getClient, {
					...input,
					runId,
					itemKey,
				});
				const renderValidation = await captureRenderValidation(client, [
					created.primary?.id,
					created.preview?.id,
					created.titleNode?.id,
					created.note?.id,
				]);
				return ok({
						reference: {
							mode: created.mode,
							uiPreset: input.uiPreset,
							runId,
						itemKey,
						capabilities,
						alias: input.alias || null,
						groupId: input.groupId || null,
						containerId: input.containerId || null,
						primaryNodeId: created.primary?.id || null,
						titleNodeId: created.titleNode?.id || null,
						previewNodeId: created.preview?.id || null,
						noteNodeId: created.note?.id || null,
						connectorNodeId: created.connector?.id || null,
						fallbackReason: created.fallbackReason || null,
					},
					nodes: {
						primary: created.primary,
						title: created.titleNode,
						preview: created.preview,
						note: created.note,
						connector: created.connector,
					},
					renderValidation,
				});
			} catch (error) {
				return fail(error, "Failed to render reference card");
			}
		},
	);

	server.tool(
		"figjam_render_reference_set",
		"Render a deterministic set of reference cards with grid/column placement.",
		renderReferenceSetInputSchema,
		async ({ items, runId, dedupePolicy, layout, layoutPolicy, uiPreset, maxItemsPerBatch, linkPolicy, continueOnError }) => {
			try {
				const client = await getClient();
				const capabilities = await client.getRuntimeCapabilities().catch(() => ({
					supportsSections: false,
					supportsRichUnfurl: false,
					supportsImageInsert: false,
				}));
				const resolvedRunId = runId || createRunId();
				const created: Array<Record<string, unknown>> = [];
				const failed: Array<{ index: number; title: string; error: string }> = [];
				const createdNodeIds: string[] = [];
				const footprintByItem = items.map((item) =>
					estimateCardFootprint({
						hasUrl: Boolean(item.url),
						hasNote: Boolean(item.note && item.note.trim().length > 0),
						linkPolicy,
						uiPreset,
					}),
				);
					const footprintMaxWidth = footprintByItem.reduce((max, item) => Math.max(max, item.width), 0);
					const footprintMaxHeight = footprintByItem.reduce((max, item) => Math.max(max, item.height), 0);
					const layoutTokens = resolveLayoutTokens(uiPreset);
					let appliedGapX = layout.gapX;
					let appliedGapY = layout.gapY;
					if (layout.mode === "grid") {
						if (layoutPolicy === "strict" && (layout.gapX < footprintMaxWidth || layout.gapY < footprintMaxHeight)) {
							return {
							isError: true,
							content: [
								{
									type: "text" as const,
									text: JSON.stringify({
										error: {
											code: "LAYOUT_GAP_TOO_SMALL",
											tool: "figjam_render_reference_set",
											message: "Requested gap is smaller than required card footprint",
											details: {
												requestedGapX: layout.gapX,
												requestedGapY: layout.gapY,
												footprintMaxWidth,
												footprintMaxHeight,
											},
										},
									}),
								},
							],
						};
						}
						appliedGapX = Math.max(layout.gapX, footprintMaxWidth);
						appliedGapY = Math.max(layout.gapY, footprintMaxHeight);
					} else {
						const minColumnGapY = Math.max(20, Math.floor(layoutTokens.noteGap * 1.2));
						const columnCount = Math.max(1, layout.columns || 1);
						if (layoutPolicy === "strict" && columnCount > 1 && layout.gapX < footprintMaxWidth) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "LAYOUT_GAP_TOO_SMALL",
												tool: "figjam_render_reference_set",
												message: "Requested column gap is smaller than required card footprint",
												details: {
													requestedGapX: layout.gapX,
													footprintMaxWidth,
												},
											},
										}),
									},
								],
							};
						}
						appliedGapX = columnCount > 1 ? Math.max(layout.gapX, footprintMaxWidth) : layout.gapX;
						appliedGapY = Math.max(layout.gapY, minColumnGapY);
					}

				const scan = await client.scanBoardState();
				const existing = flattenNodes(scan.nodes);
				const byRunAndItemKey = new Map<string, FlatNode>();
				for (const node of existing) {
					if (!node.runId || !node.itemKey) continue;
					byRunAndItemKey.set(`${node.runId}::${node.itemKey}`, node);
				}

					const totalItems = items.length;
					let overlapCount = 0;
					let nativeCount = 0;
					let fallbackCount = 0;
					let orphanNoteCount = 0;
					const measuredHeights: number[] = [];

					const plan = computePlannedSlots(
						{
							mode: layout.mode,
							originX: layout.originX,
							originY: layout.originY,
							columns: layout.columns,
							gapX: appliedGapX,
							gapY: appliedGapY,
						},
						footprintByItem.map((v) => v.height),
					);
					const plannedPositions = plan.slots;

					const renderedPlacements: Array<{
						index: number;
						column: number;
						x: number;
						y: number;
						finalY: number;
						width: number;
						height: number;
						primaryNodeId: string | null;
						noteNodeId: string | null;
					}> = [];

					for (let i = 0; i < items.length; i += 1) {
						const item = items[i];
						const itemKey = itemKeyFromItem(item, dedupePolicy);
						const uniqueKey = `${resolvedRunId}::${itemKey}`;
						const metadata = { runId: resolvedRunId, itemKey, batchSize: totalItems };
						const footprint = footprintByItem[i];
						const placement = plannedPositions[i];
						const x = placement.x;
						const y = placement.y;
						try {
							const existingNode = byRunAndItemKey.get(uniqueKey);
							if (existingNode) {
							await client.moveNode({ nodeId: existingNode.id, x, y });
							await client.updateNode({
								nodeId: existingNode.id,
								groupId: item.groupId,
								containerId: item.containerId,
								alias: item.alias,
								sourceUrl: item.url,
								role: "reference",
								metadata,
							});
							created.push({
								index: i,
								title: item.title,
								alias: item.alias || null,
								mode: "upsert_existing",
								primaryNodeId: existingNode.id,
								titleNodeId: null,
								previewNodeId: null,
								noteNodeId: null,
								connectorNodeId: null,
								itemKey,
								});
								createdNodeIds.push(existingNode.id);
								const measuredHeight =
									typeof existingNode.height === "number" && existingNode.height > 0
										? existingNode.height
										: footprint.height;
								const measuredWidth =
									typeof existingNode.width === "number" && existingNode.width > 0
										? existingNode.width
										: footprint.width;
								measuredHeights.push(measuredHeight);
								renderedPlacements.push({
									index: i,
									column: placement.column,
									x,
									y,
									finalY: y,
									width: measuredWidth,
									height: measuredHeight,
									primaryNodeId: existingNode.id,
									noteNodeId: null,
								});
								continue;
							}

						const rendered = await renderSingleReferenceCard(getClient, {
							...item,
							x,
							y,
							uiPreset,
							linkPolicy,
							connectNoteToPrimary: true,
							runId: resolvedRunId,
							itemKey,
						});
						created.push({
							index: i,
							title: item.title,
							alias: item.alias || null,
							mode: rendered.mode,
							primaryNodeId: rendered.primary?.id || null,
							titleNodeId: rendered.titleNode?.id || null,
							previewNodeId: rendered.preview?.id || null,
							noteNodeId: rendered.note?.id || null,
							connectorNodeId: rendered.connector?.id || null,
							itemKey,
							fallbackReason: rendered.fallbackReason || null,
							});
							if (rendered.primary?.id) createdNodeIds.push(rendered.primary.id);
							const measuredHeight =
								typeof rendered.primary?.height === "number" && rendered.primary.height > 0
									? rendered.primary.height
									: footprint.height;
							const measuredWidth =
								typeof rendered.primary?.width === "number" && rendered.primary.width > 0
									? rendered.primary.width
									: footprint.width;
							measuredHeights.push(measuredHeight);
							if (rendered.mode === "native_link") nativeCount += 1;
							if (rendered.mode === "fallback_link_image" || rendered.mode === "fallback_sticky") fallbackCount += 1;
							if (item.note && !rendered.note) orphanNoteCount += 1;
							renderedPlacements.push({
								index: i,
								column: placement.column,
								x,
								y,
								finalY: y,
								width: measuredWidth,
								height: measuredHeight,
								primaryNodeId: rendered.primary?.id || null,
								noteNodeId: rendered.note?.id || null,
							});
						} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "PARTIAL_FAILURE",
												tool: "figjam_render_reference_set",
												message: `Batch stopped at item ${i}`,
												details: { index: i, title: item.title, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ index: i, title: item.title, error: message });
					}
						if ((i + 1) % maxItemsPerBatch === 0) {
							// Yield opportunity between deterministic chunks for large runs.
							await new Promise((resolve) => setTimeout(resolve, 0));
						}
					}

					if (layout.mode === "column") {
						const reflow = computeMeasuredColumnReflow(
							{
								mode: layout.mode,
								originX: layout.originX,
								originY: layout.originY,
								columns: layout.columns,
								gapX: appliedGapX,
								gapY: appliedGapY,
							},
							renderedPlacements.map((v) => ({
								index: v.index,
								column: v.column,
								x: v.x,
								y: v.y,
								height: v.height,
							})),
						);
						const byIndex = new Map<number, { x: number; y: number }>();
						for (const item of reflow) byIndex.set(item.index, { x: item.x, y: item.y });

						for (const placement of renderedPlacements.sort((a, b) => a.index - b.index)) {
							const target = byIndex.get(placement.index);
							const targetY = target ? target.y : placement.y;
							if (Math.abs(targetY - placement.y) <= 0.5) {
								placement.finalY = placement.y;
								continue;
							}
							placement.finalY = targetY;
							if (placement.primaryNodeId) {
								await client.moveNode({ nodeId: placement.primaryNodeId, x: placement.x, y: targetY });
							}
							if (placement.noteNodeId) {
								const noteY = targetY + Math.max(180, placement.height) + layoutTokens.noteGap;
								await client.moveNode({ nodeId: placement.noteNodeId, x: placement.x, y: noteY });
							}
						}
					}

					overlapCount = computeOverlapCount(
						renderedPlacements.map((placement) => ({
							x: placement.x,
							y: placement.finalY,
							width: placement.width,
							height: placement.height,
						})),
					);

					return ok({
					batch: {
						runId: resolvedRunId,
						uiPreset,
						capabilities,
						layoutMode: layout.mode,
						layoutPolicy,
						total: items.length,
						createdCount: created.length,
						failedCount: failed.length,
						nativeCount,
						fallbackCount,
						overlapCount,
						orphanNoteCount,
						appliedGapX,
						appliedGapY,
						footprintMaxWidth,
						footprintMaxHeight,
							cardVariantCounts: {
								urlBacked: items.filter((item) => Boolean(item.url)).length,
								textOnly: items.filter((item) => !item.url).length,
							},
							measuredCardHeights: measuredHeights,
							created,
						failed,
					},
					renderValidation: await captureRenderValidation(client, createdNodeIds),
				});
			} catch (error) {
				return fail(error, "Failed to render reference set");
			}
		},
	);

	server.tool(
		"figjam_read_board_state",
		"Read deterministic structured board state for agent-side reasoning.",
		readBoardStateInputSchema,
		async ({ scope, includeRawPluginData, groupBy, limit, offset }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				let entities = flattenNodes(scan.nodes);

				if (scope) {
					entities = selectNodes(entities, {
						groupId: scope.groupId,
						containerId: scope.containerId,
						role: scope.roles?.length ? undefined : undefined,
						types: scope.types,
					});
					if (scope.roles?.length) {
						const roleSet = new Set(scope.roles);
						entities = entities.filter((n) => n.role && roleSet.has(n.role));
					}
				}

				entities = sortNodes(entities, "yx");
				const page = entities.slice(offset, offset + limit);

				const rows = page.map((n) => ({
					nodeId: n.id,
					nodeType: n.type,
					name: n.name,
					text: n.text,
					x: n.x,
					y: n.y,
					width: n.width,
					height: n.height,
					alias: n.alias || null,
					role: n.role || null,
					groupId: n.groupId || null,
					containerId: n.containerId || null,
					sourceUrl: n.sourceUrl || null,
					updatedAt: n.updatedAt || null,
					pluginData: includeRawPluginData ? n.pluginData || {} : undefined,
					connectorStart: n.connectorStart || null,
					connectorEnd: n.connectorEnd || null,
				}));

				const grouped: Record<string, number> = {};
				if (groupBy !== "none") {
					for (const row of rows) {
						const key =
							groupBy === "groupId"
								? row.groupId || "__none__"
								: groupBy === "containerId"
									? row.containerId || "__none__"
									: groupBy === "role"
										? row.role || "__none__"
										: row.nodeType || "__none__";
						grouped[key] = (grouped[key] || 0) + 1;
					}
				}

				return ok({
					state: {
						fileKey: scan.fileKey,
						pageId: scan.pageId,
						pageName: scan.pageName,
						generatedAt: scan.generatedAt,
						total: entities.length,
						limit,
						offset,
						groupBy,
						groupedCounts: grouped,
						entities: rows,
					},
				});
			} catch (error) {
				return fail(error, "Failed to read board state");
			}
		},
	);

	server.tool(
		"figjam_get_artifact_collection",
		"Get deterministic artifact collections by explicit selectors (alias/node/group/container/role/type).",
		getArtifactCollectionInputSchema,
		async ({ selectors, sort, limit, offset }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const all = flattenNodes(scan.nodes);
				const selected = selectNodes(all, selectors);
				const ordered = sortNodes(selected, sort).slice(offset, offset + limit);
				return ok({
					collection: {
						total: selected.length,
						limit,
						offset,
						sort,
						selectors,
						items: ordered.map((n) => ({
							nodeId: n.id,
							nodeType: n.type,
							name: n.name,
							text: n.text,
							x: n.x,
							y: n.y,
							alias: n.alias || null,
							role: n.role || null,
							groupId: n.groupId || null,
							containerId: n.containerId || null,
							sourceUrl: n.sourceUrl || null,
							updatedAt: n.updatedAt || null,
						})),
					},
				});
			} catch (error) {
				return fail(error, "Failed to get artifact collection");
			}
		},
	);

	server.tool(
		"figjam_relocate_artifacts",
		"Relocate artifacts by selectors using deterministic grid/offset strategies.",
		relocateArtifactsInputSchema,
		async ({ selectors, layout, targetGroupId, targetContainerId, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const all = flattenNodes(scan.nodes);
				const selected = sortNodes(selectNodes(all, selectors), "yx");

				const moved: Array<{
					nodeId: string;
					from: { x?: number; y?: number };
					to: { x: number; y: number };
				}> = [];
				const failed: Array<{ nodeId: string; error: string }> = [];
				const movedNodeIds: string[] = [];

				for (let i = 0; i < selected.length; i += 1) {
					const n = selected[i];
					const targetX =
						layout.mode === "grid"
							? layout.originX + (i % layout.columns) * layout.gapX
							: (n.x || 0) + layout.dx;
					const targetY =
						layout.mode === "grid"
							? layout.originY + Math.floor(i / layout.columns) * layout.gapY
							: (n.y || 0) + layout.dy;
					try {
						if (!dryRun) {
							await client.moveNode({ nodeId: n.id, x: targetX, y: targetY });
							if (targetGroupId || targetContainerId) {
								await client.updateNode({
									nodeId: n.id,
									groupId: targetGroupId,
									containerId: targetContainerId,
								});
							}
						}
						moved.push({
							nodeId: n.id,
							from: { x: n.x, y: n.y },
							to: { x: targetX, y: targetY },
						});
						movedNodeIds.push(n.id);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "MOVE_FAILED",
												tool: "figjam_relocate_artifacts",
												message: "Relocation stopped due to move failure",
												details: { nodeId: n.id, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ nodeId: n.id, error: message });
					}
				}

				return ok({
					relocation: {
						mode: layout.mode,
						dryRun,
						totalSelected: selected.length,
						movedCount: moved.length,
						failedCount: failed.length,
						targetGroupId: targetGroupId || null,
						targetContainerId: targetContainerId || null,
						moved,
						failed,
					},
					renderValidation: dryRun ? { attempted: false, ok: false, nodeId: null, error: "DRY_RUN" } : await captureRenderValidation(client, movedNodeIds),
				});
			} catch (error) {
				return fail(error, "Failed to relocate artifacts");
			}
		},
	);

	server.tool(
		"figjam_delete_artifacts",
		"Delete artifacts by deterministic selectors.",
		deleteArtifactsInputSchema,
		async ({ selectors, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const selected = sortNodes(selectNodes(flattenNodes(scan.nodes), selectors), "yx");
				const deleted: string[] = [];
				const failed: Array<{ nodeId: string; error: string }> = [];
				const firstDeletedCandidate = selected[0]?.id;

				for (const node of selected) {
					try {
						if (!dryRun) {
							await client.deleteNode(node.id);
						}
						deleted.push(node.id);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "DELETE_FAILED",
												tool: "figjam_delete_artifacts",
												message: "Deletion stopped due to node removal error",
												details: { nodeId: node.id, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ nodeId: node.id, error: message });
					}
				}

				return ok({
					deletion: {
						dryRun,
						totalSelected: selected.length,
						deletedCount: deleted.length,
						failedCount: failed.length,
						deleted,
						failed,
					},
					renderValidation: dryRun
						? { attempted: false, ok: false, nodeId: null, error: "DRY_RUN" }
						: { attempted: false, ok: false, nodeId: firstDeletedCandidate || null, error: "NODE_DELETED_BEFORE_VALIDATION" },
				});
			} catch (error) {
				return fail(error, "Failed to delete artifacts");
			}
		},
	);

	server.tool(
		"figjam_bulk_upsert_artifacts",
		"Bulk deterministic upsert for artifacts using explicit target/create/patch precedence.",
		bulkUpsertArtifactsInputSchema,
		async ({ items, continueOnError }) => {
			try {
				const client = await getClient();
				const created: Array<{ index: number; nodeId: string; resolution: string }> = [];
				const updated: Array<{ index: number; nodeId: string; resolution: string }> = [];
				const failed: Array<{ index: number; error: string }> = [];
				const touchedNodeIds: string[] = [];

				for (let i = 0; i < items.length; i += 1) {
					const item = items[i];
					try {
						const scan = await client.scanBoardState();
						const nodes = flattenNodes(scan.nodes);
						const targetNode = resolveNodeByTarget(nodes, item.target);

						if (targetNode) {
							const patch = item.patch || {};
								await client.updateNode({
									nodeId: targetNode.id,
									title: patch.title,
									text: patch.text,
									x: patch.x,
									y: patch.y,
									width: patch.width,
									height: patch.height,
									fillColor: (patch as any).fillColor,
									strokeColor: (patch as any).strokeColor,
									strokeWeight: (patch as any).strokeWeight,
									opacity: (patch as any).opacity,
									fontSize: (patch as any).fontSize,
									alias: item.alias,
									groupId: item.groupId,
									containerId: item.containerId,
								role: item.role,
								sourceUrl: item.sourceUrl,
								metadata: item.metadata,
							});
							updated.push({ index: i, nodeId: targetNode.id, resolution: "target" });
							touchedNodeIds.push(targetNode.id);
							continue;
						}

						if (!item.create) {
							throw new Error("No target resolved and no create payload provided");
						}

						const create = item.create;
						let createdNode: FigJamNodeSummary;
						if (create.kind === "sticky") {
							createdNode = await client.createSticky({
								text: create.text || create.title || "Untitled",
								x: create.x,
								y: create.y,
								width: create.width,
								height: create.height,
								alias: item.alias,
								groupId: item.groupId,
								containerId: item.containerId,
								role: item.role,
								sourceUrl: item.sourceUrl,
								metadata: item.metadata,
							});
						} else if (create.kind === "shape") {
								createdNode = await client.createShape({
									type: create.type || "rectangle",
									text: create.text || create.title,
									x: create.x,
									y: create.y,
									width: create.width,
									height: create.height,
									fillColor: create.fillColor,
									strokeColor: create.strokeColor,
									strokeWeight: create.strokeWeight,
									opacity: create.opacity,
									fontSize: create.fontSize,
									alias: item.alias,
									groupId: item.groupId,
									containerId: item.containerId,
								role: item.role,
								sourceUrl: item.sourceUrl,
								metadata: item.metadata,
							});
						} else if (create.kind === "text") {
								createdNode = await client.createText({
									text: create.text || create.title || "Untitled",
									x: create.x,
									y: create.y,
									fontSize: create.fontSize,
									alias: item.alias,
									groupId: item.groupId,
								containerId: item.containerId,
								role: item.role,
								sourceUrl: item.sourceUrl,
								metadata: item.metadata,
							});
						} else if (create.kind === "section") {
							try {
									createdNode = await client.createSection({
										name: create.title || "Section",
										x: create.x,
										y: create.y,
										width: create.width,
										height: create.height,
										fillColor: create.fillColor,
										strokeColor: create.strokeColor,
										strokeWeight: create.strokeWeight,
										opacity: create.opacity,
										alias: item.alias,
										groupId: item.groupId,
									containerId: item.containerId,
									role: item.role,
									sourceUrl: item.sourceUrl,
									metadata: item.metadata,
								});
							} catch {
								// Fallback for runtimes where section creation is not available.
									createdNode = await client.createShape({
										type: "rectangle",
										text: create.title || "",
										x: create.x,
										y: create.y,
										width: create.width || 1200,
										height: create.height || 800,
										fillColor: create.fillColor,
										strokeColor: create.strokeColor,
										strokeWeight: create.strokeWeight,
										opacity: create.opacity,
										alias: item.alias,
									groupId: item.groupId,
									containerId: item.containerId,
									role: item.role || "section_fallback",
									sourceUrl: item.sourceUrl,
									metadata: item.metadata,
								});
							}
						} else {
							createdNode = await client.createLink({
								url: create.url || item.sourceUrl || "https://example.com",
								title: create.title || create.text,
								x: create.x,
								y: create.y,
								alias: item.alias,
								groupId: item.groupId,
								containerId: item.containerId,
								role: item.role,
								sourceUrl: item.sourceUrl || create.url,
								metadata: item.metadata,
							});
						}
						created.push({ index: i, nodeId: createdNode.id, resolution: "create" });
						touchedNodeIds.push(createdNode.id);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "UPSERT_FAILED",
												tool: "figjam_bulk_upsert_artifacts",
												message: `Upsert stopped at index ${i}`,
												details: { index: i, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ index: i, error: message });
					}
				}

				return ok({
					upsertBatch: {
						total: items.length,
						createdCount: created.length,
						updatedCount: updated.length,
						failedCount: failed.length,
						created,
						updated,
						failed,
					},
					renderValidation: await captureRenderValidation(client, touchedNodeIds),
				});
			} catch (error) {
				return fail(error, "Failed to bulk upsert artifacts");
			}
		},
	);

	server.tool(
		"figjam_delete_by_bbox",
		"Delete nodes intersecting a bounding box. Supports dry-run preview.",
		deleteByBboxInputSchema,
		async ({ bbox, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const selected = sortNodes(flattenNodes(scan.nodes).filter((node) => inBbox(node, bbox)), "yx");
				const deleted: string[] = [];
				const failed: Array<{ nodeId: string; error: string }> = [];
				for (const node of selected) {
					try {
						if (!dryRun) await client.deleteNode(node.id);
						deleted.push(node.id);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "DELETE_FAILED",
												tool: "figjam_delete_by_bbox",
												message: "Deletion stopped due to node removal error",
												details: { nodeId: node.id, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ nodeId: node.id, error: message });
					}
				}
				return ok({
					deletion: {
						bbox,
						dryRun,
						totalSelected: selected.length,
						deletedCount: deleted.length,
						failedCount: failed.length,
						deleted,
						failed,
					},
				});
			} catch (error) {
				return fail(error, "Failed to delete by bbox");
			}
		},
	);

	server.tool(
		"figjam_archive_by_bbox",
		"Archive nodes intersecting a bounding box by updating deterministic metadata.",
		archiveByBboxInputSchema,
		async ({ bbox, archiveGroupId, archiveRole, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const selected = sortNodes(flattenNodes(scan.nodes).filter((node) => inBbox(node, bbox)), "yx");
				const archived: string[] = [];
				const failed: Array<{ nodeId: string; error: string }> = [];
				for (const node of selected) {
					try {
						if (!dryRun) {
							await client.updateNode({
								nodeId: node.id,
								groupId: archiveGroupId,
								role: archiveRole,
								metadata: {
									archived: true,
									archivedAt: new Date().toISOString(),
								},
							});
						}
						archived.push(node.id);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "ARCHIVE_FAILED",
												tool: "figjam_archive_by_bbox",
												message: "Archive stopped due to node update error",
												details: { nodeId: node.id, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ nodeId: node.id, error: message });
					}
				}
				return ok({
					archive: {
						bbox,
						archiveGroupId,
						archiveRole,
						dryRun,
						totalSelected: selected.length,
						archivedCount: archived.length,
						failedCount: failed.length,
						archived,
						failed,
					},
				});
			} catch (error) {
				return fail(error, "Failed to archive by bbox");
			}
		},
	);

	server.tool(
		"figjam_delete_by_run",
		"Delete nodes created by a specific runId. Supports dry-run preview.",
		deleteByRunInputSchema,
		async ({ runId, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const selected = sortNodes(
					flattenNodes(scan.nodes).filter((node) => node.runId === runId),
					"yx",
				);
				const deleted: string[] = [];
				const failed: Array<{ nodeId: string; error: string }> = [];
				for (const node of selected) {
					try {
						if (!dryRun) await client.deleteNode(node.id);
						deleted.push(node.id);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "DELETE_FAILED",
												tool: "figjam_delete_by_run",
												message: "Deletion stopped due to node removal error",
												details: { nodeId: node.id, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ nodeId: node.id, error: message });
					}
				}
				return ok({
					deletion: {
						runId,
						dryRun,
						totalSelected: selected.length,
						deletedCount: deleted.length,
						failedCount: failed.length,
						deleted,
						failed,
					},
				});
			} catch (error) {
				return fail(error, "Failed to delete by run");
			}
		},
	);

	server.tool(
		"figjam_get_board_graph",
		"Return deterministic board graph (nodes + connector/containment edges).",
		getBoardGraphInputSchema,
		async ({ scope, includeContainmentEdges, includeConnectorEdges, limit, offset }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const flat = flattenNodes(scan.nodes);
				const selected = sortNodes(
					selectNodes(flat, {
						groupId: scope.groupId,
						containerId: scope.containerId,
						types: scope.types,
					}),
					"yx",
				).slice(offset, offset + limit);
				const selectedSet = new Set(selected.map((n) => n.id));

				const edges: Array<{ id: string; type: "connector" | "containment"; from: string; to: string }> = [];
				if (includeConnectorEdges) {
					for (const node of selected) {
						if (node.type !== "CONNECTOR") continue;
						const from = node.connectorStart?.endpointNodeId;
						const to = node.connectorEnd?.endpointNodeId;
						if (!from || !to) continue;
						if (!selectedSet.has(from) || !selectedSet.has(to)) continue;
						edges.push({ id: node.id, type: "connector", from, to });
					}
				}
				if (includeContainmentEdges) {
					for (const node of selected) {
						const parent = node.parentId;
						if (!parent || !selectedSet.has(parent)) continue;
						edges.push({ id: `${parent}->${node.id}`, type: "containment", from: parent, to: node.id });
					}
				}

				return ok({
					graph: {
						fileKey: scan.fileKey,
						pageId: scan.pageId,
						pageName: scan.pageName,
						generatedAt: scan.generatedAt,
						totalNodes: selected.length,
						totalEdges: edges.length,
						nodes: selected.map((n) => ({
							nodeId: n.id,
							nodeType: n.type,
							name: n.name,
							alias: n.alias || null,
							role: n.role || null,
							groupId: n.groupId || null,
							containerId: n.containerId || null,
							parentId: n.parentId || null,
							x: n.x,
							y: n.y,
						})),
						edges,
					},
				});
			} catch (error) {
				return fail(error, "Failed to get board graph");
			}
		},
	);

	server.tool(
		"figjam_move_collection",
		"Move deterministic artifact collection by absolute or offset positioning.",
		moveCollectionInputSchema,
		async ({ selectors, move, targetGroupId, targetContainerId, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const selected = sortNodes(selectNodes(flattenNodes(scan.nodes), selectors), "yx");
				const moved: Array<{ nodeId: string; from: { x?: number; y?: number }; to: { x: number; y: number } }> = [];
				const failed: Array<{ nodeId: string; error: string }> = [];
				const movedNodeIds: string[] = [];

				for (let i = 0; i < selected.length; i += 1) {
					const node = selected[i];
					const x = move.mode === "absolute" ? move.originX + (i % move.columns) * move.gapX : (node.x || 0) + move.dx;
					const y =
						move.mode === "absolute"
							? move.originY + Math.floor(i / move.columns) * move.gapY
							: (node.y || 0) + move.dy;
					try {
						if (!dryRun) {
							await client.moveNode({ nodeId: node.id, x, y });
							if (targetGroupId || targetContainerId) {
								await client.updateNode({
									nodeId: node.id,
									groupId: targetGroupId,
									containerId: targetContainerId,
								});
							}
						}
						moved.push({ nodeId: node.id, from: { x: node.x, y: node.y }, to: { x, y } });
						movedNodeIds.push(node.id);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "MOVE_COLLECTION_FAILED",
												tool: "figjam_move_collection",
												message: "Move collection stopped due to error",
												details: { nodeId: node.id, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ nodeId: node.id, error: message });
					}
				}

				return ok({
					moveCollection: {
						mode: move.mode,
						dryRun,
						totalSelected: selected.length,
						movedCount: moved.length,
						failedCount: failed.length,
						targetGroupId: targetGroupId || null,
						targetContainerId: targetContainerId || null,
						moved,
						failed,
					},
					renderValidation: dryRun ? { attempted: false, ok: false, nodeId: null, error: "DRY_RUN" } : await captureRenderValidation(client, movedNodeIds),
				});
			} catch (error) {
				return fail(error, "Failed to move collection");
			}
		},
	);

	server.tool(
		"figjam_archive_collection",
		"Archive collection deterministically by updating role/group metadata.",
		archiveCollectionInputSchema,
		async ({ selectors, archiveGroupId, archiveRole, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const selected = sortNodes(selectNodes(flattenNodes(scan.nodes), selectors), "yx");
				const archived: string[] = [];
				const failed: Array<{ nodeId: string; error: string }> = [];

				for (const node of selected) {
					try {
						if (!dryRun) {
							await client.updateNode({
								nodeId: node.id,
								groupId: archiveGroupId,
								role: archiveRole,
								metadata: {
									archived: true,
									archivedAt: new Date().toISOString(),
								},
							});
						}
						archived.push(node.id);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "ARCHIVE_FAILED",
												tool: "figjam_archive_collection",
												message: "Archive stopped due to node update error",
												details: { nodeId: node.id, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ nodeId: node.id, error: message });
					}
				}

				return ok({
					archive: {
						dryRun,
						totalSelected: selected.length,
						archivedCount: archived.length,
						failedCount: failed.length,
						archiveGroupId,
						archiveRole,
						archived,
						failed,
					},
					renderValidation: dryRun ? { attempted: false, ok: false, nodeId: null, error: "DRY_RUN" } : await captureRenderValidation(client, archived),
				});
			} catch (error) {
				return fail(error, "Failed to archive collection");
			}
		},
	);

	server.tool(
		"figjam_apply_layout_to_collection",
		"Apply deterministic layout (grid/column) to a selected collection.",
		applyLayoutToCollectionInputSchema,
		async ({ selectors, layout, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const selected = sortNodes(selectNodes(flattenNodes(scan.nodes), selectors), "yx");
				const moved: Array<{ nodeId: string; to: { x: number; y: number } }> = [];
				const failed: Array<{ nodeId: string; error: string }> = [];
				const movedNodeIds: string[] = [];

				for (let i = 0; i < selected.length; i += 1) {
					const node = selected[i];
					const x = layout.mode === "grid" ? layout.originX + (i % layout.columns) * layout.gapX : layout.originX;
					const y =
						layout.mode === "grid"
							? layout.originY + Math.floor(i / layout.columns) * layout.gapY
							: layout.originY + i * layout.gapY;
					try {
						if (!dryRun) {
							await client.moveNode({ nodeId: node.id, x, y });
						}
						moved.push({ nodeId: node.id, to: { x, y } });
						movedNodeIds.push(node.id);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "LAYOUT_FAILED",
												tool: "figjam_apply_layout_to_collection",
												message: "Layout stopped due to move error",
												details: { nodeId: node.id, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ nodeId: node.id, error: message });
					}
				}

				return ok({
					layoutResult: {
						mode: layout.mode,
						dryRun,
						totalSelected: selected.length,
						movedCount: moved.length,
						failedCount: failed.length,
						moved,
						failed,
					},
					renderValidation: dryRun ? { attempted: false, ok: false, nodeId: null, error: "DRY_RUN" } : await captureRenderValidation(client, movedNodeIds),
				});
			} catch (error) {
				return fail(error, "Failed to apply layout to collection");
			}
		},
	);

	server.tool(
		"figjam_export_board_snapshot",
		"Export deterministic board snapshot payload for agent-side state persistence/reasoning.",
		exportBoardSnapshotInputSchema,
		async ({ scope, includeRawPluginData }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				let entities = flattenNodes(scan.nodes);
				entities = selectNodes(entities, {
					groupId: scope.groupId,
					containerId: scope.containerId,
					types: scope.types,
				});
				if (scope.roles?.length) {
					const roleSet = new Set(scope.roles);
					entities = entities.filter((n) => n.role && roleSet.has(n.role));
				}
				const ordered = sortNodes(entities, "yx");
				return ok({
					snapshot: {
						version: "figjam.dbi.v1",
						fileKey: scan.fileKey,
						pageId: scan.pageId,
						pageName: scan.pageName,
						generatedAt: scan.generatedAt,
						total: ordered.length,
						entities: ordered.map((n) => ({
							nodeId: n.id,
							nodeType: n.type,
							name: n.name,
							text: n.text,
							x: n.x,
							y: n.y,
							width: n.width,
							height: n.height,
							parentId: n.parentId || null,
							alias: n.alias || null,
							role: n.role || null,
							groupId: n.groupId || null,
							containerId: n.containerId || null,
							sourceUrl: n.sourceUrl || null,
							updatedAt: n.updatedAt || null,
							connectorStart: n.connectorStart || null,
							connectorEnd: n.connectorEnd || null,
							pluginData: includeRawPluginData ? n.pluginData || {} : undefined,
						})),
					},
				});
			} catch (error) {
				return fail(error, "Failed to export board snapshot");
			}
		},
	);

		server.tool(
			"figjam_import_reference_bundle",
			"Import deterministic reference bundle onto the board.",
			importReferenceBundleInputSchema,
			async ({ title, items, layout, uiPreset, linkPolicy, continueOnError }) => {
			try {
				const client = await getClient();
				let heading: FigJamNodeSummary | null = null;
				if (title) {
					heading = await client.createText({
						text: title,
						x: layout.originX,
						y: layout.originY - 120,
						role: "bundle_heading",
					});
				}

					const created: Array<Record<string, unknown>> = [];
					const failed: Array<{ index: number; title: string; error: string }> = [];
					const createdNodeIds: string[] = [];
					const layoutTokens = resolveLayoutTokens(uiPreset);
					const footprintByItem = items.map((item) =>
						estimateCardFootprint({
							hasUrl: Boolean(item.url),
							hasNote: Boolean(item.note && item.note.trim().length > 0),
							linkPolicy,
							uiPreset,
						}),
					);
					const plan = computePlannedSlots(
						{
							mode: layout.mode,
							originX: layout.originX,
							originY: layout.originY,
							columns: layout.columns,
							gapX: layout.gapX,
							gapY: layout.gapY,
						},
						footprintByItem.map((v) => v.height),
					);
					const renderedPlacements: Array<{
						index: number;
						column: number;
						x: number;
						y: number;
						finalY: number;
						height: number;
						primaryNodeId: string | null;
						noteNodeId: string | null;
					}> = [];
					for (let i = 0; i < items.length; i += 1) {
						const item = items[i];
						const placement = plan.slots[i];
						const x = placement.x;
						const y = placement.y;
						try {
							const rendered = await renderSingleReferenceCard(getClient, {
								title: item.title,
							url: item.url,
							note: item.note,
							alias: item.alias,
							groupId: item.groupId,
							containerId: item.containerId,
								x,
								y,
								uiPreset,
								linkPolicy,
								connectNoteToPrimary: true,
							});
							created.push({
							index: i,
							title: item.title,
							alias: item.alias || null,
							mode: rendered.mode,
							primaryNodeId: rendered.primary?.id || null,
							noteNodeId: rendered.note?.id || null,
							connectorNodeId: rendered.connector?.id || null,
							});
							if (rendered.primary?.id) createdNodeIds.push(rendered.primary.id);
							renderedPlacements.push({
								index: i,
								column: placement.column,
								x,
								y,
								finalY: y,
								height:
									typeof rendered.primary?.height === "number" && rendered.primary.height > 0
										? rendered.primary.height
										: footprintByItem[i].height,
								primaryNodeId: rendered.primary?.id || null,
								noteNodeId: rendered.note?.id || null,
							});
						} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								isError: true,
								content: [
									{
										type: "text" as const,
										text: JSON.stringify({
											error: {
												code: "IMPORT_BUNDLE_FAILED",
												tool: "figjam_import_reference_bundle",
												message: `Bundle import stopped at index ${i}`,
												details: { index: i, title: item.title, error: message },
											},
										}),
									},
								],
							};
						}
						failed.push({ index: i, title: item.title, error: message });
						}
					}

					if (layout.mode === "column") {
						const reflow = computeMeasuredColumnReflow(
							{
								mode: layout.mode,
								originX: layout.originX,
								originY: layout.originY,
								columns: layout.columns,
								gapX: layout.gapX,
								gapY: layout.gapY,
							},
							renderedPlacements.map((v) => ({
								index: v.index,
								column: v.column,
								x: v.x,
								y: v.y,
								height: v.height,
							})),
						);
						const byIndex = new Map<number, { x: number; y: number }>();
						for (const item of reflow) byIndex.set(item.index, { x: item.x, y: item.y });
						for (const placement of renderedPlacements.sort((a, b) => a.index - b.index)) {
							const target = byIndex.get(placement.index);
							const targetY = target ? target.y : placement.y;
							if (Math.abs(targetY - placement.y) <= 0.5) continue;
							placement.finalY = targetY;
							if (placement.primaryNodeId) {
								await client.moveNode({ nodeId: placement.primaryNodeId, x: placement.x, y: targetY });
							}
							if (placement.noteNodeId) {
								const noteY = targetY + Math.max(180, placement.height) + layoutTokens.noteGap;
								await client.moveNode({ nodeId: placement.noteNodeId, x: placement.x, y: noteY });
							}
						}
					}

					return ok({
					bundle: {
						title: title || null,
						headingNodeId: heading?.id || null,
						total: items.length,
						createdCount: created.length,
						failedCount: failed.length,
						created,
						failed,
					},
					renderValidation: await captureRenderValidation(client, [heading?.id, ...createdNodeIds]),
				});
			} catch (error) {
				return fail(error, "Failed to import reference bundle");
			}
		},
	);
}
