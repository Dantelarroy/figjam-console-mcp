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

const upsertArtifactInputSchema = {
	target: z
		.object({
			nodeId: z.string().min(1).optional(),
			alias: z.string().min(1).optional(),
		})
		.optional(),
	create: z
		.object({
			kind: z.enum(["sticky", "shape", "text", "link", "section"]),
			title: z.string().min(1).max(500).optional(),
			text: z.string().min(1).max(4000).optional(),
			url: z.string().url().optional(),
			shapeType: z.enum(["rectangle", "circle", "diamond"]).optional(),
			x: z.number().optional(),
			y: z.number().optional(),
			width: z.number().optional(),
			height: z.number().optional(),
			fontSize: z.number().optional(),
		})
		.optional(),
	patch: z
		.object({
			title: z.string().min(1).max(500).optional(),
			text: z.string().min(1).max(4000).optional(),
			x: z.number().optional(),
			y: z.number().optional(),
			width: z.number().optional(),
			height: z.number().optional(),
		})
		.optional(),
	alias: z.string().min(1).optional(),
	containerId: z.string().min(1).optional(),
	groupId: z.string().min(1).optional(),
	role: z.string().min(1).optional(),
	sourceUrl: z.string().url().optional(),
	metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
};

const organizeByAliasInputSchema = {
	aliases: z.array(z.string().min(1)).min(1).max(500),
	layout: z
		.object({
			mode: z.enum(["grid", "column"]).default("grid"),
			originX: z.number().default(0),
			originY: z.number().default(0),
			columns: z.number().int().min(1).max(50).default(5),
			gapX: z.number().min(0).default(260),
			gapY: z.number().min(0).default(180),
		})
		.default({}),
	targetContainerId: z.string().min(1).optional(),
	targetGroupId: z.string().min(1).optional(),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const validateBoardIndexInputSchema = {
	requiredAliases: z.array(z.string().min(1)).max(500).optional(),
	requireUniqueAliases: z.boolean().default(true),
	requireResolvedConnectorEndpoints: z.boolean().default(true),
	maxVisualTargets: z.number().int().min(1).max(50).default(10),
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

function dbiError(code: string, tool: string, message: string, details?: unknown) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					error: {
						code,
						tool,
						message,
						details,
					},
				}),
			},
		],
		isError: true as const,
	};
}

