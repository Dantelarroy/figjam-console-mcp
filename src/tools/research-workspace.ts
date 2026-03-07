import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FigJamClient, FigJamNodeSummary } from "../figjam-api/figjamClient.js";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { fail, ok } from "../server/figjam-tooling.js";
import { createLinkWithImageFallback } from "./link-fallback.js";

type FlatNode = FigJamNodeSummary & {
	connectorStart?: { endpointNodeId?: string } | null;
	connectorEnd?: { endpointNodeId?: string } | null;
};

const KIND_ORDER = ["paper", "article", "interview", "report", "dataset", "other"] as const;

const ingestResearchNotesInputSchema = {
	notes: z
		.array(
			z.object({
				text: z.string().min(1).max(4000),
				source: z.string().min(1).max(500).optional(),
				type: z.enum(["insight", "quote", "observation", "question"]).default("insight"),
				tags: z.array(z.string().min(1).max(80)).max(20).default([]),
				confidence: z.number().min(0).max(1).optional(),
			}),
		)
		.min(1)
		.max(1000),
	placement: z
		.object({
			mode: z.enum(["grid", "column"]).default("grid"),
			originX: z.number().default(0),
			originY: z.number().default(0),
			columns: z.number().int().min(1).max(20).default(4),
			gapX: z.number().min(0).default(240),
			gapY: z.number().min(0).default(180),
		})
		.default({}),
	formatting: z
		.object({
			includeMetadataPrefix: z.boolean().default(true),
			metadataOrder: z
				.array(z.enum(["type", "source", "confidence", "tags"]))
				.default(["type", "source", "confidence", "tags"]),
		})
		.default({}),
	dedupe: z
		.object({
			enabled: z.boolean().default(false),
			scope: z.enum(["board", "batch"]).default("batch"),
			caseSensitive: z.boolean().default(false),
		})
		.default({}),
	continueOnError: z.boolean().default(true),
};

const createReferenceWallInputSchema = {
	title: z.string().min(1).max(200).default("Reference Wall"),
	references: z
		.array(
			z.object({
				label: z.string().min(1).max(500),
				url: z.string().url().optional(),
				source: z.string().max(500).optional(),
				kind: z
					.enum(["paper", "article", "interview", "report", "dataset", "other"])
					.default("other"),
				notes: z.string().max(2000).optional(),
				tags: z.array(z.string().min(1).max(80)).max(20).default([]),
			}),
		)
		.min(1)
		.max(500),
	origin: z.object({
		x: z.number(),
		y: z.number(),
	}),
	layout: z
		.object({
			mode: z.enum(["columns_by_kind", "single_grid"]).default("columns_by_kind"),
			columnGap: z.number().min(0).default(460),
			rowGap: z.number().min(0).default(320),
			sectionPadding: z.number().min(0).default(56),
		})
		.default({}),
	continueOnError: z.boolean().default(true),
};

const organizeByThemeInputSchema = {
	themes: z
		.array(
			z.object({
				name: z.string().min(1).max(200),
				description: z.string().max(1000).optional(),
				noteRefs: z
					.array(
						z
							.object({
								nodeId: z.string().min(1).optional(),
								query: z.string().min(1).max(300).optional(),
							})
							.refine((v) => Boolean(v.nodeId || v.query), {
								message: "Each noteRef requires nodeId or query",
							}),
					)
					.min(1)
					.max(500),
			}),
		)
		.min(1)
		.max(50),
	origin: z.object({
		x: z.number(),
		y: z.number(),
	}),
	layout: z
		.object({
			mode: z.enum(["grid", "column"]).default("grid"),
			columns: z.number().int().min(1).max(10).default(3),
			gapX: z.number().min(0).default(420),
			gapY: z.number().min(0).default(320),
		})
		.default({}),
	unresolvedPolicy: z.enum(["skip", "fail"]).default("skip"),
	continueOnError: z.boolean().default(true),
};

const linkByRelationInputSchema = {
	links: z
		.array(
			z.object({
				from: z
					.object({
						nodeId: z.string().min(1).optional(),
						query: z.string().min(1).max(300).optional(),
					})
					.refine((v) => Boolean(v.nodeId || v.query), {
						message: "from requires nodeId or query",
					}),
				to: z
					.object({
						nodeId: z.string().min(1).optional(),
						query: z.string().min(1).max(300).optional(),
					})
					.refine((v) => Boolean(v.nodeId || v.query), {
						message: "to requires nodeId or query",
					}),
				relation: z.enum(["supports", "contradicts", "duplicates", "depends_on", "related"]),
				label: z.string().max(120).optional(),
			}),
		)
		.min(1)
		.max(1000),
	dedupeExisting: z.boolean().default(true),
	continueOnError: z.boolean().default(true),
};

const generateResearchBoardInputSchema = {
	title: z.string().min(1).max(200),
	runId: z.string().min(1).max(120).optional(),
	origin: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
	notes: z
		.array(
			z.object({
				text: z.string().min(1).max(4000),
				source: z.string().max(500).optional(),
				type: z.enum(["insight", "quote", "observation", "question"]).default("insight"),
				tags: z.array(z.string().min(1).max(80)).max(20).default([]),
				confidence: z.number().min(0).max(1).optional(),
			}),
		)
		.default([]),
	references: z
		.array(
			z.object({
				label: z.string().min(1).max(500),
				url: z.string().url().optional(),
				kind: z
					.enum(["paper", "article", "interview", "report", "dataset", "other"])
					.default("other"),
				notes: z.string().max(2000).optional(),
				tags: z.array(z.string().min(1).max(80)).max(20).default([]),
			}),
		)
		.default([]),
	themes: z
		.array(
			z.object({
				name: z.string().min(1).max(200),
				noteQueries: z.array(z.string().min(1).max(300)).default([]),
			}),
		)
		.default([]),
	createLinks: z.boolean().default(false),
	dryRunLayout: z.boolean().default(true),
	executionMode: z.enum(["sync_small", "job"]).optional(),
	dedupePolicy: z.enum(["by_url", "by_title", "strict"]).default("by_url"),
	layoutPolicy: z.enum(["auto_expand", "strict"]).default("auto_expand"),
	continueOnError: z.boolean().default(true),
};

