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
		createSticky: jest.fn().mockResolvedValue({ id: "sticky-1", type: "STICKY", text: "Idea" }),
		updateSticky: jest.fn().mockResolvedValue({ id: "sticky-1", type: "STICKY", text: "Updated" }),
		deleteSticky: jest.fn().mockResolvedValue({ deleted: true, nodeId: "sticky-1" }),
		createShape: jest.fn().mockResolvedValue({ id: "shape-1", type: "SHAPE_WITH_TEXT" }),
		createConnector: jest.fn().mockResolvedValue({ id: "conn-1", type: "CONNECTOR" }),
		createText: jest.fn().mockResolvedValue({ id: "text-1", type: "TEXT", text: "Hello" }),
		createSection: jest.fn().mockResolvedValue({ id: "section-1", type: "SECTION" }),
		getBoardNodes: jest.fn().mockResolvedValue([{ id: "n1", type: "STICKY" }]),
		getStickies: jest.fn().mockResolvedValue([{ id: "s1", type: "STICKY", text: "A" }]),
		getConnections: jest.fn().mockResolvedValue([{ id: "c1", type: "CONNECTOR" }]),
		moveNode: jest.fn().mockResolvedValue({ id: "n1", type: "STICKY", x: 0, y: 0 }),
	};
}

