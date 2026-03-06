import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FigJamNodeSummary } from "../figjam-api/figjamClient.js";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { ok, fail } from "../server/figjam-tooling.js";

const NODE_TYPES = ["STICKY", "TEXT", "SHAPE_WITH_TEXT", "CONNECTOR", "SECTION"] as const;

const bulkCreateStickiesInputSchema = {
	items: z
		.array(
			z.object({
				text: z.string().min(1).max(2000),
				x: z.number().optional(),
				y: z.number().optional(),
			}),
		)
		.min(1)
		.max(500),
	placement: z
		.object({
			mode: z.enum(["as_provided", "grid"]).default("as_provided"),
			originX: z.number().default(0),
			originY: z.number().default(0),
			columns: z.number().int().min(1).max(50).default(5),
			gapX: z.number().min(0).default(32),
			gapY: z.number().min(0).default(32),
		})
		.optional(),
	continueOnError: z.boolean().default(true),
};

const findNodesInputSchema = {
	query: z.string().max(200).optional(),
	filters: z
		.object({
			types: z.array(z.enum(NODE_TYPES)).optional(),
			bbox: z
				.object({
					x: z.number(),
					y: z.number(),
					width: z.number().positive(),
					height: z.number().positive(),
				})
				.optional(),
		})
		.optional(),
	sort: z.enum(["relevance", "x", "y"]).default("relevance"),
	limit: z.number().int().min(1).max(1000).default(100),
	offset: z.number().int().min(0).default(0),
};

