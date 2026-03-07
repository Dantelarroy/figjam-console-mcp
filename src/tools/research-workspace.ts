import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FigJamClient, FigJamNodeSummary } from "../figjam-api/figjamClient.js";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { fail, ok } from "../server/figjam-tooling.js";
import { createLinkWithImageFallback } from "./link-fallback.js";
import {
	RESEARCH_UI_PALETTE_VERSION,
	resolveLayoutTokens,
	resolveThemePalette,
	type HeaderMode,
	type ThemeColorMode,
	type UiPreset,
} from "./research-ui.js";

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
				theme: z.string().min(1).max(200).optional(),
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
			mode: z.enum(["columns_by_kind", "columns_by_theme", "single_grid"]).default("columns_by_theme"),
			columnGap: z.number().min(0).default(460),
			rowGap: z.number().min(0).default(320),
			sectionPadding: z.number().min(0).default(56),
		})
		.default({}),
	themeOrder: z.array(z.string().min(1).max(200)).default([]),
	uiPreset: z.enum(["dense", "comfortable"]).default("dense"),
	themeColorMode: z.enum(["auto", "explicit"]).default("auto"),
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
				theme: z.string().min(1).max(200).optional(),
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
	uiPreset: z.enum(["dense", "comfortable"]).default("dense"),
	headerMode: z.enum(["full", "minimal"]).default("full"),
	themeColorMode: z.enum(["auto", "explicit"]).default("auto"),
	scaffoldMode: z.enum(["legacy", "clean"]).default("clean"),
	notesMode: z.enum(["sticky", "none"]).default("none"),
	referenceGrouping: z.enum(["theme", "kind"]).default("theme"),
	executionMode: z.enum(["sync_small", "job"]).optional(),
	dedupePolicy: z.enum(["by_url", "by_title", "strict"]).default("by_url"),
	layoutPolicy: z.enum(["auto_expand", "strict"]).default("auto_expand"),
	preRunCleanup: z.enum(["none", "delete_by_run"]).default("none"),
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

async function cleanupNodesByRunId(
	client: FigJamClient,
	runId: string,
	continueOnError: boolean,
): Promise<{ deletedCount: number; failed: Array<{ nodeId: string; error: string }> }> {
	const nodes = sortByPosition(
		flattenNodes(await client.getBoardNodes()).filter((node) => {
			const metadataRaw = node.pluginData?.["figjam.metadata"];
			if (!metadataRaw) return false;
			try {
				const parsed = JSON.parse(metadataRaw) as Record<string, unknown>;
				return parsed?.runId === runId;
			} catch {
				return false;
			}
		}),
	);
	const failed: Array<{ nodeId: string; error: string }> = [];
	let deletedCount = 0;
	for (const node of nodes) {
		try {
			await client.deleteNode(node.id);
			deletedCount += 1;
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			if (!continueOnError) throw error;
			failed.push({ nodeId: node.id, error: msg });
		}
	}
	return { deletedCount, failed };
}

function textForNode(node: FlatNode): string {
	if (typeof node.text === "string") return node.text;
	if (typeof node.name === "string") return node.name;
	return "";
}

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"in",
	"is",
	"it",
	"of",
	"on",
	"or",
	"that",
	"the",
	"this",
	"to",
	"with",
]);

const RELATION_ENDPOINT_TYPES = new Set(["STICKY", "TEXT", "SHAPE_WITH_TEXT", "LINK_UNFURL", "RECTANGLE"]);

function tokenizeText(value: string): string[] {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function tokenSet(value: string): Set<string> {
	return new Set(tokenizeText(value));
}

function textSimilarity(a: string, b: string): number {
	const ta = tokenSet(a);
	const tb = tokenSet(b);
	if (ta.size === 0 || tb.size === 0) return 0;
	let common = 0;
	for (const token of ta) {
		if (tb.has(token)) common += 1;
	}
	const denom = ta.size + tb.size - common;
	if (denom <= 0) return 0;
	return common / denom;
}

function nodeByIdMap(nodes: FlatNode[]): Map<string, FlatNode> {
	return new Map(nodes.map((n) => [n.id, n]));
}

function nodeBounds(node: FlatNode): { x1: number; y1: number; x2: number; y2: number } | null {
	if (typeof node.x !== "number" || typeof node.y !== "number") return null;
	const width = typeof node.width === "number" && Number.isFinite(node.width) ? Math.max(1, node.width) : 180;
	const height = typeof node.height === "number" && Number.isFinite(node.height) ? Math.max(1, node.height) : 120;
	return { x1: node.x, y1: node.y, x2: node.x + width, y2: node.y + height };
}

function queryMatchScore(text: string, query: string): number {
	const normalizedText = text.toLowerCase();
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return 0;
	let score = normalizedText.includes(normalizedQuery) ? 4 : 0;
	const textTokens = tokenSet(normalizedText);
	const queryTokens = tokenizeText(normalizedQuery);
	if (queryTokens.length > 0) {
		let overlap = 0;
		for (const token of queryTokens) {
			if (textTokens.has(token)) overlap += 1;
		}
		score += overlap / queryTokens.length;
	}
	return score;
}

function buildThemeMembership(
	notes: Array<{ id: string; renderedText: string }>,
	themes: Array<{ name: string; noteQueries: string[] }>,
): Map<string, string[]> {
	const assignedByTheme = new Map<string, string[]>();
	for (const theme of themes) assignedByTheme.set(theme.name, []);
	if (themes.length === 0 || notes.length === 0) return assignedByTheme;

	for (const note of notes) {
		let bestThemeName = themes[0].name;
		let bestScore = Number.NEGATIVE_INFINITY;
		for (const theme of themes) {
			const score = theme.noteQueries.reduce((acc, query) => acc + queryMatchScore(note.renderedText, query), 0);
			if (score > bestScore) {
				bestScore = score;
				bestThemeName = theme.name;
			}
		}
		if (bestScore <= 0) {
			// Fallback keeps deterministic full coverage when queries are sparse.
			bestThemeName = [...assignedByTheme.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]))[0]?.[0] || bestThemeName;
		}
		assignedByTheme.get(bestThemeName)?.push(note.id);
	}
	return assignedByTheme;
}

