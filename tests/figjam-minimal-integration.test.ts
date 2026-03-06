import { registerFigJamTools } from "../src/server/register-figjam-tools";
import { FigJamClient } from "../src/figjam-api/figjamClient";

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

describe("FigJam minimal integration", () => {
	it("Agent -> MCP tool -> FigJam plugin bridge -> node creation", async () => {
		const server = createMockServer();

		const connector = {
			executeCodeViaUI: jest.fn().mockImplementation(async (code: string) => {
				expect(code).toContain('figma.editorType !== "figjam"');
				expect(code).toContain("figma.createSticky()");
				return {
					success: true,
					result: {
						id: "sticky-integration-1",
						name: "Sticky",
						type: "STICKY",
						x: 200,
						y: 300,
						width: 300,
						height: 180,
						text: "Idea",
					},
				};
			}),
		};

		const client = new FigJamClient(async () => connector as any);
		registerFigJamTools(server as any, async () => client);

		const tool = server._getTool("createSticky");
		const response = await tool.handler({ text: "Idea", x: 200, y: 300 });
		const payload = JSON.parse(response.content[0].text);

		expect(response.isError).toBeUndefined();
		expect(connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
		expect(payload.sticky.id).toBe("sticky-integration-1");
		expect(payload.sticky.type).toBe("STICKY");
		expect(payload.sticky.text).toBe("Idea");
	});
});