function normalizeForCompare(value: string, caseSensitive: boolean): string {
	const trimmed = value.trim();
	return caseSensitive ? trimmed : trimmed.toLowerCase();
}

function flattenNodes(nodes: FigJamNodeSummary[]): FlatNode[] {
	const out: FlatNode[] = [];
	const walk = (node: any) => {
		out.push(node as FlatNode);
		if (Array.isArray(node.children)) {
			for (const child of node.children) walk(child);
		}
	};
	for (const node of nodes) walk(node);
	return out;
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
	const w = typeof node.width === "number" ? node.width : 0;
	const h = typeof node.height === "number" ? node.height : 0;
	const ax1 = node.x;
	const ay1 = node.y;
	const ax2 = node.x + w;
	const ay2 = node.y + h;
	const bx1 = bbox.x;
	const by1 = bbox.y;
	const bx2 = bbox.x + bbox.width;
	const by2 = bbox.y + bbox.height;
	return ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1;
}

function renderReferenceText(ref: {
	label: string;
	url?: string;
	source?: string;
	notes?: string;
	tags: string[];
}) {
	const lines = [
		ref.label,
		ref.url || null,
		ref.source ? `Source: ${ref.source}` : null,
		ref.notes || null,
		ref.tags.length ? `Tags: ${ref.tags.join(", ")}` : null,
	].filter(Boolean) as string[];
	return lines.join("\n");
}

function renderResearchNoteText(
	note: {
		text: string;
		source?: string;
		type: "insight" | "quote" | "observation" | "question";
		tags: string[];
		confidence?: number;
	},
	formatting: {
		includeMetadataPrefix: boolean;
		metadataOrder: Array<"type" | "source" | "confidence" | "tags">;
	},
): string {
	if (!formatting.includeMetadataPrefix) {
		return note.text;
	}
	const parts: string[] = [];
	for (const key of formatting.metadataOrder) {
		if (key === "type") parts.push(`type:${note.type}`);
		if (key === "source" && note.source) parts.push(`source:${note.source}`);
		if (key === "confidence" && typeof note.confidence === "number") {
			parts.push(`confidence:${note.confidence.toFixed(2)}`);
		}
		if (key === "tags" && note.tags.length > 0) {
			parts.push(`tags:${note.tags.join(",")}`);
		}
	}
	if (parts.length === 0) return note.text;
	return `[${parts.join(" | ")}]\n${note.text}`;
}

function relationKey(fromNodeId: string, toNodeId: string, relation: string): string {
	return `${fromNodeId}=>${toNodeId}::${relation}`;
}

function toSlug(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
}

type ResearchJobPhase =
	| "queued"
	| "scaffold"
	| "ingestResearchNotes"
	| "createReferenceWall"
	| "organizeByTheme"
	| "linkByRelation"
	| "autoLayoutBoard"
	| "completed"
	| "failed"
	| "cancelled";

type ResearchJobRecord = {
	jobId: string;
	runId: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	phase: ResearchJobPhase;
	startedAt: string;
	endedAt?: string;
	progress: { totalItems: number; processedItems: number };
	phaseDurations: Record<string, number>;
	args: z.infer<z.ZodObject<typeof generateResearchBoardInputSchema>>;
	result?: Record<string, unknown>;
	error?: { code: string; message: string };
	cancelRequested: boolean;
	runner?: () => Promise<void>;
};

const RESEARCH_JOB_TTL_MS = 1000 * 60 * 60;
const RESEARCH_JOB_MAX = 200;
const RESEARCH_JOBS = new Map<string, ResearchJobRecord>();

function nowIso(): string {
	return new Date().toISOString();
}