function buildIntraThemeLinks(
	themes: Array<{ name: string; stickyIds: string[] }>,
	textById: Map<string, string>,
): Array<{ from: { nodeId: string }; to: { nodeId: string }; relation: "related"; label: undefined }> {
	const links: Array<{ from: { nodeId: string }; to: { nodeId: string }; relation: "related"; label: undefined }> = [];
	for (const theme of themes) {
		const unique = [...new Set(theme.stickyIds)].filter((id) => textById.has(id));
		if (unique.length < 2) continue;
		const remaining = new Set(unique.slice(1));
		let current = unique[0];
		while (remaining.size > 0) {
			let next: string | null = null;
			let bestScore = Number.NEGATIVE_INFINITY;
			for (const candidate of remaining) {
				const score = textSimilarity(textById.get(current) || "", textById.get(candidate) || "");
				if (score > bestScore) {
					bestScore = score;
					next = candidate;
				}
			}
			if (!next) break;
			links.push({ from: { nodeId: current }, to: { nodeId: next }, relation: "related", label: undefined });
			remaining.delete(next);
			current = next;
		}
	}
	return links;
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

async function createBoardHeader(
	client: FigJamClient,
	input: {
		title: string;
		runId: string;
		origin: { x: number; y: number };
		headerMode: HeaderMode;
		themeColorMode: ThemeColorMode;
		themeCount: number;
		referenceCount: number;
		noteCount: number;
	},
) {
	const palette = resolveThemePalette("board", input.themeColorMode);
	const bg = await client.createShape({
		type: "rectangle",
		text: "",
		x: input.origin.x,
		y: input.origin.y - 140,
		width: 3320,
		height: input.headerMode === "minimal" ? 80 : 120,
		fillColor: palette.sectionBg,
		strokeColor: palette.sectionStroke,
		strokeWeight: 2,
		role: "board_header",
		metadata: { runId: input.runId, itemKey: "board_header" },
	});

	const headerText = input.headerMode === "minimal"
		? `${input.title}`
		: `${input.title}  •  themes:${input.themeCount}  refs:${input.referenceCount}  notes:${input.noteCount}`;
	const title = await client.createText({
		text: headerText,
		x: input.origin.x + 24,
		y: input.origin.y - 112,
		fontSize: input.headerMode === "minimal" ? 30 : 24,
		role: "board_header_title",
		metadata: { runId: input.runId, itemKey: "board_header_title" },
	});
	const stamp = await client.createText({
		text: `run:${input.runId.slice(0, 16)}`,
		x: input.origin.x + 24,
		y: input.origin.y - 78,
		fontSize: 14,
		role: "board_header_meta",
		metadata: { runId: input.runId, itemKey: "board_header_meta" },
	});
	return { bg, title, stamp };
}

async function createThemeHeaderBar(
	client: FigJamClient,
	input: {
		runId?: string;
		theme: string;
		themeSlug: string;
		x: number;
		y: number;
		width: number;
		count: number;
		themeColorMode: ThemeColorMode;
	},
) {
	const palette = resolveThemePalette(input.theme, input.themeColorMode);
	const bar = await client.createShape({
		type: "rectangle",
		text: "",
		x: input.x,
		y: input.y,
		width: input.width,
		height: 44,
		fillColor: palette.headerBg,
		strokeColor: palette.sectionStroke,
		strokeWeight: 1,
		groupId: `theme:${input.themeSlug}`,
		role: "theme_header",
			metadata: { runId: input.runId || "", itemKey: `theme_header:${input.themeSlug}` },
	});
	const title = await client.createText({
		text: `${input.theme} (${input.count})`,
		x: input.x + 12,
		y: input.y + 10,
		fontSize: 18,
		groupId: `theme:${input.themeSlug}`,
		role: "theme_header_label",
			metadata: { runId: input.runId || "", itemKey: `theme_header_label:${input.themeSlug}` },
	});
	return { bar, title, palette };
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
	options?: { allowedTypes?: Set<string> },
): Promise<{ node: FlatNode | null; reason?: string }> {
	const allowedTypes = options?.allowedTypes;
	if (ref.nodeId) {
		const byId = allNodes.find((n) => n.id === ref.nodeId) || null;
		if (byId && allowedTypes && !allowedTypes.has(byId.type)) {
			return { node: null, reason: `Node type not allowed: ${byId.type}` };
		}
		return byId ? { node: byId } : { node: null, reason: `Node not found: ${ref.nodeId}` };
	}
	if (ref.query) {
		const q = ref.query.trim();
		const candidates = allNodes
			.filter((n) => {
				if (allowedTypes && !allowedTypes.has(n.type)) return false;
				return queryMatchScore(textForNode(n), q) > 0;
			})
			.map((n) => ({ node: n, score: queryMatchScore(textForNode(n), q) }))
			.sort((a, b) => {
				if (b.score !== a.score) return b.score - a.score;
				const ay = typeof a.node.y === "number" ? a.node.y : Number.POSITIVE_INFINITY;
				const by = typeof b.node.y === "number" ? b.node.y : Number.POSITIVE_INFINITY;
				if (ay !== by) return ay - by;
				const ax = typeof a.node.x === "number" ? a.node.x : Number.POSITIVE_INFINITY;
				const bx = typeof b.node.x === "number" ? b.node.x : Number.POSITIVE_INFINITY;
				if (ax !== bx) return ax - bx;
				return a.node.id.localeCompare(b.node.id);
			});
		if (candidates.length > 0) return { node: candidates[0].node };
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

function estimateReferencePrimaryHeight(ref: { url?: string }, uiPreset: UiPreset): number {
	if (!ref.url) return uiPreset === "comfortable" ? 230 : 210;
	return uiPreset === "comfortable" ? 340 : 320;
}

function estimateReferencePrimaryWidth(ref: { url?: string }, uiPreset: UiPreset): number {
	if (!ref.url) return uiPreset === "comfortable" ? 300 : 260;
	return uiPreset === "comfortable" ? 420 : 400;
}

function nodeDimension(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function minNativeLinkHeight(uiPreset: UiPreset): number {
	return uiPreset === "comfortable" ? 560 : 480;
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
	options?: {
		runId?: string;
		dedupePolicy?: "by_url" | "by_title" | "strict";
		uiPreset?: UiPreset;
		themeColorMode?: ThemeColorMode;
	},
) {
	const { title, references, origin, layout, themeOrder, continueOnError } = args;
	const groupSectionIds: Record<string, string | undefined> = {};
	const referenceStickyIds: string[] = [];
	const reusedReferenceIds: string[] = [];
	const failed: Array<{
		step:
			| "createRootSection"
			| "createKindSection"
			| "createTitle"
			| "createReferenceSticky"
			| "reflowReferenceColumn";
		index?: number;
		kind?: string;
		error: string;
	}> = [];
	let rootSectionId: string | undefined;
	let titleNodeId: string | undefined;
	const capabilities = await client.getRuntimeCapabilities().catch(() => ({
		supportsSections: false,
		supportsRichUnfurl: false,
		supportsImageInsert: false,
	}));
	const uiPreset = options?.uiPreset || args.uiPreset || "dense";
	const themeColorMode = options?.themeColorMode || args.themeColorMode || "auto";
	const tokens = resolveLayoutTokens(uiPreset);
	let usedSectionFallbackContainer = false;
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

	const groupingMode = layout.mode === "columns_by_theme" ? "theme" : "kind";
	const byGroup = new Map<string, typeof references>();
	const normalizedThemeOrder = (themeOrder || []).map((v) => v.trim()).filter((v) => v.length > 0);
	const orderedSeed = groupingMode === "theme" ? normalizedThemeOrder : [...KIND_ORDER];
	for (const key of orderedSeed) byGroup.set(key, []);
	for (const ref of references) {
		const key = groupingMode === "theme" ? (ref.theme?.trim() || "Uncategorized") : ref.kind;
		const arr = byGroup.get(key) || [];
		arr.push(ref);
		byGroup.set(key, arr);
	}
	const orderedGroups = [
		...orderedSeed,
		...Array.from(byGroup.keys()).filter((key) => !orderedSeed.includes(key)),
	].filter((key, index, all) => all.indexOf(key) === index && (byGroup.get(key) || []).length > 0);

	let nativeCount = 0;
	let fallbackCount = 0;
	let overlapCount = 0;
	let orphanNoteCount = 0;
	const renderedBoxes: Array<{ x: number; y: number; width: number; height: number }> = [];
	const hasOverlap = (x: number, y: number, width: number, height: number) =>
		renderedBoxes.some(
			(box) =>
				x < box.x + box.width &&
				x + width > box.x &&
				y < box.y + box.height &&
				y + height > box.y,
		);
	const rememberBox = (x: number, y: number, width: number, height: number) => {
		if (hasOverlap(x, y, width, height)) overlapCount += 1;
		renderedBoxes.push({ x, y, width, height });
	};

	const nonEmptyGroupCount = orderedGroups.length;
	const wallPalette = resolveThemePalette(title, themeColorMode);
	try {
		const root = await client.createSection({
			name: title,
			x: origin.x,
			y: origin.y,
			width:
					layout.mode !== "single_grid"
						? Math.max(1600, nonEmptyGroupCount * (layout.columnGap + 220) + layout.sectionPadding * 2)
						: 2200,
			height: Math.max(1200, 240 + Math.ceil(references.length / 2) * layout.rowGap),
			fillColor: wallPalette.sectionBg,
			strokeColor: wallPalette.sectionStroke,
			strokeWeight: 2,
		});
		rootSectionId = root.id;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		if (isSectionUnsupportedError(msg)) {
			usedSectionFallbackContainer = true;
			try {
				const fallback = await client.createShape({
					type: "rectangle",
					text: title,
					x: origin.x,
					y: origin.y,
						width:
						layout.mode !== "single_grid"
							? Math.max(1600, nonEmptyGroupCount * (layout.columnGap + 220) + layout.sectionPadding * 2)
							: 2200,
						height: Math.max(1200, 240 + Math.ceil(references.length / 2) * layout.rowGap),
						fillColor: wallPalette.sectionBg,
						strokeColor: wallPalette.sectionStroke,
						strokeWeight: 2,
						role: "section_fallback",
							metadata: { sectionName: title, sectionFallback: true, runId: options?.runId || "" },
					});
				rootSectionId = fallback.id;
			} catch {
				rootSectionId = undefined;
			}
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
							metadata: { runId: runId || "", itemKey, label: ref.label, kind: ref.kind },
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
							uiPreset,
							role: "reference",
							preferNative: true,
							groupId: `kind:${ref.kind}`,
						});
					await client.updateNode({
						nodeId: linkRendered.primary.id,
						sourceUrl: ref.url,
							metadata: { runId: runId || "", itemKey, label: ref.label, kind: ref.kind },
					});
					referenceStickyIds.push(linkRendered.primary.id);
					if (linkRendered.imageNode?.id) referenceStickyIds.push(linkRendered.imageNode.id);
					if (linkRendered.mode === "native_link") nativeCount += 1;
					else fallbackCount += 1;
					rememberBox(x, y, 430, 340);
					continue;
				}
				const sticky = await client.createSticky({
					text: rendered,
					x,
					y,
						metadata: { runId: runId || "", itemKey, label: ref.label, kind: ref.kind },
				});
				referenceStickyIds.push(sticky.id);
				rememberBox(x, y, 280, 240);
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (!continueOnError) throw new Error(`createReferenceWall sticky failed at ${i}: ${msg}`);
				failed.push({ step: "createReferenceSticky", index: i, error: msg });
			}
		}
	} else {
		let groupIndex = 0;
			for (const groupLabel of orderedGroups) {
				const refs = byGroup.get(groupLabel) || [];
				if (refs.length === 0) continue;
				const sectionX = origin.x + layout.sectionPadding + groupIndex * layout.columnGap;
				const sectionY = origin.y + 84;
				const cardGapY = Math.max(24, Math.floor(layout.rowGap * 0.12));
				const estimatedColumnHeight =
					tokens.headerToFirstCardGap +
					44 +
					refs.reduce(
						(sum, ref) => sum + estimateReferencePrimaryHeight(ref, uiPreset) + cardGapY,
						0,
					) +
					44;
				let groupSectionId: string | undefined;
				const groupSlug = `${groupingMode}:${toSlug(groupLabel)}`;
				try {
					const kindSection = await client.createSection({
						name: groupLabel,
						x: sectionX,
						y: sectionY,
						width: Math.max(520, layout.columnGap - 40),
						height: Math.max(420, estimatedColumnHeight),
					});
				groupSectionId = kindSection.id;
				groupSectionIds[groupLabel] = groupSectionId;
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (isSectionUnsupportedError(msg)) {
					usedSectionFallbackContainer = true;
					try {
						const fallback = await client.createShape({
							type: "rectangle",
								text: groupLabel.toUpperCase(),
								x: sectionX,
								y: sectionY,
								width: Math.max(520, layout.columnGap - 40),
								height: Math.max(420, estimatedColumnHeight),
								groupId: groupSlug,
							role: "section_fallback",
								metadata: { sectionName: groupLabel, sectionFallback: true, runId: options?.runId || "" },
						});
						groupSectionId = fallback.id;
						groupSectionIds[groupLabel] = groupSectionId;
					} catch {
						groupSectionId = undefined;
					}
				} else if (!continueOnError) throw new Error(`createReferenceWall group section failed for ${groupLabel}: ${msg}`);
				else failed.push({ step: "createKindSection", kind: groupLabel, error: msg });
			}

			try {
				await createThemeHeaderBar(client, {
					runId,
					theme: groupLabel,
					themeSlug: toSlug(groupLabel),
					x: sectionX + 8,
					y: sectionY + 8,
					width: Math.max(500, layout.columnGap - 56),
					count: refs.length,
					themeColorMode,
				});
			} catch (error) {
				const msg = error instanceof Error ? error.message : String(error);
				if (!continueOnError) throw new Error(`createReferenceWall group title failed for ${groupLabel}: ${msg}`);
				failed.push({ step: "createTitle", kind: groupLabel, error: msg });
			}

				const renderedInGroup: Array<{
					nodeId: string;
					x: number;
					plannedY: number;
					widthFallback: number;
					heightFallback: number;
					isNativeLink: boolean;
				}> = [];
				let cursorY = sectionY + 44 + tokens.headerToFirstCardGap;
				for (let i = 0; i < refs.length; i += 1) {
					const ref = refs[i];
					const rendered = renderReferenceText(ref);
					try {
						const x = sectionX + 18;
						const y = cursorY;
						const itemKey = createReferenceItemKey(ref, dedupePolicy);
						const existingNode = runId ? existingByItemKey.get(itemKey) : undefined;
						if (existingNode) {
							const existingWidth = nodeDimension(
								existingNode.width,
								estimateReferencePrimaryWidth(ref, uiPreset),
							);
							let existingHeight = nodeDimension(
								existingNode.height,
								estimateReferencePrimaryHeight(ref, uiPreset),
							);
							const existingIsNativeLink = existingNode.type === "LINK_UNFURL";
							if (existingIsNativeLink) {
								existingHeight = Math.max(existingHeight, minNativeLinkHeight(uiPreset));
							}
							await client.moveNode({ nodeId: existingNode.id, x, y });
							await client.updateNode({
								nodeId: existingNode.id,
							groupId: groupSlug,
							role: "reference",
							sourceUrl: ref.url,
								metadata: { runId: runId || "", itemKey, label: ref.label, kind: ref.kind, theme: ref.theme || "" },
							});
							referenceStickyIds.push(existingNode.id);
							reusedReferenceIds.push(existingNode.id);
							renderedInGroup.push({
								nodeId: existingNode.id,
								x,
								plannedY: y,
								widthFallback: existingWidth,
								heightFallback: existingHeight,
								isNativeLink: existingIsNativeLink,
							});
							cursorY += existingHeight + cardGapY;
							continue;
						}
					if (ref.url) {
						const linkRendered = await createLinkWithImageFallback(async () => client, {
							url: ref.url,
							title: ref.label,
							x,
							y,
							uiPreset,
							role: "reference",
							preferNative: true,
							groupId: groupSlug,
						});
						await client.updateNode({
							nodeId: linkRendered.primary.id,
							groupId: groupSlug,
							sourceUrl: ref.url,
								metadata: { runId: runId || "", itemKey, label: ref.label, kind: ref.kind, theme: ref.theme || "" },
						});
						referenceStickyIds.push(linkRendered.primary.id);
						if (linkRendered.imageNode?.id) referenceStickyIds.push(linkRendered.imageNode.id);
						if (linkRendered.mode === "native_link") nativeCount += 1;
						else fallbackCount += 1;
							const widthFallback = nodeDimension(
								linkRendered.primary?.width,
								estimateReferencePrimaryWidth(ref, uiPreset),
							);
							let heightFallback = nodeDimension(
								linkRendered.primary?.height,
								estimateReferencePrimaryHeight(ref, uiPreset),
							);
							const isNativeLink = linkRendered.mode === "native_link";
							if (isNativeLink) {
								heightFallback = Math.max(heightFallback, minNativeLinkHeight(uiPreset));
							}
							renderedInGroup.push({
								nodeId: linkRendered.primary.id,
								x,
								plannedY: y,
								widthFallback,
								heightFallback,
								isNativeLink,
							});
							cursorY += heightFallback + cardGapY;
							continue;
						}
					const sticky = await client.createSticky({
						text: rendered,
						x,
						y,
						groupId: groupSlug,
						metadata: { runId: runId || "", itemKey, label: ref.label, kind: ref.kind, theme: ref.theme || "" },
					});
					referenceStickyIds.push(sticky.id);
						const widthFallback = nodeDimension(sticky.width, estimateReferencePrimaryWidth(ref, uiPreset));
						const heightFallback = nodeDimension(sticky.height, estimateReferencePrimaryHeight(ref, uiPreset));
						renderedInGroup.push({
							nodeId: sticky.id,
							x,
							plannedY: y,
							widthFallback,
							heightFallback,
							isNativeLink: false,
						});
						cursorY += heightFallback + cardGapY;
					} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (!continueOnError) throw new Error(`createReferenceWall sticky failed for ${groupLabel}/${i}: ${msg}`);
					failed.push({ step: "createReferenceSticky", index: i, kind: groupLabel, error: msg });
				}
			}
				if (renderedInGroup.length > 0) {
					try {
						const snapshotById = new Map(
							flattenNodes(await client.getBoardNodes()).map((node) => [node.id, node]),
						);
						let measuredY = sectionY + 44 + tokens.headerToFirstCardGap;
						for (const item of renderedInGroup) {
							const measured = snapshotById.get(item.nodeId);
							const width = nodeDimension(measured?.width, item.widthFallback);
							let height = nodeDimension(measured?.height, item.heightFallback);
							if (item.isNativeLink) {
								height = Math.max(height, minNativeLinkHeight(uiPreset));
							}
							const targetY = measuredY;
							const currentX = typeof measured?.x === "number" ? measured.x : item.x;
							const currentY = typeof measured?.y === "number" ? measured.y : item.plannedY;
							if (Math.abs(currentY - targetY) > 0.5 || Math.abs(currentX - item.x) > 0.5) {
								await client.moveNode({ nodeId: item.nodeId, x: item.x, y: targetY });
							}
							rememberBox(item.x, targetY, width, height);
							measuredY += height + cardGapY;
						}
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) {
							throw new Error(`createReferenceWall reflow failed for ${groupLabel}: ${msg}`);
						}
						failed.push({ step: "reflowReferenceColumn", kind: groupLabel, error: msg });
						for (const item of renderedInGroup) {
							rememberBox(item.x, item.plannedY, item.widthFallback, item.heightFallback);
						}
					}
				}
			groupIndex += 1;
		}
	}

	const kindsCount: Record<string, number> = {};
	for (const k of orderedGroups) {
		const count = (byGroup.get(k) || []).length;
		if (count > 0) kindsCount[k] = count;
	}

	return {
		wall: {
			rootSectionId,
			kindSectionIds: groupSectionIds,
			titleNodeId,
			referenceStickyIds,
			usedSectionFallbackContainer,
			capabilities,
		},
		failed,
		summary: {
			requested: references.length,
			created: referenceStickyIds.length,
			reused: reusedReferenceIds.length,
			failed: failed.length,
			nativeCount,
			fallbackCount,
			overlapCount,
			orphanNoteCount,
			uiPreset,
			paletteVersion: RESEARCH_UI_PALETTE_VERSION,
			kinds: kindsCount,
			groupingMode,
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
			const resolution = await resolveRef(allNodes, theme.noteRefs[r], { allowedTypes: RELATION_ENDPOINT_TYPES });
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

			if (clusterSectionId && stickyIds.length > 0) {
				const snapshot = flattenNodes(await client.getBoardNodes());
				const byId = nodeByIdMap(snapshot);
				const marginX = 30;
				const marginTop = 48;
				const marginBottom = 30;
				const titleNode = titleNodeId ? byId.get(titleNodeId) : null;
				let minX = Number.POSITIVE_INFINITY;
				let minY = Number.POSITIVE_INFINITY;
				let maxX = Number.NEGATIVE_INFINITY;
				let maxY = Number.NEGATIVE_INFINITY;

				for (const stickyId of stickyIds) {
					const measured = byId.get(stickyId);
					if (!measured) continue;
					const bounds = nodeBounds(measured);
					if (!bounds) continue;
					minX = Math.min(minX, bounds.x1);
					minY = Math.min(minY, bounds.y1);
					maxX = Math.max(maxX, bounds.x2);
					maxY = Math.max(maxY, bounds.y2);
				}
				if (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) {
					const sectionX = minX - marginX;
					const sectionY = minY - marginTop;
					const sectionWidth = Math.max(520, maxX - minX + marginX * 2);
					const sectionHeight = Math.max(360, maxY - minY + marginTop + marginBottom);
					await client.updateNode({
						nodeId: clusterSectionId,
						x: sectionX,
						y: sectionY,
						width: sectionWidth,
						height: sectionHeight,
						title: theme.name,
					});
					if (titleNodeId) {
						await client.updateNode({
							nodeId: titleNodeId,
							x: sectionX + 12,
							y: sectionY + 10,
							text: titleNode ? textForNode(titleNode) || theme.name : theme.name,
						});
					}
				}
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
	const skipped: Array<{
		index: number;
		reason: "duplicate_link" | "unresolved_endpoint" | "invalid_endpoint_type" | "same_node";
	}> = [];
	const failed: Array<{ index: number; error: string }> = [];

	for (let i = 0; i < links.length; i += 1) {
		const link = links[i];
		const from = await resolveRef(allNodes, link.from, { allowedTypes: RELATION_ENDPOINT_TYPES });
		const to = await resolveRef(allNodes, link.to, { allowedTypes: RELATION_ENDPOINT_TYPES });
		if (!from.node || !to.node) {
			const unresolved = (from.reason || "").includes("not allowed") || (to.reason || "").includes("not allowed");
			skipped.push({ index: i, reason: unresolved ? "invalid_endpoint_type" : "unresolved_endpoint" });
			continue;
		}
		if (from.node.id === to.node.id) {
			skipped.push({ index: i, reason: "same_node" });
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
	const targetNodeIds = [...new Set(candidateNodeIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
	if (targetNodeIds.length === 0) return { attempted: false, ok: false, nodeId: null, error: "NO_NODE_FOR_VALIDATION", targetNodeIds: [], regionBounds: null, nodeCountInRegion: 0 };
	let nodeId: string | null = targetNodeIds[0];
	let regionBounds: { x: number; y: number; width: number; height: number } | null = null;
	let nodeCountInRegion = 0;
	try {
		const flat = flattenNodes(await client.getBoardNodes());
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
			if (containerCandidate?.id) nodeId = containerCandidate.id;
		}
	} catch {
		// Best effort.
	}
	if (!nodeId) return { attempted: false, ok: false, nodeId: null, error: "NO_NODE_FOR_VALIDATION", targetNodeIds, regionBounds, nodeCountInRegion };
	try {
		const shot = await client.captureNodeScreenshot(nodeId, 2);
		return {
			attempted: true,
			ok: true,
			nodeId,
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
			nodeId,
			error: error instanceof Error ? error.message : String(error),
			targetNodeIds,
			regionBounds,
			nodeCountInRegion,
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
				let phaseStartedAt = Date.now();
				const markPhase = (phase: ResearchJobPhase, processedDelta = 0) => {
					if (!job) return;
					const now = Date.now();
					job.phaseDurations[job.phase] = (job.phaseDurations[job.phase] || 0) + (now - phaseStartedAt);
					job.phase = phase;
					job.status = phase === "failed" || phase === "cancelled" ? phase : "running";
					job.progress.processedItems = Math.min(job.progress.totalItems, job.progress.processedItems + processedDelta);
					phaseStartedAt = now;
				};
				const checkCancelled = () => {
					if (!job?.cancelRequested) return false;
					job.phase = "cancelled";
					job.status = "cancelled";
					job.endedAt = nowIso();
					return true;
				};
				const failed: Array<{ step: string; error: string }> = [];
					const {
						title,
						origin,
					notes,
					references,
					themes,
					createLinks,
					dryRunLayout,
					continueOnError,
					dedupePolicy,
					uiPreset,
					headerMode,
					themeColorMode,
					scaffoldMode,
					notesMode,
						referenceGrouping,
						preRunCleanup,
					} = input;
				const tokens = resolveLayoutTokens(uiPreset);
				const client = await getClient();
				const capabilities = await client.getRuntimeCapabilities().catch(() => ({
					supportsSections: false,
					supportsRichUnfurl: false,
					supportsImageInsert: false,
				}));
					let usedSectionFallbackContainer = false;
					let cleanupStep: { mode: "none" | "delete_by_run"; deleted: number; failed: number } | undefined;
					const sectionIds: { intake?: string; references?: string; themes?: string; questions?: string; decisions?: string } = {};
				const headerIds: { boardHeaderNodeId?: string; boardHeaderTitleNodeId?: string; boardHeaderMetaNodeId?: string; themeHeaderNodeIds: string[] } = { themeHeaderNodeIds: [] };
				const baseSections = [
					{ key: "intake", x: origin.x, y: origin.y, name: `${title} - Intake` },
					{ key: "references", x: origin.x + 1200, y: origin.y, name: `${title} - References` },
					{ key: "themes", x: origin.x, y: origin.y + 900, name: `${title} - Themes` },
					{ key: "questions", x: origin.x + 1200, y: origin.y + 900, name: `${title} - Questions` },
					{ key: "decisions", x: origin.x + 2400, y: origin.y + 900, name: `${title} - Decisions` },
				] as const;

					markPhase("scaffold");
					if (checkCancelled()) return { cancelled: true };
					if (preRunCleanup === "delete_by_run") {
						try {
							const cleanup = await cleanupNodesByRunId(client, runId, continueOnError);
							cleanupStep = {
								mode: "delete_by_run",
								deleted: cleanup.deletedCount,
								failed: cleanup.failed.length,
							};
							if (cleanup.failed.length > 0) {
								failed.push({
									step: "scaffold",
									error: `Pre-run cleanup failures: ${cleanup.failed.length}`,
								});
							}
						} catch (error) {
							const msg = error instanceof Error ? error.message : String(error);
							if (!continueOnError) throw new Error(`Pre-run cleanup failed: ${msg}`);
							failed.push({ step: "scaffold", error: `Pre-run cleanup: ${msg}` });
						}
					} else {
						cleanupStep = { mode: "none", deleted: 0, failed: 0 };
					}
					try {
					const header = await createBoardHeader(client, {
						title,
						runId,
						origin,
						headerMode,
						themeColorMode,
						themeCount: themes.length,
						referenceCount: references.length,
						noteCount: notes.length,
					});
					headerIds.boardHeaderNodeId = header.bg.id;
					headerIds.boardHeaderTitleNodeId = header.title.id;
					headerIds.boardHeaderMetaNodeId = header.stamp.id;
				} catch (error) {
					const msg = error instanceof Error ? error.message : String(error);
					if (!continueOnError) throw new Error(`Board header failed: ${msg}`);
					failed.push({ step: "scaffold", error: `Board header: ${msg}` });
				}
				if (scaffoldMode === "legacy") {
					for (const s of baseSections) {
					if (job?.cancelRequested) {
						markPhase("cancelled");
						return { cancelled: true };
					}
						try {
							const sectionPalette = resolveThemePalette(s.key, themeColorMode);
							const section = await client.createSection({
								name: s.name,
								x: s.x,
								y: s.y,
								width: 1000,
								height: 760,
								fillColor: sectionPalette.sectionBg,
								strokeColor: sectionPalette.sectionStroke,
								strokeWeight: 2,
								metadata: { runId, itemKey: `section:${toSlug(s.key)}` },
							});
							(sectionIds as Record<string, string>)[s.key] = section.id;
						} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (isSectionUnsupportedError(msg)) {
							usedSectionFallbackContainer = true;
								try {
									const sectionPalette = resolveThemePalette(s.key, themeColorMode);
									const fallback = await client.createShape({
										type: "rectangle",
										text: s.name,
										x: s.x,
										y: s.y,
										width: 1000,
										height: 760,
										fillColor: sectionPalette.sectionBg,
										strokeColor: sectionPalette.sectionStroke,
										strokeWeight: 2,
										role: "section_fallback",
										metadata: { runId, itemKey: `section:${toSlug(s.key)}`, sectionFallback: true },
									});
								(sectionIds as Record<string, string>)[s.key] = fallback.id;
							} catch (fallbackError) {
								const fallbackMsg =
									fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
								if (!continueOnError) throw new Error(`Scaffold fallback failed at ${s.key}: ${fallbackMsg}`);
								failed.push({ step: "scaffold", error: `Fallback section ${s.key}: ${fallbackMsg}` });
							}
						} else {
							if (!continueOnError) throw new Error(`Scaffold failed at ${s.key}: ${msg}`);
							failed.push({ step: "scaffold", error: `Section ${s.key}: ${msg}` });
						}
					}
						try {
							const header = await createThemeHeaderBar(client, {
								runId,
								theme: s.name,
								themeSlug: toSlug(s.key),
								x: s.x + 8,
								y: s.y + 8,
								width: 984,
								count: 0,
								themeColorMode,
							});
							headerIds.themeHeaderNodeIds.push(header.bar.id);
							await client.createText({
								text: s.name,
								x: s.x + 16,
								y: s.y + 56,
								fontSize: 20,
								metadata: { runId, itemKey: `section-title:${toSlug(s.key)}` },
							});
						} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) throw new Error(`Scaffold title failed at ${s.key}: ${msg}`);
						failed.push({ step: "scaffold", error: `Title ${s.key}: ${msg}` });
					}
					}
				}

				let ingestStep: { created: number; failed: number } | undefined;
				let ingestCreatedNodes: Array<{ id: string; renderedText: string }> = [];
				if (notes.length > 0 && notesMode === "sticky") {
					markPhase("ingestResearchNotes");
					if (checkCancelled()) return { cancelled: true };
					try {
						const ingest = await ingestResearchNotesInternal(client, {
							notes,
							placement: {
								mode: "column",
								originX: origin.x + 40,
								originY: origin.y + 96 + tokens.headerToFirstCardGap,
								columns: 3,
								gapX: 260,
								gapY: tokens.rowGapY,
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

				let referenceStep:
					| {
							created: number;
							reused?: number;
							failed: number;
							nativeCount: number;
							fallbackCount: number;
							overlapCount: number;
							orphanNoteCount: number;
					  }
					| undefined;
				if (references.length > 0) {
					markPhase("createReferenceWall");
					if (checkCancelled()) return { cancelled: true };
					try {
						const wall = await createReferenceWallInternal(
							client,
								{
									title: `${title} References`,
									references,
									origin: scaffoldMode === "legacy" ? { x: origin.x + 1220, y: origin.y + 30 } : { x: origin.x, y: origin.y + 30 },
									layout: {
										mode: referenceGrouping === "theme" ? "columns_by_theme" : "columns_by_kind",
										columnGap: tokens.columnGapX,
										rowGap: tokens.rowGapY,
										sectionPadding: tokens.sectionPadding,
									},
									themeOrder: themes.map((t) => t.name),
									uiPreset,
									themeColorMode,
									continueOnError,
								},
							{ runId, dedupePolicy, uiPreset, themeColorMode },
						);
						referenceStep = {
							created: wall.summary.created,
							reused: wall.summary.reused,
							failed: wall.summary.failed,
							nativeCount: wall.summary.nativeCount,
							fallbackCount: wall.summary.fallbackCount,
							overlapCount: wall.summary.overlapCount,
							orphanNoteCount: wall.summary.orphanNoteCount,
						};
						if (wall.failed.length > 0) failed.push({ step: "createReferenceWall", error: `Partial reference wall failures: ${wall.failed.length}` });
						if (job) job.progress.processedItems += references.length;
					} catch (error) {
						const msg = error instanceof Error ? error.message : String(error);
						if (!continueOnError) throw error;
						failed.push({ step: "createReferenceWall", error: msg });
					}
				}

				let themeStep: { createdThemes: number; failed: number } | undefined;
				let organizedThemes: Array<{ name: string; stickyIds: string[] }> = [];
				if (themes.length > 0) {
					markPhase("organizeByTheme");
					if (checkCancelled()) return { cancelled: true };
					try {
						const assignedByTheme = buildThemeMembership(
							ingestCreatedNodes.map((n) => ({ id: n.id, renderedText: n.renderedText })),
							themes,
						);
						const themeRefs = themes.map((t) => ({
							name: t.name,
							noteRefs: (assignedByTheme.get(t.name) || []).map((nodeId) => ({ nodeId })),
						}));
						const themed = await organizeByThemeInternal(client, {
							themes: themeRefs.filter((t) => t.noteRefs.length > 0),
							origin: { x: origin.x + 20, y: origin.y + 930 },
							layout: { mode: "grid", columns: 2, gapX: 640, gapY: 700 },
							unresolvedPolicy: "skip",
							continueOnError,
						});
						themeStep = { createdThemes: themed.summary.createdThemes, failed: themed.summary.failed };
						organizedThemes = themed.themes.map((t) => ({ name: t.name, stickyIds: t.stickyIds }));
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
						const textById = new Map(ingestCreatedNodes.map((n) => [n.id, n.renderedText]));
						const relationLinks: z.infer<z.ZodObject<typeof linkByRelationInputSchema>>["links"] =
							buildIntraThemeLinks(organizedThemes, textById);
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
						headerIds.boardHeaderNodeId,
						headerIds.boardHeaderTitleNodeId,
						headerIds.boardHeaderMetaNodeId,
						sectionIds.intake,
						sectionIds.references,
						sectionIds.themes,
						sectionIds.questions,
						sectionIds.decisions,
						...headerIds.themeHeaderNodeIds,
						...organizedThemes.flatMap((theme) => theme.stickyIds),
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
						capabilities,
						board: { title, sectionIds, headerIds },
						ui: {
							preset: uiPreset,
							headerMode,
							themeColorMode,
							paletteVersion: RESEARCH_UI_PALETTE_VERSION,
						},
						layoutTokens: tokens,
						steps: {
						ingestResearchNotes: ingestStep,
						createReferenceWall: referenceStep,
							organizeByTheme: themeStep,
							autoLayoutBoard: layoutStep,
							linkByRelation: linkStep,
							preRunCleanup: cleanupStep,
						},
					failed,
					summary: {
						success: failed.length === 0,
						failedSteps: failed.length,
						usedSectionFallbackContainer,
						nativeCount: referenceStep?.nativeCount || 0,
						fallbackCount: referenceStep?.fallbackCount || 0,
							overlapCount: referenceStep?.overlapCount || 0,
							orphanNoteCount: referenceStep?.orphanNoteCount || 0,
							headersCreated: Boolean(headerIds.boardHeaderNodeId),
						},
					telemetry: {
						startedAt: job?.startedAt || nowIso(),
						endedAt: nowIso(),
						durationMs: job ? Math.max(0, Date.now() - Date.parse(job.startedAt)) : null,
						phaseDurations: job?.phaseDurations || {},
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
						ui: {
							preset: input.uiPreset,
							headerMode: input.headerMode,
							themeColorMode: input.themeColorMode,
							paletteVersion: RESEARCH_UI_PALETTE_VERSION,
						},
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