const createClusterInputSchema = {
	title: z.string().min(1).max(200),
	items: z
		.array(
			z.object({
				text: z.string().min(1).max(2000),
			}),
		)
		.min(1)
		.max(300),
	origin: z.object({
		x: z.number(),
		y: z.number(),
	}),
	layout: z
		.object({
			mode: z.enum(["grid", "column"]).default("grid"),
			columns: z.number().int().min(1).max(20).default(4),
			gapX: z.number().min(0).default(24),
			gapY: z.number().min(0).default(24),
			padding: z.number().min(0).default(48),
		})
		.default({}),
	connectSequentially: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

const summarizeBoardInputSchema = {
	scope: z
		.object({
			bbox: z
				.object({
					x: z.number(),
					y: z.number(),
					width: z.number().positive(),
					height: z.number().positive(),
				})
				.optional(),
		})
		.optional(),
	groupBy: z.enum(["type", "none"]).default("type"),
	includeSampleNodes: z.boolean().default(true),
	sampleLimit: z.number().int().min(1).max(50).default(10),
};

const autoLayoutBoardInputSchema = {
	mode: z.enum(["grid", "compact", "swimlanes"]),
	targets: z
		.object({
			nodeIds: z.array(z.string()).optional(),
			bbox: z
				.object({
					x: z.number(),
					y: z.number(),
					width: z.number().positive(),
					height: z.number().positive(),
				})
				.optional(),
		})
		.optional(),
	params: z
		.object({
			columns: z.number().int().min(1).max(20).default(5),
			gapX: z.number().min(0).default(32),
			gapY: z.number().min(0).default(32),
			originX: z.number().default(0),
			originY: z.number().default(0),
		})
		.default({}),
	dryRun: z.boolean().default(false),
	continueOnError: z.boolean().default(true),
};

type FlatNode = FigJamNodeSummary & {
	connectorStart?: { endpointNodeId?: string } | null;
	connectorEnd?: { endpointNodeId?: string } | null;
};

function flattenNodes(nodes: FigJamNodeSummary[]): FlatNode[] {
	const out: FlatNode[] = [];
	const walk = (node: any) => {
		out.push(node as FlatNode);
		if (Array.isArray(node.children)) {
			for (const child of node.children) walk(child);
		}
	};
	for (const n of nodes) walk(n);
	return out;
}

function textForNode(node: FlatNode): string {
	if (typeof node.text === "string") return node.text;
	if (typeof node.name === "string") return node.name;
	return "";
}

function inBbox(
	node: Pick<FlatNode, "x" | "y" | "width" | "height">,
	bbox: { x: number; y: number; width: number; height: number },
): boolean {
	if (typeof node.x !== "number" || typeof node.y !== "number") return false;
	const nodeW = typeof node.width === "number" ? node.width : 0;
	const nodeH = typeof node.height === "number" ? node.height : 0;
	const ax1 = node.x;
	const ay1 = node.y;
	const ax2 = node.x + nodeW;
	const ay2 = node.y + nodeH;
	const bx1 = bbox.x;
	const by1 = bbox.y;
	const bx2 = bbox.x + bbox.width;
	const by2 = bbox.y + bbox.height;
	return ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1;
}

function sortByPosition(nodes: FlatNode[]): FlatNode[] {
	return [...nodes].sort((a, b) => {
		const ay = typeof a.y === "number" ? a.y : Number.POSITIVE_INFINITY;
		const by = typeof b.y === "number" ? b.y : Number.POSITIVE_INFINITY;
		if (ay !== by) return ay - by;
		const ax = typeof a.x === "number" ? a.x : Number.POSITIVE_INFINITY;
		const bx = typeof b.x === "number" ? b.x : Number.POSITIVE_INFINITY;
		if (ax !== bx) return ax - bx;
		return a.id.localeCompare(b.id);
	});
}

function relevanceScore(node: FlatNode, queryLc: string): number {
	const text = textForNode(node).toLowerCase();
	if (!text || !queryLc) return 0;
	if (text === queryLc) return 300;
	if (text.startsWith(queryLc)) return 200;
	if (text.includes(queryLc)) return 100;
	return 0;
}

function workflowError(code: string, tool: string, message: string, details?: unknown) {
	return {
		error: {
			code,
			tool,
			message,
			details,
		},
	};
}

export function registerWorkflowTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"bulkCreateStickies",
		"Create many FigJam stickies in one call with deterministic placement.",
		bulkCreateStickiesInputSchema,
		async ({ items, placement, continueOnError }) => {
			try {
				const client = await getClient();
				const mode = placement?.mode ?? "as_provided";
				const originX = placement?.originX ?? 0;
				const originY = placement?.originY ?? 0;
				const columns = placement?.columns ?? 5;
				const gapX = placement?.gapX ?? 32;
				const gapY = placement?.gapY ?? 32;

				const created: Array<{ index: number; id: string; text: string; x?: number; y?: number }> = [];
				const failed: Array<{
					index: number;
					input: { text: string; x?: number; y?: number };
					error: string;
				}> = [];

				for (let i = 0; i < items.length; i += 1) {
					const item = items[i];
					const x =
						mode === "grid"
							? originX + (i % columns) * gapX
							: typeof item.x === "number"
								? item.x
								: undefined;
					const y =
						mode === "grid"
							? originY + Math.floor(i / columns) * gapY
							: typeof item.y === "number"
								? item.y
								: undefined;

					try {
						const sticky = await client.createSticky({ text: item.text, x, y });
						created.push({ index: i, id: sticky.id, text: item.text, x: sticky.x, y: sticky.y });
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								...fail(error, "Failed to create stickies in batch"),
								content: [
									{
										type: "text",
										text: JSON.stringify(
											workflowError(
												"PARTIAL_FAILURE",
												"bulkCreateStickies",
												`Batch stopped at index ${i}`,
												{ index: i, error: msg },
											),
										),
									},
								],
							};
						}
						failed.push({ index: i, input: item, error: msg });
					}
				}

				return ok({
					created,
					failed,
					summary: {
						requested: items.length,
						created: created.length,
						failed: failed.length,
					},
				});
			} catch (error) {
				return fail(error, "Failed to run bulkCreateStickies");
			}
		},
	);

	server.tool(
		"findNodes",
		"Find FigJam nodes by query and deterministic filters.",
		findNodesInputSchema,
		async ({ query, filters, sort, limit, offset }) => {
			try {
				const client = await getClient();
				const nodes = flattenNodes(await client.getBoardNodes());
				const queryLc = (query || "").toLowerCase();

				let filtered = nodes;
				if (filters?.types?.length) {
					const set = new Set(filters.types);
					filtered = filtered.filter((n) => set.has(n.type as (typeof NODE_TYPES)[number]));
				}
				if (filters?.bbox) {
					filtered = filtered.filter((n) => inBbox(n, filters.bbox!));
				}
				if (queryLc) {
					filtered = filtered.filter((n) => textForNode(n).toLowerCase().includes(queryLc));
				}

				if (sort === "x") {
					filtered = [...filtered].sort((a, b) => {
						const ax = typeof a.x === "number" ? a.x : Number.POSITIVE_INFINITY;
						const bx = typeof b.x === "number" ? b.x : Number.POSITIVE_INFINITY;
						if (ax !== bx) return ax - bx;
						return a.id.localeCompare(b.id);
					});
				} else if (sort === "y") {
					filtered = sortByPosition(filtered);
				} else {
					filtered = [...filtered].sort((a, b) => {
						const ra = relevanceScore(a, queryLc);
						const rb = relevanceScore(b, queryLc);
						if (ra !== rb) return rb - ra;
						const ay = typeof a.y === "number" ? a.y : Number.POSITIVE_INFINITY;
						const by = typeof b.y === "number" ? b.y : Number.POSITIVE_INFINITY;
						if (ay !== by) return ay - by;
						const ax = typeof a.x === "number" ? a.x : Number.POSITIVE_INFINITY;
						const bx = typeof b.x === "number" ? b.x : Number.POSITIVE_INFINITY;
						if (ax !== bx) return ax - bx;
						return a.id.localeCompare(b.id);
					});
				}

				const page = filtered.slice(offset, offset + limit);
				return ok({
					nodes: page,
					summary: {
						totalMatched: filtered.length,
						returned: page.length,
						limit,
						offset,
					},
				});
			} catch (error) {
				return fail(error, "Failed to run findNodes");
			}
		},
	);

	server.tool(
		"createCluster",
		"Create a titled FigJam cluster (section + notes + optional connectors).",
		createClusterInputSchema,
		async ({ title, items, origin, layout, connectSequentially, continueOnError }) => {
			try {
				const client = await getClient();
				const mode = layout.mode ?? "grid";
				const columns = layout.columns ?? 4;
				const gapX = layout.gapX ?? 24;
				const gapY = layout.gapY ?? 24;
				const padding = layout.padding ?? 48;

				const stickyWidth = 220;
				const stickyHeight = 140;
				const titleOffsetY = 52;
				const rowCount =
					mode === "column" ? items.length : Math.ceil(items.length / Math.max(1, columns));
				const colCount = mode === "column" ? 1 : Math.max(1, Math.min(columns, items.length));
				const clusterWidth = padding * 2 + colCount * stickyWidth + (colCount - 1) * gapX;
				const clusterHeight =
					padding * 2 + titleOffsetY + rowCount * stickyHeight + (rowCount - 1) * gapY;

				const failed: Array<{
					step: "createSection" | "createTitle" | "createSticky" | "createConnector";
					index?: number;
					error: string;
				}> = [];
				const stickyIds: string[] = [];
				const connectorIds: string[] = [];
				let sectionId: string | undefined;
				let titleNodeId: string | undefined;

				try {
					const section = await client.createSection({
						name: title,
						x: origin.x,
						y: origin.y,
						width: clusterWidth,
						height: clusterHeight,
					});
					sectionId = section.id;
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (!continueOnError) {
						return fail(error, "Failed to create cluster section");
					}
					failed.push({ step: "createSection", error: msg });
				}

				try {
					const titleNode = await client.createText({
						text: title,
						x: origin.x + padding,
						y: origin.y + 12,
						fontSize: 28,
					});
					titleNodeId = titleNode.id;
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (!continueOnError) {
						return fail(error, "Failed to create cluster title");
					}
					failed.push({ step: "createTitle", error: msg });
				}

				for (let i = 0; i < items.length; i += 1) {
					const item = items[i];
					const col = mode === "column" ? 0 : i % columns;
					const row = mode === "column" ? i : Math.floor(i / columns);
					const x = origin.x + padding + col * (stickyWidth + gapX);
					const y = origin.y + padding + titleOffsetY + row * (stickyHeight + gapY);

					try {
						const sticky = await client.createSticky({
							text: item.text,
							x,
							y,
							width: stickyWidth,
							height: stickyHeight,
						});
						stickyIds.push(sticky.id);
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return fail(error, "Failed while creating cluster stickies");
						}
						failed.push({ step: "createSticky", index: i, error: msg });
					}
				}

				if (connectSequentially && stickyIds.length > 1) {
					for (let i = 1; i < stickyIds.length; i += 1) {
						try {
							const connector = await client.createConnector({
								fromNodeId: stickyIds[i - 1],
								toNodeId: stickyIds[i],
							});
							connectorIds.push(connector.id);
						} catch (error) {
							const msg = error instanceof Error ? error.message : String(error);
							if (!continueOnError) {
								return fail(error, "Failed while creating cluster connectors");
							}
							failed.push({ step: "createConnector", index: i - 1, error: msg });
						}
					}
				}

				return ok({
					cluster: {
						sectionId,
						titleNodeId,
						stickyIds,
						connectorIds,
					},
					failed,
					summary: {
						requestedStickies: items.length,
						createdStickies: stickyIds.length,
						createdConnectors: connectorIds.length,
						failedOps: failed.length,
					},
				});
			} catch (error) {
				return fail(error, "Failed to run createCluster");
			}
		},
	);

	server.tool(
		"summarizeBoard",
		"Return deterministic structural summary of the current FigJam board.",
		summarizeBoardInputSchema,
		async ({ scope, groupBy, includeSampleNodes, sampleLimit }) => {
			try {
				const client = await getClient();
				const allNodes = flattenNodes(await client.getBoardNodes());
				const stickies = await client.getStickies();
				const connections = await client.getConnections();

				const scopedNodes = scope?.bbox ? allNodes.filter((n) => inBbox(n, scope.bbox!)) : allNodes;
				const scopedStickies = scope?.bbox ? stickies.filter((n) => inBbox(n, scope.bbox!)) : stickies;

				const byType: Record<string, number> = {};
				for (const n of scopedNodes) byType[n.type] = (byType[n.type] || 0) + 1;

				const stickyIdSet = new Set(scopedStickies.map((s) => s.id));
				const connectedStickyIds = new Set<string>();
				for (const c of connections) {
					const startId = (c as any)?.connectorStart?.endpointNodeId;
					const endId = (c as any)?.connectorEnd?.endpointNodeId;
					if (typeof startId === "string" && stickyIdSet.has(startId)) connectedStickyIds.add(startId);
					if (typeof endId === "string" && stickyIdSet.has(endId)) connectedStickyIds.add(endId);
				}

				const samples = includeSampleNodes
					? sortByPosition(scopedNodes).slice(0, sampleLimit).map((n) => ({
							id: n.id,
							type: n.type,
							text: typeof n.text === "string" ? n.text : undefined,
							x: n.x,
							y: n.y,
						}))
					: undefined;

				const payload: Record<string, unknown> = {
					counts: {
						total: scopedNodes.length,
						byType: groupBy === "type" ? byType : {},
						stickies: byType.STICKY || 0,
						connectors: byType.CONNECTOR || 0,
						sections: byType.SECTION || 0,
						texts: byType.TEXT || 0,
						shapes: byType.SHAPE_WITH_TEXT || 0,
					},
					connectivity: {
						connectorCount: byType.CONNECTOR || 0,
						stickyCount: scopedStickies.length,
						connectedStickyIds: connectedStickyIds.size,
						orphanStickies: Math.max(0, scopedStickies.length - connectedStickyIds.size),
					},
				};
				if (samples) payload.samples = samples;
				return ok(payload);
			} catch (error) {
				return fail(error, "Failed to run summarizeBoard");
			}
		},
	);

	server.tool(
		"autoLayoutBoard",
		"Apply deterministic board layout transforms to FigJam nodes.",
		autoLayoutBoardInputSchema,
		async ({ mode, targets, params, dryRun, continueOnError }) => {
			try {
				const client = await getClient();
				const allNodes = flattenNodes(await client.getBoardNodes());
				const nodeIdSet = targets?.nodeIds ? new Set(targets.nodeIds) : null;
				const targetNodes = allNodes.filter((n) => {
					if (!["STICKY", "TEXT", "SHAPE_WITH_TEXT"].includes(n.type)) return false;
					if (nodeIdSet && !nodeIdSet.has(n.id)) return false;
					if (targets?.bbox && !inBbox(n, targets.bbox)) return false;
					return true;
				});

				const sorted = sortByPosition(targetNodes);
				const columns = params.columns ?? 5;
				const gapX = params.gapX ?? 32;
				const gapY = params.gapY ?? 32;
				const originX = params.originX ?? 0;
				const originY = params.originY ?? 0;

				const planned: Array<{ id: string; to: { x: number; y: number } }> = [];
				if (mode === "swimlanes") {
					const lanes = new Map<string, FlatNode[]>();
					for (const node of sorted) {
						const key = node.type;
						if (!lanes.has(key)) lanes.set(key, []);
						lanes.get(key)!.push(node);
					}
					let laneIndex = 0;
					for (const laneType of ["STICKY", "SHAPE_WITH_TEXT", "TEXT"]) {
						const laneNodes = lanes.get(laneType) || [];
						for (let i = 0; i < laneNodes.length; i += 1) {
							planned.push({
								id: laneNodes[i].id,
								to: { x: originX + i * gapX, y: originY + laneIndex * gapY * 2 },
							});
						}
						if (laneNodes.length > 0) laneIndex += 1;
					}
				} else {
					for (let i = 0; i < sorted.length; i += 1) {
						const col = i % columns;
						const row = Math.floor(i / columns);
						planned.push({
							id: sorted[i].id,
							to: {
								x: originX + col * gapX,
								y: originY + row * (mode === "compact" ? Math.max(16, gapY * 0.75) : gapY),
							},
						});
					}
				}

				const moved: Array<{ id: string; from: { x?: number; y?: number }; to: { x: number; y: number } }> = [];
				const skipped: Array<{ id: string; reason: string }> = [];
				const failed: Array<{ id: string; error: string }> = [];
				const nodeById = new Map(sorted.map((n) => [n.id, n]));

				for (const p of planned) {
					const original = nodeById.get(p.id);
					if (!original) {
						skipped.push({ id: p.id, reason: "Node not found in target set" });
						continue;
					}

					if (dryRun) {
						moved.push({ id: p.id, from: { x: original.x, y: original.y }, to: p.to });
						continue;
					}

					try {
						await client.moveNode({ nodeId: p.id, x: p.to.x, y: p.to.y });
						moved.push({ id: p.id, from: { x: original.x, y: original.y }, to: p.to });
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							return {
								...fail(error, "Failed during autoLayoutBoard"),
								content: [
									{
										type: "text",
										text: JSON.stringify(
											workflowError(
												"PARTIAL_FAILURE",
												"autoLayoutBoard",
												`Layout stopped at node ${p.id}`,
												{ nodeId: p.id, error: msg },
											),
										),
									},
								],
							};
						}
						failed.push({ id: p.id, error: msg });
					}
				}

				return ok({
					mode,
					dryRun,
					moved,
					skipped,
					failed,
					summary: {
						evaluated: sorted.length,
						moved: moved.length,
						skipped: skipped.length,
						failed: failed.length,
					},
				});
			} catch (error) {
				return fail(error, "Failed to run autoLayoutBoard");
			}
		},
	);
}
