import {
	installGuardedToolWrapper,
} from "../src/core/guarded-tool-wrapper";

type Handler = (args: any) => Promise<any> | any;

function createMockMcpServer() {
	const handlers = new Map<string, Handler>();

	const server = {
		tool: jest.fn((name: string, _description: string, _schema: any, handler: Handler) => {
			handlers.set(name, handler);
		}),
		registerTool: jest.fn((name: string, _config: any, handler: Handler) => {
			handlers.set(name, handler);
		}),
	};

	return {
		server,
		getHandler(name: string): Handler {
			const h = handlers.get(name);
			if (!h) throw new Error(`Missing handler for tool: ${name}`);
			return h;
		},
	};
}

function parseTextPayload(result: any): any {
	expect(result?.content?.[0]?.type).toBe("text");
	return JSON.parse(result.content[0].text);
}

describe("Capability guard contracts", () => {
	it("blocks one representative tool from each blocked class in FigJam", async () => {
		const { server, getHandler } = createMockMcpServer();
		const upstreamHandler = jest.fn(async () => ({ content: [{ type: "text", text: "ok" }] }));

		installGuardedToolWrapper(server as any, {
			getConnectedFileInfo: () => ({ editorType: "figjam" }),
		});

		// variables/tokens
		(server as any).tool("figma_get_variables", "", {}, upstreamHandler);
		// components/instances (exercise registerTool path)
		(server as any).registerTool("figma_get_component", {}, upstreamHandler);
		// design-system
		(server as any).tool("figma_get_design_system_kit", "", {}, upstreamHandler);
		// design-code parity/doc
		(server as any).registerTool("figma_check_design_parity", {}, upstreamHandler);

		for (const name of [
			"figma_get_variables",
			"figma_get_component",
			"figma_get_design_system_kit",
			"figma_check_design_parity",
		]) {
			const res = await getHandler(name)({});
			expect(res.isError).toBe(true);
			const payload = parseTextPayload(res);
			expect(payload.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
			expect(payload.error.editorType).toBe("figjam");
			expect(payload.error.tool).toBe(name);
		}

		expect(upstreamHandler).not.toHaveBeenCalled();
	});

	it("runtime path: allows FigJam-native tool and blocks design-only tool", async () => {
		const { server, getHandler } = createMockMcpServer();
		const figjamHandler = jest.fn(async () => ({
			content: [{ type: "text", text: JSON.stringify({ sticky: { id: "s1" } }) }],
		}));
		const designOnlyHandler = jest.fn(async () => ({ content: [{ type: "text", text: "should-not-run" }] }));

		installGuardedToolWrapper(server as any, {
			getConnectedFileInfo: () => ({ editorType: "figjam" }),
		});

		(server as any).tool("createSticky", "", {}, figjamHandler);
		(server as any).tool("figma_get_variables", "", {}, designOnlyHandler);

		const ok = await getHandler("createSticky")({ text: "Idea" });
		expect(ok.isError).toBeUndefined();
		expect(parseTextPayload(ok).sticky.id).toBe("s1");
		expect(figjamHandler).toHaveBeenCalledTimes(1);

		const blocked = await getHandler("figma_get_variables")({});
		expect(blocked.isError).toBe(true);
		const payload = parseTextPayload(blocked);
		expect(payload.error.code).toBe("CAPABILITY_NOT_SUPPORTED");
		expect(payload.error.editorType).toBe("figjam");
		expect(designOnlyHandler).not.toHaveBeenCalled();
	});
});