function resolveAliasToNodeId(snapshot: DBIIndexSnapshot, alias: string): { nodeId?: string; error?: string; code?: string } {
	const collision = snapshot.collisions.find((c) => c.alias === alias);
	if (collision) {
		return { code: "ALIAS_CONFLICT", error: `Alias ${alias} resolves to multiple nodes` };
	}
	const nodeId = snapshot.aliases[alias];
	if (!nodeId) {
		return { code: "NOT_FOUND", error: `Alias ${alias} not found` };
	}
	return { nodeId };
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

	server.tool(
		"figjam_upsert_artifact",
		"Create or update a deterministic artifact by nodeId/alias with explicit precedence rules.",
		upsertArtifactInputSchema,
		async (input) => {
			try {
				const hasTarget = Boolean(input.target?.nodeId || input.target?.alias);
				const hasCreate = Boolean(input.create);
				const hasPatch = Boolean(input.patch);

				if (!hasTarget && !hasCreate && hasPatch) {
					return dbiError(
						"INVALID_REQUEST",
						"figjam_upsert_artifact",
						"patch requires target or create",
					);
				}

				if (!hasTarget && !hasCreate) {
					return dbiError(
						"INVALID_REQUEST",
						"figjam_upsert_artifact",
						"Provide target or create",
					);
				}

				const client = await getClient();
				const scan = await client.scanBoardState();
				const snapshot = fromScan(scan, "fresh");
				cache.set(keyForSnapshot(scan), snapshot);

				let targetNodeId: string | null = null;
				let resolution: "target" | "create" | "create_fallback" = "create";

				if (input.target?.nodeId) {
					const exists = snapshot.entities.some((e) => e.nodeId === input.target?.nodeId);
					if (exists) {
						targetNodeId = input.target.nodeId;
						resolution = "target";
					} else if (!hasCreate) {
						return dbiError("NOT_FOUND", "figjam_upsert_artifact", "target.nodeId not found", {
							nodeId: input.target.nodeId,
						});
					}
				}

				if (!targetNodeId && input.target?.alias) {
					const collision = snapshot.collisions.find((c) => c.alias === input.target?.alias);
					if (collision) {
						return dbiError(
							"ALIAS_CONFLICT",
							"figjam_upsert_artifact",
							"Alias resolves to multiple nodes",
							{ alias: input.target.alias, nodeIds: collision.nodeIds },
						);
					}
					const resolved = snapshot.aliases[input.target.alias];
					if (resolved) {
						targetNodeId = resolved;
						resolution = "target";
					} else if (!hasCreate) {
						return dbiError("NOT_FOUND", "figjam_upsert_artifact", "target.alias not found", {
							alias: input.target.alias,
						});
					}
				}

				let nodeId = targetNodeId;
				if (!nodeId) {
					if (!input.create) {
						return dbiError(
							"INVALID_REQUEST",
							"figjam_upsert_artifact",
							"Unable to resolve target and no create payload provided",
						);
					}
					resolution = hasTarget ? "create_fallback" : "create";
					const base = {
						alias: input.alias,
						containerId: input.containerId,
						groupId: input.groupId,
						role: input.role,
						sourceUrl: input.sourceUrl,
						metadata: input.metadata,
					};
					if (input.create.kind === "sticky") {
						const sticky = await client.createSticky({
							text: input.create.text || input.create.title || "Untitled",
							x: input.create.x,
							y: input.create.y,
							width: input.create.width,
							height: input.create.height,
							...base,
						});
						nodeId = sticky.id;
					} else if (input.create.kind === "shape") {
						const shape = await client.createShape({
							type: input.create.shapeType || "rectangle",
							text: input.create.text || input.create.title,
							x: input.create.x,
							y: input.create.y,
							width: input.create.width,
							height: input.create.height,
							...base,
						});
						nodeId = shape.id;
					} else if (input.create.kind === "text") {
						const text = await client.createText({
							text: input.create.text || input.create.title || "Untitled",
							x: input.create.x,
							y: input.create.y,
							fontSize: input.create.fontSize,
							...base,
						});
						nodeId = text.id;
					} else if (input.create.kind === "link") {
						if (!input.create.url) {
							return dbiError(
								"INVALID_REQUEST",
								"figjam_upsert_artifact",
								"create.url is required for kind=link",
							);
						}
						const link = await client.createLink({
							url: input.create.url,
							title: input.create.title,
							x: input.create.x,
							y: input.create.y,
							...base,
						});
						nodeId = link.id;
					} else {
						const section = await client.createSection({
							name: input.create.title,
							x: input.create.x,
							y: input.create.y,
							width: input.create.width,
							height: input.create.height,
							...base,
						});
						nodeId = section.id;
					}
				}

				const resolvedNodeId = nodeId as string;

				const shouldPatch = Boolean(
					input.patch ||
						input.alias ||
						input.containerId ||
						input.groupId ||
						input.role ||
						input.sourceUrl ||
						input.metadata,
				);

				const updated = shouldPatch
					? await client.updateNode({
							nodeId: resolvedNodeId,
							title: input.patch?.title,
							text: input.patch?.text,
							x: input.patch?.x,
							y: input.patch?.y,
							width: input.patch?.width,
							height: input.patch?.height,
							alias: input.alias,
							containerId: input.containerId,
							groupId: input.groupId,
							role: input.role,
							sourceUrl: input.sourceUrl,
							metadata: input.metadata,
						})
					: await client.updateNode({ nodeId: resolvedNodeId });

				const refreshedScan = await client.scanBoardState();
				cache.set(keyForSnapshot(refreshedScan), fromScan(refreshedScan, "fresh"));

				return ok({
					upsert: {
						nodeId: updated.id,
						nodeType: updated.type,
						resolution,
						alias: input.alias || null,
						containerId: input.containerId || null,
						groupId: input.groupId || null,
					},
					node: updated,
				});
			} catch (error) {
				return fail(error, "Failed to upsert artifact");
			}
		},
	);

	server.tool(
		"figjam_organize_by_alias",
		"Deterministically move artifacts by alias with optional grid/column layout and metadata updates.",
		organizeByAliasInputSchema,
		async ({ aliases, layout, targetContainerId, targetGroupId, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const snapshot = fromScan(scan, "fresh");
				cache.set(keyForSnapshot(scan), snapshot);

				const moved: Array<{ alias: string; nodeId: string; from: { x?: number; y?: number }; to: { x: number; y: number } }> = [];
				const failed: Array<{ alias: string; code: string; error: string }> = [];

				for (let i = 0; i < aliases.length; i += 1) {
					const alias = aliases[i];
					const resolved = resolveAliasToNodeId(snapshot, alias);
					if (!resolved.nodeId) {
						if (!continueOnError) {
							return dbiError(resolved.code || "NOT_FOUND", "figjam_organize_by_alias", resolved.error || "Alias resolution failed", {
								alias,
							});
						}
						failed.push({ alias, code: resolved.code || "NOT_FOUND", error: resolved.error || "Alias resolution failed" });
						continue;
					}

					const entity = snapshot.entities.find((e) => e.nodeId === resolved.nodeId);
					const targetX =
						layout.mode === "grid"
							? layout.originX + (i % layout.columns) * layout.gapX
							: layout.originX;
					const targetY =
						layout.mode === "grid"
							? layout.originY + Math.floor(i / layout.columns) * layout.gapY
							: layout.originY + i * layout.gapY;

					if (!dryRun) {
						try {
							await client.moveNode({ nodeId: resolved.nodeId, x: targetX, y: targetY });
							if (targetContainerId || targetGroupId) {
								await client.updateNode({
									nodeId: resolved.nodeId,
									containerId: targetContainerId,
									groupId: targetGroupId,
								});
							}
						} catch (error) {
							const msg = error instanceof Error ? error.message : String(error);
							if (!continueOnError) {
								return dbiError("MOVE_FAILED", "figjam_organize_by_alias", msg, { alias, nodeId: resolved.nodeId });
							}
							failed.push({ alias, code: "MOVE_FAILED", error: msg });
							continue;
						}
					}

					moved.push({
						alias,
						nodeId: resolved.nodeId,
						from: { x: entity?.x, y: entity?.y },
						to: { x: targetX, y: targetY },
					});
				}

				const refreshedScan = await client.scanBoardState();
				cache.set(keyForSnapshot(refreshedScan), fromScan(refreshedScan, "fresh"));

				return ok({
					organization: {
						mode: layout.mode,
						dryRun,
						targetContainerId: targetContainerId || null,
						targetGroupId: targetGroupId || null,
						movedCount: moved.length,
						failedCount: failed.length,
						moved,
						failed,
					},
				});
			} catch (error) {
				return fail(error, "Failed to organize artifacts by alias");
			}
		},
	);

	server.tool(
		"figjam_validate_board_index",
		"Validate deterministic board index integrity and produce visual validation targets.",
		validateBoardIndexInputSchema,
		async ({ requiredAliases, requireUniqueAliases, requireResolvedConnectorEndpoints, maxVisualTargets }) => {
			try {
				const client = await getClient();
				const scan = await client.scanBoardState();
				const snapshot = fromScan(scan, "fresh");
				cache.set(keyForSnapshot(scan), snapshot);

				const issues: Array<{ code: string; severity: "error" | "warning"; message: string; details?: unknown }> = [];

				if (requireUniqueAliases && snapshot.collisions.length > 0) {
					for (const collision of snapshot.collisions) {
						issues.push({
							code: "ALIAS_CONFLICT",
							severity: "error",
							message: `Alias collision: ${collision.alias}`,
							details: collision,
						});
					}
				}

				if (Array.isArray(requiredAliases)) {
					for (const alias of requiredAliases) {
						if (!snapshot.aliases[alias]) {
							issues.push({
								code: "REQUIRED_ALIAS_MISSING",
								severity: "error",
								message: `Required alias missing: ${alias}`,
							});
						}
					}
				}

				if (requireResolvedConnectorEndpoints) {
					const connectors = snapshot.entities.filter((e) => e.entityType === "connector");
					for (const connector of connectors) {
						const start = connector.connectorStart?.endpointNodeId;
						const end = connector.connectorEnd?.endpointNodeId;
						if (!start || !end) {
							issues.push({
								code: "CONNECTOR_ENDPOINT_MISSING",
								severity: "warning",
								message: `Connector ${connector.nodeId} has unresolved endpoint`,
								details: { connectorId: connector.nodeId, start, end },
							});
						}
					}
				}

				const visualTargets = snapshot.entities
					.filter((e) => e.entityType !== "connector")
					.slice(0, maxVisualTargets)
					.map((e) => ({
						nodeId: e.nodeId,
						reason: e.alias ? `alias:${e.alias}` : e.name || e.nodeType,
						suggestedTool: "figma_take_screenshot",
						suggestedArgs: { nodeId: e.nodeId, scale: 2, format: "png" },
					}));

				return ok({
					validation: {
						passed: issues.filter((i) => i.severity === "error").length === 0,
						issueCount: issues.length,
						errorCount: issues.filter((i) => i.severity === "error").length,
						warningCount: issues.filter((i) => i.severity === "warning").length,
						issues,
						visualTargets,
					},
				});
			} catch (error) {
				return fail(error, "Failed to validate board index");
			}
		},
	);
}
