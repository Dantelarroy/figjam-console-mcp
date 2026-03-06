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
		createSticky: jest
			.fn()
			.mockResolvedValueOnce({ id: "s-1", type: "STICKY", x: 10, y: 20 })
			.mockResolvedValueOnce({ id: "s-2", type: "STICKY", x: 42, y: 20 })
			.mockResolvedValue({ id: "s-x", type: "STICKY", x: 1, y: 1 }),
		createSection: jest.fn().mockResolvedValue({ id: "sec-1", type: "SECTION" }),
		createText: jest.fn().mockResolvedValue({ id: "txt-1", type: "TEXT" }),
		createConnector: jest.fn().mockResolvedValue({ id: "conn-1", type: "CONNECTOR" }),
		getBoardNodes: jest.fn().mockResolvedValue([
			{ id: "s-1", type: "STICKY", name: "Sticky", text: "alpha", x: 0, y: 0, width: 100, height: 100 },
			{
				id: "sec-1",
				type: "SECTION",
				name: "Area",
				x: 0,
				y: 0,
				width: 500,
				height: 500,
				children: [
					{ id: "t-1", type: "TEXT", name: "Label", text: "beta", x: 100, y: 10, width: 50, height: 20 },
				],
			},
			{ id: "shape-1", type: "SHAPE_WITH_TEXT", name: "Shape", text: "gamma", x: 30, y: 70, width: 100, height: 100 },
			{ id: "conn-1", type: "CONNECTOR", name: "Connector", connectorStart: { endpointNodeId: "s-1" }, connectorEnd: { endpointNodeId: "shape-1" } },
		]),
		getStickies: jest.fn().mockResolvedValue([
			{ id: "s-1", type: "STICKY", text: "alpha", x: 0, y: 0, width: 100, height: 100 },
		]),
		getConnections: jest.fn().mockResolvedValue([
			{ id: "conn-1", type: "CONNECTOR", connectorStart: { endpointNodeId: "s-1" }, connectorEnd: { endpointNodeId: "shape-1" } },
		]),
		moveNode: jest.fn().mockResolvedValue({ id: "s-1", type: "STICKY", x: 32, y: 32 }),
		updateSticky: jest.fn(),
		deleteSticky: jest.fn(),
		createShape: jest.fn(),
		createTextNode: jest.fn(),
	};
}

describe("FigJam workflow tools contract", () => {
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

	it("bulkCreateStickies validates schema and returns summary envelope", async () => {
		const tool = server._getTool("bulkCreateStickies");
		expect(validate("bulkCreateStickies", { items: [{ text: "A" }] }).success).toBe(true);
		expect(validate("bulkCreateStickies", { items: [] }).success).toBe(false);

		const res = await tool.handler({
			items: [{ text: "A" }, { text: "B" }],
			placement: { mode: "grid", originX: 10, originY: 20, columns: 2, gapX: 32, gapY: 24 },
			continueOnError: true,
		});
		expect(res.isError).toBeUndefined();
		const payload = JSON.parse(res.content[0].text);
		expect(payload.summary.requested).toBe(2);
		expect(payload.created.length).toBeGreaterThanOrEqual(1);
	});

	it("findNodes returns deterministic query results with summary", async () => {
		const tool = server._getTool("findNodes");
		expect(validate("findNodes", { query: "a", limit: 10, offset: 0 }).success).toBe(true);

		const res = await tool.handler({ query: "a", sort: "relevance", limit: 10, offset: 0 });
		expect(res.isError).toBeUndefined();
		const payload = JSON.parse(res.content[0].text);
		expect(Array.isArray(payload.nodes)).toBe(true);
		expect(payload.summary.totalMatched).toBeGreaterThan(0);
	});

	it("createCluster composes section/title/stickies/connectors", async () => {
		const tool = server._getTool("createCluster");
		expect(
			validate("createCluster", {
				title: "Ideas",
				items: [{ text: "A" }],
				origin: { x: 0, y: 0 },
			}).success,
		).toBe(true);

		const res = await tool.handler({
			title: "Ideas",
			items: [{ text: "A" }, { text: "B" }],
			origin: { x: 0, y: 0 },
			layout: { mode: "grid", columns: 2, gapX: 24, gapY: 24, padding: 48 },
			connectSequentially: true,
			continueOnError: true,
		});
		expect(res.isError).toBeUndefined();
		const payload = JSON.parse(res.content[0].text);
		expect(payload.cluster.sectionId).toBe("sec-1");
		expect(payload.cluster.titleNodeId).toBe("txt-1");
		expect(Array.isArray(payload.cluster.stickyIds)).toBe(true);
	});

	it("summarizeBoard returns structural counts and connectivity", async () => {
		const tool = server._getTool("summarizeBoard");
		expect(validate("summarizeBoard", {}).success).toBe(true);

		const res = await tool.handler({ groupBy: "type", includeSampleNodes: true, sampleLimit: 5 });
		expect(res.isError).toBeUndefined();
		const payload = JSON.parse(res.content[0].text);
		expect(payload.counts.total).toBeGreaterThan(0);
		expect(payload.connectivity).toBeDefined();
		expect(Array.isArray(payload.samples)).toBe(true);
	});

	it("autoLayoutBoard supports dryRun and move semantics", async () => {
		const tool = server._getTool("autoLayoutBoard");
		expect(validate("autoLayoutBoard", { mode: "grid" }).success).toBe(true);

		const dryRun = await tool.handler({
			mode: "grid",
			params: { columns: 2, gapX: 10, gapY: 10, originX: 0, originY: 0 },
			dryRun: true,
			continueOnError: true,
		});
		expect(dryRun.isError).toBeUndefined();
		const dryPayload = JSON.parse(dryRun.content[0].text);
		expect(dryPayload.dryRun).toBe(true);
		expect(Array.isArray(dryPayload.moved)).toBe(true);

		const apply = await tool.handler({
			mode: "grid",
			params: { columns: 2, gapX: 10, gapY: 10, originX: 0, originY: 0 },
			dryRun: false,
			continueOnError: true,
		});
		expect(apply.isError).toBeUndefined();
		expect(client.moveNode).toHaveBeenCalled();
	});
});