function randomId(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function cleanupOldJobs() {
	const now = Date.now();
	for (const [id, job] of RESEARCH_JOBS.entries()) {
		const endedAt = job.endedAt ? Date.parse(job.endedAt) : null;
		if (endedAt && now - endedAt > RESEARCH_JOB_TTL_MS) {
			RESEARCH_JOBS.delete(id);
		}
	}
	if (RESEARCH_JOBS.size <= RESEARCH_JOB_MAX) return;
	const sorted = [...RESEARCH_JOBS.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
	for (const item of sorted.slice(0, RESEARCH_JOBS.size - RESEARCH_JOB_MAX)) {
		RESEARCH_JOBS.delete(item.jobId);
	}
}

function isSectionUnsupportedError(message: string): boolean {
	const lower = message.toLowerCase();
	return lower.includes("sections are not available") || lower.includes("not a function");
}

async function resolveRef(
	allNodes: FlatNode[],
	ref: { nodeId?: string; query?: string },
): Promise<{ node: FlatNode | null; reason?: string }> {
	if (ref.nodeId) {
		const byId = allNodes.find((n) => n.id === ref.nodeId) || null;
		return byId ? { node: byId } : { node: null, reason: `Node not found: ${ref.nodeId}` };
	}
	if (ref.query) {
		const q = ref.query.toLowerCase();
		const candidates = sortByPosition(
			allNodes.filter((n) => textForNode(n).toLowerCase().includes(q)),
		);
		if (candidates.length > 0) return { node: candidates[0] };
		return { node: null, reason: `No node matched query: ${ref.query}` };
	}
	return { node: null, reason: "Missing nodeId/query" };
}

function normalizeForKey(value?: string | null): string {
	return (value || "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ")
		.slice(0, 240);
}

function createReferenceItemKey(
	item: { label: string; url?: string; kind?: string },
	dedupePolicy: "by_url" | "by_title" | "strict",
): string {
	const title = normalizeForKey(item.label);
	const url = normalizeForKey(item.url);
	const kind = normalizeForKey(item.kind);
	if (dedupePolicy === "by_title") return `t:${title}`;
	if (dedupePolicy === "strict") return `u:${url}|t:${title}|k:${kind}`;
	return `u:${url || `t:${title}`}`;
}

async function ingestResearchNotesInternal(
	client: FigJamClient,
	args: z.infer<z.ZodObject<typeof ingestResearchNotesInputSchema>>,
) {
	const { notes, placement, formatting, dedupe, continueOnError } = args;
	const created: Array<{
		index: number;
		id: string;
		renderedText: string;
		source?: string;
		type: "insight" | "quote" | "observation" | "question";
		x?: number;
		y?: number;
	}> = [];
	const skipped: Array<{ index: number; reason: "duplicate" }> = [];
	const failed: Array<{ index: number; error: string }> = [];

	const seen = new Set<string>();
	if (dedupe.enabled && dedupe.scope === "board") {
		const existingNodes = flattenNodes(await client.getBoardNodes());
		for (const node of existingNodes) {
			const t = textForNode(node);
			if (t) seen.add(normalizeForCompare(t, dedupe.caseSensitive));
		}
	}

	const columns = placement.mode === "column" ? 1 : placement.columns;
	for (let i = 0; i < notes.length; i += 1) {
		const note = notes[i];
		const renderedText = renderResearchNoteText(note, formatting);
		const key = normalizeForCompare(renderedText, dedupe.caseSensitive);

		if (dedupe.enabled && seen.has(key)) {
			skipped.push({ index: i, reason: "duplicate" });
			continue;
		}

		const x = placement.originX + (i % columns) * placement.gapX;
		const y = placement.originY + Math.floor(i / columns) * placement.gapY;
		try {
			const sticky = await client.createSticky({ text: renderedText, x, y });
			created.push({
				index: i,
				id: sticky.id,
				renderedText,
				source: note.source,
				type: note.type,
				x: sticky.x,
				y: sticky.y,
			});
			if (dedupe.enabled) seen.add(key);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (!continueOnError) {
				throw new Error(`ingestResearchNotes failed at index ${i}: ${msg}`);
			}
			failed.push({ index: i, error: msg });
		}
	}

	return {
		created,
		skipped,
		failed,
		summary: {
			requested: notes.length,
			created: created.length,
			skipped: skipped.length,
			failed: failed.length,
		},
	};
}

async function createReferenceWallInternal(
	client: FigJamClient,
	args: z.infer<z.ZodObject<typeof createReferenceWallInputSchema>>,
	options?: { runId?: string; dedupePolicy?: "by_url" | "by_title" | "strict" },
) {
	const { title, references, origin, layout, continueOnError } = args;
	const kindSectionIds: Record<string, string | undefined> = {};
	const referenceStickyIds: string[] = [];
	const reusedReferenceIds: string[] = [];
	const failed: Array<{
		step: "createRootSection" | "createKindSection" | "createTitle" | "createReferenceSticky";
		index?: number;
		kind?: string;
		error: string;
	}> = [];
	let rootSectionId: string | undefined;
	let titleNodeId: string | undefined;
	const runId = options?.runId;
	const dedupePolicy = options?.dedupePolicy || "by_url";
	const existingByItemKey = new Map<string, FlatNode>();
	if (runId) {
		for (const node of flattenNodes(await client.getBoardNodes())) {
			const metadataRaw = node.pluginData?.["figjam.metadata"];
			let itemKey: string | undefined;
			let metadataRunId: string | undefined;
			if (metadataRaw) {
				try {
					const parsed = JSON.parse(metadataRaw) as Record<string, unknown>;
					if (typeof parsed?.itemKey === "string") itemKey = parsed.itemKey;
					if (typeof parsed?.runId === "string") metadataRunId = parsed.runId;
				} catch {
					// Ignore invalid metadata payload.
				}
			}
			if (metadataRunId === runId && itemKey) {
				existingByItemKey.set(itemKey, node);
			}
		}
	}

	const byKind = new Map<string, typeof references>();
	for (const k of KIND_ORDER) byKind.set(k, []);
	for (const ref of references) {
		const arr = byKind.get(ref.kind) || [];
		arr.push(ref);
		byKind.set(ref.kind, arr);
	}

	const nonEmptyKindCount = KIND_ORDER.reduce((acc, kind) => acc + ((byKind.get(kind) || []).length > 0 ? 1 : 0), 0);
	try {
		const root = await client.createSection({
			name: title,
			x: origin.x,
			y: origin.y,
			width:
				layout.mode === "columns_by_kind"
					? Math.max(1600, nonEmptyKindCount * (layout.columnGap + 220) + layout.sectionPadding * 2)
					: 2200,
			height: Math.max(1200, 240 + Math.ceil(references.length / 2) * layout.rowGap),
		});
		rootSectionId = root.id;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (isSectionUnsupportedError(msg)) {
			rootSectionId = undefined;
		} else if (!continueOnError) throw new Error(`createReferenceWall root section failed: ${msg}`);
		else failed.push({ step: "createRootSection", error: msg });
	}

	try {
		const titleNode = await client.createText({ text: title, x: origin.x + 20, y: origin.y + 12, fontSize: 28 });
		titleNodeId = titleNode.id;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (!continueOnError) throw new Error(`createReferenceWall title failed: ${msg}`);
		failed.push({ step: "createTitle", error: msg });
	}

	if (layout.mode === "single_grid") {
		for (let i = 0; i < references.length; i += 1) {
			const ref = references[i];
			const rendered = renderReferenceText(ref);
			const x = origin.x + layout.sectionPadding + (i % 3) * layout.columnGap;
			const y = origin.y + 110 + Math.floor(i / 3) * layout.rowGap;
			try {
				const itemKey = createReferenceItemKey(ref, dedupePolicy);
				const existingNode = runId ? existingByItemKey.get(itemKey) : undefined;
				if (existingNode) {
					await client.moveNode({ nodeId: existingNode.id, x, y });
					await client.updateNode({
						nodeId: existingNode.id,
						role: "reference",
						sourceUrl: ref.url,
						metadata: { runId, itemKey, label: ref.label, kind: ref.kind },
					});
					referenceStickyIds.push(existingNode.id);
					reusedReferenceIds.push(existingNode.id);
					continue;
				}
				if (ref.url) {
					const linkRendered = await createLinkWithImageFallback(async () => client, {
						url: ref.url,
						title: ref.label,
						x,
						y,
						role: "reference",
						preferNative: true,
						groupId: `kind:${ref.kind}`,
					});
					await client.updateNode({
						nodeId: linkRendered.primary.id,
						sourceUrl: ref.url,
						metadata: { runId, itemKey, label: ref.label, kind: ref.kind },
					});
					referenceStickyIds.push(linkRendered.primary.id);
					if (linkRendered.imageNode?.id) referenceStickyIds.push(linkRendered.imageNode.id);
					continue;
				}
				const sticky = await client.createSticky({
					text: rendered,
					x,
					y,
					metadata: { runId, itemKey, label: ref.label, kind: ref.kind },
				});
				referenceStickyIds.push(sticky.id);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (!continueOnError) throw new Error(`createReferenceWall sticky failed at ${i}: ${msg}`);
				failed.push({ step: "createReferenceSticky", index: i, error: msg });
			}
		}
	} else {
		let kindIndex = 0;
		for (const kind of KIND_ORDER) {
			const refs = byKind.get(kind) || [];
			if (refs.length === 0) continue;
			const sectionX = origin.x + layout.sectionPadding + kindIndex * layout.columnGap;
			const sectionY = origin.y + 84;
			let kindSectionId: string | undefined;
			try {
				const kindSection = await client.createSection({
					name: kind,
					x: sectionX,
					y: sectionY,
					width: Math.max(520, layout.columnGap - 40),
					height: Math.max(360, 120 + refs.length * layout.rowGap),
				});
				kindSectionId = kindSection.id;
				kindSectionIds[kind] = kindSectionId;
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (isSectionUnsupportedError(msg)) {
					kindSectionId = undefined;
				} else if (!continueOnError) throw new Error(`createReferenceWall kind section failed for ${kind}: ${msg}`);
				else failed.push({ step: "createKindSection", kind, error: msg });
			}

			try {
				await client.createText({ text: kind.toUpperCase(), x: sectionX + 10, y: sectionY + 10, fontSize: 18 });
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (!continueOnError) throw new Error(`createReferenceWall kind title failed for ${kind}: ${msg}`);
				failed.push({ step: "createTitle", kind, error: msg });
			}

			for (let i = 0; i < refs.length; i += 1) {
				const ref = refs[i];
				const rendered = renderReferenceText(ref);
				try {
					const x = sectionX + 18;
					const y = sectionY + 54 + i * layout.rowGap;
					const itemKey = createReferenceItemKey(ref, dedupePolicy);
					const existingNode = runId ? existingByItemKey.get(itemKey) : undefined;
					if (existingNode) {
						await client.moveNode({ nodeId: existingNode.id, x, y });
						await client.updateNode({
							nodeId: existingNode.id,
							groupId: `kind:${kind}`,
							role: "reference",
							sourceUrl: ref.url,
							metadata: { runId, itemKey, label: ref.label, kind: ref.kind },
						});
						referenceStickyIds.push(existingNode.id);
						reusedReferenceIds.push(existingNode.id);
						continue;
					}
					if (ref.url) {
						const linkRendered = await createLinkWithImageFallback(async () => client, {
							url: ref.url,
							title: ref.label,
							x,
							y,
							role: "reference",
							preferNative: true,
							groupId: `kind:${kind}`,
						});
						await client.updateNode({
							nodeId: linkRendered.primary.id,
							groupId: `kind:${kind}`,
							sourceUrl: ref.url,
							metadata: { runId, itemKey, label: ref.label, kind: ref.kind },
						});
						referenceStickyIds.push(linkRendered.primary.id);
						if (linkRendered.imageNode?.id) referenceStickyIds.push(linkRendered.imageNode.id);
						continue;
					}
					const sticky = await client.createSticky({
						text: rendered,
						x,
						y,
						groupId: `kind:${kind}`,
						metadata: { runId, itemKey, label: ref.label, kind: ref.kind },
					});
					referenceStickyIds.push(sticky.id);
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (!continueOnError) throw new Error(`createReferenceWall sticky failed for ${kind}/${i}: ${msg}`);
					failed.push({ step: "createReferenceSticky", index: i, kind, error: msg });
				}
			}
			kindIndex += 1;
		}
	}

	const kindsCount: Record<string, number> = {};
	for (const k of KIND_ORDER) {
		const count = (byKind.get(k) || []).length;
		if (count > 0) kindsCount[k] = count;
	}

	return {
		wall: {
			rootSectionId,
			kindSectionIds,
			titleNodeId,
			referenceStickyIds,
		},
		failed,
		summary: {
			requested: references.length,
			created: referenceStickyIds.length,
			reused: reusedReferenceIds.length,
			failed: failed.length,
			kinds: kindsCount,
		},
	};
}

async function organizeByThemeInternal(
	client: FigJamClient,
	args: z.infer<z.ZodObject<typeof organizeByThemeInputSchema>>,
) {
	const { themes, origin, layout, unresolvedPolicy, continueOnError } = args;
	const allNodes = flattenNodes(await client.getBoardNodes());
	const themesOut: Array<{
		name: string;
		clusterSectionId?: string;
		titleNodeId?: string;
		stickyIds: string[];
		unresolvedRefs: Array<{ refIndex: number; reason: string }>;
	}> = [];
	const failed: Array<{ themeIndex: number; step: "resolveRefs" | "createCluster"; error: string }> = [];

	for (let t = 0; t < themes.length; t += 1) {
		const theme = themes[t];
		const col = layout.mode === "column" ? 0 : t % layout.columns;
		const row = layout.mode === "column" ? t : Math.floor(t / layout.columns);
		const themeX = origin.x + col * layout.gapX;
		const themeY = origin.y + row * layout.gapY;

		const unresolvedRefs: Array<{ refIndex: number; reason: string }> = [];
		const resolved: FlatNode[] = [];

		for (let r = 0; r < theme.noteRefs.length; r += 1) {
			const resolution = await resolveRef(allNodes, theme.noteRefs[r]);
			if (!resolution.node) {
				unresolvedRefs.push({ refIndex: r, reason: resolution.reason || "Unresolved" });
			} else {
				resolved.push(resolution.node);
			}
		}

		if (unresolvedPolicy === "fail" && unresolvedRefs.length > 0) {
			const msg = `Unresolved refs for theme '${theme.name}': ${unresolvedRefs.length}`;
			if (!continueOnError) throw new Error(msg);
			failed.push({ themeIndex: t, step: "resolveRefs", error: msg });
			themesOut.push({ name: theme.name, stickyIds: [], unresolvedRefs });
			continue;
		}

		let clusterSectionId: string | undefined;
		let titleNodeId: string | undefined;
		const stickyIds: string[] = [];
		try {
			try {
				const section = await client.createSection({
					name: theme.name,
					x: themeX,
					y: themeY,
					width: 520,
					height: Math.max(360, 180 + resolved.length * 320),
				});
				clusterSectionId = section.id;
			} catch {
				// Section may be unavailable in some FigJam runtimes; continue deterministically.
			}
			const titleNode = await client.createText({ text: theme.name, x: themeX + 12, y: themeY + 12, fontSize: 20 });
			titleNodeId = titleNode.id;

			const uniqueById = new Map<string, FlatNode>();
			for (const node of resolved) {
				if (node.type === "CONNECTOR" || node.type === "SECTION") continue;
				uniqueById.set(node.id, node);
			}

			const themeSlug = toSlug(theme.name) || "theme";
			let idx = 0;
			for (const node of uniqueById.values()) {
				const col = idx % 2;
				const row = Math.floor(idx / 2);
				const targetX = themeX + 20 + col * 250;
				const targetY = themeY + 64 + row * 300;
				await client.moveNode({ nodeId: node.id, x: targetX, y: targetY });
				await client.updateNode({
					nodeId: node.id,
					groupId: `theme:${themeSlug}`,
					containerId: clusterSectionId,
					role: "theme_member",
					metadata: { theme: theme.name },
				});
				stickyIds.push(node.id);
				idx += 1;
			}
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (!continueOnError) throw new Error(msg);
			failed.push({ themeIndex: t, step: "createCluster", error: msg });
		}

		themesOut.push({
			name: theme.name,
			clusterSectionId,
			titleNodeId,
			stickyIds,
			unresolvedRefs,
		});
	}

	const totalStickyAssigned = themesOut.reduce((acc, t) => acc + t.stickyIds.length, 0);
	const unresolvedCount = themesOut.reduce((acc, t) => acc + t.unresolvedRefs.length, 0);

	return {
		themes: themesOut,
		failed,
		summary: {
			requestedThemes: themes.length,
			createdThemes: themesOut.filter((t) => t.stickyIds.length > 0 || t.clusterSectionId || t.titleNodeId)
				.length,
			totalStickyAssigned,
			unresolvedRefs: unresolvedCount,
			failed: failed.length,
		},
	};
}

async function linkByRelationInternal(
	client: FigJamClient,
	args: z.infer<z.ZodObject<typeof linkByRelationInputSchema>>,
) {
	const { links, dedupeExisting, continueOnError } = args;
	const allNodes = flattenNodes(await client.getBoardNodes());
	const existingConnections = await client.getConnections();
	const existing = new Set<string>();
	if (dedupeExisting) {
		for (const conn of existingConnections) {
			const fromNodeId = (conn as any)?.connectorStart?.endpointNodeId;
			const toNodeId = (conn as any)?.connectorEnd?.endpointNodeId;
			if (typeof fromNodeId === "string" && typeof toNodeId === "string") {
				existing.add(relationKey(fromNodeId, toNodeId, "related"));
			}
		}
	}

	const created: Array<{
		index: number;
		connectorId: string;
		fromNodeId: string;
		toNodeId: string;
		relation: "supports" | "contradicts" | "duplicates" | "depends_on" | "related";
	}> = [];
	const skipped: Array<{ index: number; reason: "duplicate_link" | "unresolved_endpoint" }> = [];
	const failed: Array<{ index: number; error: string }> = [];

	for (let i = 0; i < links.length; i += 1) {
		const link = links[i];
		const from = await resolveRef(allNodes, link.from);
		const to = await resolveRef(allNodes, link.to);
		if (!from.node || !to.node) {
			skipped.push({ index: i, reason: "unresolved_endpoint" });
			continue;
		}

		const dedupeKey = relationKey(from.node.id, to.node.id, dedupeExisting ? "related" : link.relation);
		if (dedupeExisting && existing.has(dedupeKey)) {
			skipped.push({ index: i, reason: "duplicate_link" });
			continue;
		}

		try {
			const connector = await client.createConnector({ fromNodeId: from.node.id, toNodeId: to.node.id });
			created.push({
				index: i,
				connectorId: connector.id,
				fromNodeId: from.node.id,
				toNodeId: to.node.id,
				relation: link.relation,
			});
			existing.add(dedupeKey);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (!continueOnError) throw new Error(`linkByRelation failed at index ${i}: ${msg}`);
			failed.push({ index: i, error: msg });
		}
	}

	return {
		created,
		skipped,
		failed,
		summary: {
			requested: links.length,
			created: created.length,
			skipped: skipped.length,
			failed: failed.length,
		},
	};
}

async function captureRenderValidation(client: FigJamClient, candidateNodeIds: Array<string | undefined>) {
	const nodeId = candidateNodeIds.find((id): id is string => typeof id === "string" && id.length > 0);
	if (!nodeId) {
		return { attempted: false, ok: false, nodeId: null, error: "NO_NODE_FOR_VALIDATION" };
	}
	try {
		const shot = await client.captureNodeScreenshot(nodeId, 2);
		return {
			attempted: true,
			ok: true,
			nodeId,
			byteLength: shot.byteLength,
			bounds: shot.bounds,
		};
	} catch (error) {
		return {
			attempted: true,
			ok: false,
			nodeId,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export function registerResearchWorkspaceTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"ingestResearchNotes",
		"Ingest structured research notes into deterministic FigJam sticky layouts.",
		ingestResearchNotesInputSchema,
		async (args) => {
			try {
				const client = await getClient();
				const payload = await ingestResearchNotesInternal(client, args as any);
				const renderValidation = await captureRenderValidation(
					client,
					(payload.created || []).map((item: { id?: string }) => item.id),
				);
				return ok({ ...payload, renderValidation });
			} catch (error) {
				return fail(error, "Failed to run ingestResearchNotes");
			}
		},
	);

	server.tool(
		"createReferenceWall",
		"Create a deterministic references wall grouped for research workflows.",
		createReferenceWallInputSchema,
		async (args) => {
			try {
				const client = await getClient();
				const payload = await createReferenceWallInternal(client, args as any);
				const renderValidation = await captureRenderValidation(client, payload.wall?.referenceStickyIds || []);
				return ok({ ...payload, renderValidation });
			} catch (error) {
				return fail(error, "Failed to run createReferenceWall");
			}
		},
	);

	server.tool(
		"organizeByTheme",
		"Organize existing notes into deterministic themed clusters.",
		organizeByThemeInputSchema,
		async (args) => {
			try {
				const client = await getClient();
				const payload = await organizeByThemeInternal(client, args as any);
				const createdClusterIds = (payload.themes || []).flatMap(
					(item: { clusterSectionId?: string; titleNodeId?: string; stickyIds?: string[] }) => [
						item.clusterSectionId,
						item.titleNodeId,
						...(item.stickyIds || []),
					],
				);
				const renderValidation = await captureRenderValidation(client, createdClusterIds);
				return ok({ ...payload, renderValidation });
			} catch (error) {
				return fail(error, "Failed to run organizeByTheme");
			}
		},
	);

	server.tool(
		"linkByRelation",
		"Create deterministic relationship connectors between research nodes.",
		linkByRelationInputSchema,
		async (args) => {
			try {
				const client = await getClient();
				const payload = await linkByRelationInternal(client, args as any);
				const renderValidation = await captureRenderValidation(
					client,
					(payload.created || []).map((item: { connectorId?: string }) => item.connectorId),
				);
				return ok({ ...payload, renderValidation });
			} catch (error) {
				return fail(error, "Failed to run linkByRelation");
			}
		},
	);

	server.tool(
		"generateResearchBoard",
		"Generate a deterministic structured research board scaffold and populate it.",
		generateResearchBoardInputSchema,
		async (args) => {
			const input = args as z.infer<z.ZodObject<typeof generateResearchBoardInputSchema>>;
			const runId = input.runId || randomId("run");
			const executionMode = input.executionMode || (input.references.length > 20 ? "job" : "sync_small");
			const totalItems = input.notes.length + input.references.length + input.themes.length;
			const createJob = () => {
				const job: ResearchJobRecord = {
					jobId: randomId("job"),
					runId,
					status: "queued",
					phase: "queued",
					startedAt: nowIso(),
					progress: { totalItems, processedItems: 0 },
					phaseDurations: {},
					args: { ...input, runId },
					cancelRequested: false,
				};
				cleanupOldJobs();
				RESEARCH_JOBS.set(job.jobId, job);
				return job;
			};

			const executeFlow = async (job?: ResearchJobRecord) => {
				const phaseStartedAt = Date.now();
				const markPhase = (phase: ResearchJobPhase, processedDelta = 0) => {
					if (!job) return;
					job.phaseDurations[job.phase] = (job.phaseDurations[job.phase] || 0) + (Date.now() - phaseStartedAt);
					job.phase = phase;
					job.status = phase === "failed" || phase === "cancelled" ? phase : "running";
					job.progress.processedItems = Math.min(job.progress.totalItems, job.progress.processedItems + processedDelta);
				};
				const checkCancelled = () => {
					if (!job?.cancelRequested) return false;
					job.phase = "cancelled";
					job.status = "cancelled";
					job.endedAt = nowIso();
					return true;
				};
				const failed: Array<{ step: string; error: string }> = [];
				const { title, origin, notes, references, themes, createLinks, dryRunLayout, continueOnError, dedupePolicy } = input;
				const client = await getClient();
				const sectionIds: { intake?: string; references?: string; themes?: string; questions?: string; decisions?: string } = {};
				const baseSections = [
					{ key: "intake", x: origin.x, y: origin.y, name: `${title} - Intake` },
					{ key: "references", x: origin.x + 1200, y: origin.y, name: `${title} - References` },
					{ key: "themes", x: origin.x, y: origin.y + 900, name: `${title} - Themes` },
					{ key: "questions", x: origin.x + 1200, y: origin.y + 900, name: `${title} - Questions` },
					{ key: "decisions", x: origin.x + 2400, y: origin.y + 900, name: `${title} - Decisions` },
				] as const;

				markPhase("scaffold");
				if (checkCancelled()) return { cancelled: true };
				for (const s of baseSections) {
					if (job?.cancelRequested) {
						markPhase("cancelled");
						return { cancelled: true };
					}
					try {
						const section = await client.createSection({
							name: s.name,
							x: s.x,
							y: s.y,
							width: 1000,
							height: 760,
							metadata: { runId, itemKey: `section:${toSlug(s.key)}` },
						});
						(sectionIds as Record<string, string>)[s.key] = section.id;
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!isSectionUnsupportedError(msg)) {
							if (!continueOnError) throw new Error(`Scaffold failed at ${s.key}: ${msg}`);
							failed.push({ step: "scaffold", error: `Section ${s.key}: ${msg}` });
						}
					}
					try {
						await client.createText({
							text: s.name,
							x: s.x + 16,
							y: s.y + 12,
							fontSize: 24,
							metadata: { runId, itemKey: `section-title:${toSlug(s.key)}` },
						});
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) throw new Error(`Scaffold title failed at ${s.key}: ${msg}`);
						failed.push({ step: "scaffold", error: `Title ${s.key}: ${msg}` });
					}
				}

				let ingestStep: { created: number; failed: number } | undefined;
				let ingestCreatedNodes: Array<{ id: string; renderedText: string }> = [];
				if (notes.length > 0) {
					markPhase("ingestResearchNotes");
					if (checkCancelled()) return { cancelled: true };
					try {
						const ingest = await ingestResearchNotesInternal(client, {
							notes,
							placement: {
								mode: "column",
								originX: origin.x + 40,
								originY: origin.y + 96,
								columns: 3,
								gapX: 260,
								gapY: 300,
							},
							formatting: { includeMetadataPrefix: false, metadataOrder: ["type", "source", "confidence", "tags"] },
							dedupe: { enabled: false, scope: "batch", caseSensitive: false },
							continueOnError,
						});
						ingestCreatedNodes = ingest.created.map((item) => ({ id: item.id, renderedText: item.renderedText }));
						ingestStep = { created: ingest.summary.created, failed: ingest.summary.failed };
						if (ingest.failed.length > 0) failed.push({ step: "ingestResearchNotes", error: `Partial ingest failures: ${ingest.failed.length}` });
						if (job) job.progress.processedItems += notes.length;
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) throw error;
						failed.push({ step: "ingestResearchNotes", error: msg });
					}
				}

				let referenceStep: { created: number; reused?: number; failed: number } | undefined;
				if (references.length > 0) {
					markPhase("createReferenceWall");
					if (checkCancelled()) return { cancelled: true };
					try {
						const wall = await createReferenceWallInternal(
							client,
							{
								title: `${title} References`,
								references,
								origin: { x: origin.x + 1220, y: origin.y + 30 },
								layout: { mode: "columns_by_kind", columnGap: 560, rowGap: 360, sectionPadding: 56 },
								continueOnError,
							},
							{ runId, dedupePolicy },
						);
						referenceStep = { created: wall.summary.created, reused: wall.summary.reused, failed: wall.summary.failed };
						if (wall.failed.length > 0) failed.push({ step: "createReferenceWall", error: `Partial reference wall failures: ${wall.failed.length}` });
						if (job) job.progress.processedItems += references.length;
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) throw error;
						failed.push({ step: "createReferenceWall", error: msg });
					}
				}

				let themeStep: { createdThemes: number; failed: number } | undefined;
				if (themes.length > 0) {
					markPhase("organizeByTheme");
					if (checkCancelled()) return { cancelled: true };
					try {
						const themeRefs = themes.map((t) => {
							const queries = t.noteQueries.map((q) => q.toLowerCase());
							const noteRefs = ingestCreatedNodes
								.filter((n) => queries.some((q) => n.renderedText.toLowerCase().includes(q)))
								.map((n) => ({ nodeId: n.id }));
							return { name: t.name, noteRefs };
						});
						const themed = await organizeByThemeInternal(client, {
							themes: themeRefs.filter((t) => t.noteRefs.length > 0),
							origin: { x: origin.x + 20, y: origin.y + 930 },
							layout: { mode: "grid", columns: 2, gapX: 640, gapY: 700 },
							unresolvedPolicy: "skip",
							continueOnError,
						});
						themeStep = { createdThemes: themed.summary.createdThemes, failed: themed.summary.failed };
						if (themed.failed.length > 0) failed.push({ step: "organizeByTheme", error: `Partial theme failures: ${themed.failed.length}` });
						if (job) job.progress.processedItems += themes.length;
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) throw error;
						failed.push({ step: "organizeByTheme", error: msg });
					}
				}

				let linkStep: { created: number; failed: number } | undefined;
				if (createLinks && themes.length > 0) {
					markPhase("linkByRelation");
					if (checkCancelled()) return { cancelled: true };
					try {
						const relationLinks: z.infer<z.ZodObject<typeof linkByRelationInputSchema>>["links"] = [];
						for (const t of themes) {
							for (let i = 1; i < t.noteQueries.length; i += 1) {
								relationLinks.push({ from: { query: t.noteQueries[i - 1] }, to: { query: t.noteQueries[i] }, relation: "related", label: undefined });
							}
						}
						if (relationLinks.length > 0) {
							const linked = await linkByRelationInternal(client, { links: relationLinks, dedupeExisting: true, continueOnError });
							linkStep = { created: linked.summary.created, failed: linked.summary.failed };
							if (linked.failed.length > 0) failed.push({ step: "linkByRelation", error: `Partial relation failures: ${linked.failed.length}` });
						}
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) throw error;
						failed.push({ step: "linkByRelation", error: msg });
					}
				}

				markPhase("autoLayoutBoard");
				if (checkCancelled()) return { cancelled: true };
				const layoutStep = {
					dryRun: dryRunLayout,
					evaluated: references.length + notes.length + themes.length,
					moved: 0,
					mode: "safe_no_global_relayout",
				};

				let validationCandidates: string[] = [
					sectionIds.intake,
					sectionIds.references,
					sectionIds.themes,
					sectionIds.questions,
					sectionIds.decisions,
				].filter((id): id is string => typeof id === "string" && id.length > 0);
				if (validationCandidates.length === 0) {
					try {
						validationCandidates = flattenNodes(await client.getBoardNodes())
							.filter(
								(n) =>
									["STICKY", "TEXT", "SHAPE_WITH_TEXT", "GROUP", "LINK_UNFURL", "RECTANGLE"].includes(n.type) &&
									typeof n.x === "number" &&
									typeof n.y === "number" &&
									inBbox(n, { x: origin.x - 80, y: origin.y - 80, width: 4200, height: 3000 }),
							)
							.slice(0, 20)
							.map((n) => n.id);
					} catch {
						validationCandidates = [];
					}
				}

				const result = {
					jobId: job?.jobId || null,
					runId,
					phase: "completed",
					progress: { totalItems, processedItems: totalItems },
					board: { title, sectionIds },
					steps: {
						ingestResearchNotes: ingestStep,
						createReferenceWall: referenceStep,
						organizeByTheme: themeStep,
						autoLayoutBoard: layoutStep,
						linkByRelation: linkStep,
					},
					failed,
					summary: {
						success: failed.length === 0,
						failedSteps: failed.length,
					},
					renderValidation: await captureRenderValidation(client, validationCandidates),
				};
				if (job) {
					job.result = result;
					job.phase = "completed";
					job.status = "completed";
					job.endedAt = nowIso();
					job.progress.processedItems = totalItems;
				}
				return result;
			};

			if (executionMode === "job") {
				const job = createJob();
				job.runner = async () => {
					try {
						job.status = "running";
						job.phase = "scaffold";
						await executeFlow(job);
					} catch (error) {
						job.phase = "failed";
						job.status = "failed";
						job.endedAt = nowIso();
						job.error = { code: "TIMEOUT_PARTIAL_WRITE", message: error instanceof Error ? error.message : String(error) };
					}
				};
				queueMicrotask(() => {
					void job.runner?.();
				});
				return ok({
					jobId: job.jobId,
					runId: job.runId,
					phase: job.phase,
					status: job.status,
					progress: job.progress,
				});
			}

			try {
				const syncResult = await executeFlow();
				return ok(syncResult);
			} catch (error) {
				return fail(error, "Failed to run generateResearchBoard");
			}
		},
	);

	server.tool(
		"figjam_get_job_status",
		"Get status for a research workflow job execution.",
		{ jobId: z.string().min(1) },
		async ({ jobId }) => {
			const job = RESEARCH_JOBS.get(jobId);
			if (!job) {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: {
									code: "JOB_NOT_FOUND",
									tool: "figjam_get_job_status",
									message: `No job found for id '${jobId}'`,
								},
							}),
						},
					],
				};
			}
			return ok(job);
		},
	);

	server.tool(
		"figjam_cancel_job",
		"Cancel a running research workflow job.",
		{ jobId: z.string().min(1) },
		async ({ jobId }) => {
			const job = RESEARCH_JOBS.get(jobId);
			if (!job) {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: {
									code: "JOB_NOT_FOUND",
									tool: "figjam_cancel_job",
									message: `No job found for id '${jobId}'`,
								},
							}),
						},
					],
				};
			}
			if (job.status === "cancelled") {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: {
									code: "RUN_ALREADY_CANCELLED",
									tool: "figjam_cancel_job",
									message: `Job '${jobId}' is already cancelled`,
								},
							}),
						},
					],
				};
			}
			job.cancelRequested = true;
			job.status = "cancelled";
			job.phase = "cancelled";
			job.endedAt = nowIso();
			return ok({ jobId, status: job.status, phase: job.phase, runId: job.runId });
		},
	);

	server.tool(
		"figjam_resume_job",
		"Resume a cancelled or failed research workflow job.",
		{ jobId: z.string().min(1) },
		async ({ jobId }) => {
			const job = RESEARCH_JOBS.get(jobId);
			if (!job) {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: {
									code: "JOB_NOT_FOUND",
									tool: "figjam_resume_job",
									message: `No job found for id '${jobId}'`,
								},
							}),
						},
					],
				};
			}
			if (job.status === "running") return ok({ jobId, status: job.status, phase: job.phase, runId: job.runId });
			if (job.status === "completed") return ok({ jobId, status: job.status, phase: job.phase, runId: job.runId, result: job.result || null });
			job.cancelRequested = false;
			job.status = "queued";
			job.phase = "queued";
			job.startedAt = nowIso();
			job.endedAt = undefined;
			job.error = undefined;
			job.result = undefined;
			job.progress.processedItems = 0;
			if (!job.runner) {
				return {
					isError: true,
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								error: {
									code: "JOB_NOT_FOUND",
									tool: "figjam_resume_job",
									message: `Job '${jobId}' cannot be resumed`,
								},
							}),
						},
					],
				};
			}
			queueMicrotask(() => {
				void job.runner?.();
			});
			return ok({ jobId, status: job.status, phase: job.phase, runId: job.runId });
		},
	);
}
