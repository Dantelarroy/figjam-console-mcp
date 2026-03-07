import { registerFigJamTools } from "../src/server/register-figjam-tools";
import { z } from "zod";

interface RegisteredTool {
	name: string;
	description: string;
	schema: any;
	handler: (args: any) => Promise<any>;
}

function createMockServer() {
	const tools: Record<string, RegisteredTool> = {};
	return {
		tool: jest.fn((name: string, description: string, schema: any, handler: any) => {
			tools[name] = { name, description, schema, handler };
		}),
		_getTool(name: string): RegisteredTool {
			return tools[name];
		},
	};
}

function createMockClient() {
	return {
		createSticky: jest.fn().mockImplementation(async (input: any) => ({
			id: `sticky-${Math.random().toString(16).slice(2, 8)}`,
			type: "STICKY",
			x: input.x,
			y: input.y,
			text: input.text,
		})),
		createSection: jest.fn().mockResolvedValue({ id: "sec-1", type: "SECTION" }),
		createText: jest.fn().mockResolvedValue({ id: "txt-1", type: "TEXT" }),
		createLink: jest.fn().mockResolvedValue({ id: "link-1", type: "LINK_UNFURL", text: "https://example.com" }),
		createConnector: jest.fn().mockResolvedValue({ id: "conn-1", type: "CONNECTOR" }),
		moveNode: jest.fn().mockResolvedValue({ id: "n1", type: "STICKY", x: 0, y: 0 }),
		getBoardNodes: jest.fn().mockResolvedValue([
			{ id: "n1", type: "STICKY", text: "insight: onboarding drop-off", x: 0, y: 0, width: 100, height: 100 },
			{ id: "n2", type: "TEXT", text: "source: interview-01", x: 200, y: 20, width: 120, height: 40 },
			{ id: "n3", type: "SHAPE_WITH_TEXT", text: "theme: trust", x: 400, y: 60, width: 120, height: 80 },
			{ id: "n4", type: "CONNECTOR", connectorStart: { endpointNodeId: "n1" }, connectorEnd: { endpointNodeId: "n3" } },
		]),
		getStickies: jest.fn().mockResolvedValue([
			{ id: "n1", type: "STICKY", text: "insight: onboarding drop-off", x: 0, y: 0, width: 100, height: 100 },
		]),
		getConnections: jest.fn().mockResolvedValue([
			{ id: "n4", type: "CONNECTOR", connectorStart: { endpointNodeId: "n1" }, connectorEnd: { endpointNodeId: "n3" } },
		]),
		updateSticky: jest.fn(),
		deleteSticky: jest.fn(),
		createShape: jest.fn(),
	};
}