describe("FigJam tools contract", () => {
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

	it("registers the 20 FigJam tools", () => {
		expect(server.tool).toHaveBeenCalledTimes(20);
		const names = server.tool.mock.calls.map((c: any[]) => c[0]);
		expect(names).toEqual(
			expect.arrayContaining([
				"createSticky",
				"updateSticky",
				"deleteSticky",
				"createShape",
				"createConnector",
				"createText",
				"createSection",
				"getBoardNodes",
				"getStickies",
				"getConnections",
				"bulkCreateStickies",
				"findNodes",
				"createCluster",
				"summarizeBoard",
				"autoLayoutBoard",
				"ingestResearchNotes",
				"createReferenceWall",
				"organizeByTheme",
				"linkByRelation",
				"generateResearchBoard",
			]),
		);
	});

	it("validates createSticky schema and returns MCP response envelope", async () => {
		const tool = server._getTool("createSticky");
		expect(validate("createSticky", { text: "Idea", x: 1, y: 2 }).success).toBe(true);
		expect(validate("createSticky", { x: 1 }).success).toBe(false);

		const result = await tool.handler({ text: "Idea", x: 1, y: 2 });
		expect(result.isError).toBeUndefined();
		expect(result.content[0].type).toBe("text");
		const data = JSON.parse(result.content[0].text);
		expect(data.sticky.id).toBe("sticky-1");
	});

	it("validates updateSticky schema and handles invalid nodeId errors", async () => {
		const tool = server._getTool("updateSticky");
		expect(validate("updateSticky", { nodeId: "1:2", text: "New" }).success).toBe(true);
		expect(validate("updateSticky", { text: "Missing node id" }).success).toBe(false);

		client.updateSticky.mockRejectedValueOnce(new Error("Invalid nodeId: bad-id"));
		const result = await tool.handler({ nodeId: "bad-id", text: "New" });
		expect(result.isError).toBe(true);
		expect(result.content[0].type).toBe("text");
		const data = JSON.parse(result.content[0].text);
		expect(data.error).toContain("Invalid nodeId");
	});

	it("validates deleteSticky schema and handles invalid nodeId errors", async () => {
		const tool = server._getTool("deleteSticky");
		expect(validate("deleteSticky", { nodeId: "1:2" }).success).toBe(true);
		expect(validate("deleteSticky", {}).success).toBe(false);

		client.deleteSticky.mockRejectedValueOnce(new Error("Invalid nodeId: bad-id"));
		const result = await tool.handler({ nodeId: "bad-id" });
		expect(result.isError).toBe(true);
		const data = JSON.parse(result.content[0].text);
		expect(data.error).toContain("Invalid nodeId");
	});

	it("validates createShape schema and returns MCP response envelope", async () => {
		const tool = server._getTool("createShape");
		expect(validate("createShape", { type: "rectangle", text: "R" }).success).toBe(true);
		expect(validate("createShape", { type: "triangle" }).success).toBe(false);

		const result = await tool.handler({ type: "circle" });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.shape.type).toBe("SHAPE_WITH_TEXT");
	});

	it("validates createConnector schema and handles invalid nodeId errors", async () => {
		const tool = server._getTool("createConnector");
		expect(validate("createConnector", { fromNodeId: "1:2", toNodeId: "1:3" }).success).toBe(
			true,
		);
		expect(validate("createConnector", { fromNodeId: "1:2" }).success).toBe(false);

		client.createConnector.mockRejectedValueOnce(new Error("Invalid nodeId: missing endpoint"));
		const result = await tool.handler({ fromNodeId: "bad-id", toNodeId: "1:3" });
		expect(result.isError).toBe(true);
		const data = JSON.parse(result.content[0].text);
		expect(data.error).toContain("Invalid nodeId");
	});

	it("validates createText schema and returns MCP response envelope", async () => {
		const tool = server._getTool("createText");
		expect(validate("createText", { text: "Hello" }).success).toBe(true);
		expect(validate("createText", {}).success).toBe(false);

		const result = await tool.handler({ text: "Hello" });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.textNode.id).toBe("text-1");
	});

	it("validates createSection schema and returns MCP response envelope", async () => {
		const tool = server._getTool("createSection");
		expect(validate("createSection", { name: "Area A", x: 10 }).success).toBe(true);

		const result = await tool.handler({ name: "Area A" });
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(data.section.id).toBe("section-1");
	});

	it("returns board nodes with correct MCP response structure", async () => {
		const tool = server._getTool("getBoardNodes");
		expect(validate("getBoardNodes", {}).success).toBe(true);

		const result = await tool.handler({});
		expect(result.isError).toBeUndefined();
		expect(result.content[0].type).toBe("text");
		const data = JSON.parse(result.content[0].text);
		expect(Array.isArray(data.nodes)).toBe(true);
		expect(data.count).toBe(1);
	});

	it("returns stickies with correct MCP response structure", async () => {
		const tool = server._getTool("getStickies");
		expect(validate("getStickies", {}).success).toBe(true);

		const result = await tool.handler({});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(Array.isArray(data.stickies)).toBe(true);
		expect(data.count).toBe(1);
	});

	it("returns connections with correct MCP response structure", async () => {
		const tool = server._getTool("getConnections");
		expect(validate("getConnections", {}).success).toBe(true);

		const result = await tool.handler({});
		expect(result.isError).toBeUndefined();
		const data = JSON.parse(result.content[0].text);
		expect(Array.isArray(data.connections)).toBe(true);
		expect(data.count).toBe(1);
	});

	it("propagates plugin nodeId errors with MCP error envelopes on query tools", async () => {
		const boardTool = server._getTool("getBoardNodes");
		const stickyTool = server._getTool("getStickies");
		const connTool = server._getTool("getConnections");

		client.getBoardNodes.mockRejectedValueOnce(new Error("Invalid nodeId in board traversal"));
		client.getStickies.mockRejectedValueOnce(new Error("Invalid nodeId in sticky lookup"));
		client.getConnections.mockRejectedValueOnce(new Error("Invalid nodeId in connector lookup"));

		const boardRes = await boardTool.handler({});
		const stickyRes = await stickyTool.handler({});
		const connRes = await connTool.handler({});

		expect(boardRes.isError).toBe(true);
		expect(stickyRes.isError).toBe(true);
		expect(connRes.isError).toBe(true);
		expect(JSON.parse(boardRes.content[0].text).error).toContain("Invalid nodeId");
		expect(JSON.parse(stickyRes.content[0].text).error).toContain("Invalid nodeId");
		expect(JSON.parse(connRes.content[0].text).error).toContain("Invalid nodeId");
	});
});