describe("FigJam research-workspace tools contract", () => {
	let server: ReturnType<typeof createMockServer>;
	let client: ReturnType<typeof createMockClient>;

	beforeEach(() => {
		server = createMockServer();
		client = createMockClient();
		registerFigJamTools(server as any, async () => client as any);
	});

	function validate(toolName: string, payload: unknown) {
		const tool = server._getTool(toolName);
		return z.object(tool.schema).safeParse(payload);
	}

	it("ingestResearchNotes validates schema and returns deterministic summary", async () => {
		const tool = server._getTool("ingestResearchNotes");
		expect(
			validate("ingestResearchNotes", {
				notes: [{ text: "A", type: "insight", tags: [] }],
			}).success,
		).toBe(true);
		expect(validate("ingestResearchNotes", { notes: [] }).success).toBe(false);

		const res = await tool.handler({
			notes: [
				{ text: "A", type: "insight", tags: ["onboarding"] },
				{ text: "B", type: "question", tags: [] },
			],
			placement: { mode: "grid", originX: 0, originY: 0, columns: 2, gapX: 100, gapY: 100 },
			formatting: { includeMetadataPrefix: true, metadataOrder: ["type", "tags"] },
			dedupe: { enabled: false, scope: "batch", caseSensitive: false },
			continueOnError: true,
		});
		expect(res.isError).toBeUndefined();
		const payload = JSON.parse(res.content[0].text);
		expect(payload.summary.requested).toBe(2);
		expect(Array.isArray(payload.created)).toBe(true);
	});

	it("createReferenceWall validates schema and returns wall structure", async () => {
		const tool = server._getTool("createReferenceWall");
		expect(
			validate("createReferenceWall", {
				title: "Refs",
				references: [{ label: "Doc", kind: "paper", tags: [] }],
				origin: { x: 0, y: 0 },
			}).success,
		).toBe(true);

		const res = await tool.handler({
			title: "Refs",
			references: [
				{ label: "Doc A", url: "https://example.com/a", kind: "paper", tags: [] },
				{ label: "Doc B", kind: "article", tags: ["ux"] },
			],
			origin: { x: 100, y: 100 },
			layout: { mode: "columns_by_kind", columnGap: 200, rowGap: 120, sectionPadding: 20 },
			continueOnError: true,
		});
		expect(res.isError).toBeUndefined();
		const payload = JSON.parse(res.content[0].text);
		expect(payload.wall).toBeDefined();
		expect(payload.summary.requested).toBe(2);
	});

	it("organizeByTheme validates schema and returns per-theme summary", async () => {
		const tool = server._getTool("organizeByTheme");
		expect(
			validate("organizeByTheme", {
				themes: [{ name: "Trust", noteRefs: [{ query: "trust" }] }],
				origin: { x: 0, y: 0 },
			}).success,
		).toBe(true);

		const res = await tool.handler({
			themes: [
				{ name: "Trust", noteRefs: [{ query: "trust" }] },
				{ name: "Onboarding", noteRefs: [{ nodeId: "n1" }] },
			],
			origin: { x: 0, y: 0 },
			layout: { mode: "grid", columns: 2, gapX: 300, gapY: 240 },
			unresolvedPolicy: "skip",
			continueOnError: true,
		});
		expect(res.isError).toBeUndefined();
		const payload = JSON.parse(res.content[0].text);
		expect(Array.isArray(payload.themes)).toBe(true);
		expect(payload.summary.requestedThemes).toBe(2);
	});

	it("linkByRelation validates schema and creates/skips relation links", async () => {
		const tool = server._getTool("linkByRelation");
		expect(
			validate("linkByRelation", {
				links: [
					{
						from: { nodeId: "n1" },
						to: { query: "trust" },
						relation: "related",
					},
				],
			}).success,
		).toBe(true);

		const res = await tool.handler({
			links: [
				{ from: { nodeId: "n1" }, to: { nodeId: "n3" }, relation: "supports" },
				{ from: { query: "missing" }, to: { nodeId: "n3" }, relation: "related" },
			],
			dedupeExisting: true,
			continueOnError: true,
		});
		expect(res.isError).toBeUndefined();
		const payload = JSON.parse(res.content[0].text);
		expect(payload.summary.requested).toBe(2);
		expect(Array.isArray(payload.created)).toBe(true);
		expect(Array.isArray(payload.skipped)).toBe(true);
	});

	it("generateResearchBoard validates schema and returns step summaries", async () => {
		const tool = server._getTool("generateResearchBoard");
		expect(validate("generateResearchBoard", { title: "Board" }).success).toBe(true);

		const res = await tool.handler({
			title: "Research Board",
			origin: { x: 0, y: 0 },
			notes: [{ text: "User avoids onboarding", type: "insight", tags: ["onboarding"] }],
			references: [{ label: "Interview #1", kind: "interview", tags: [] }],
			themes: [{ name: "Trust", noteQueries: ["onboarding", "trust"] }],
			createLinks: true,
			dryRunLayout: true,
			continueOnError: true,
		});
		expect(res.isError).toBeUndefined();
		const payload = JSON.parse(res.content[0].text);
		expect(payload.board.title).toBe("Research Board");
		expect(payload.steps).toBeDefined();
		expect(payload.summary).toBeDefined();
	});
});
