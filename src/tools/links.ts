import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { ok, fail } from "../server/figjam-tooling.js";

export function registerLinkTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"createLink",
		"Create a native FigJam link card preview from a URL. Fails if runtime or URL metadata cannot produce a rich card.",
		{
			url: z.string().url().describe("URL to render as link card"),
			title: z.string().optional().describe("Optional display title"),
			x: z.number().optional().describe("X position"),
			y: z.number().optional().describe("Y position"),
		},
		async (input) => {
			try {
				const client = await getClient();
				const link = await client.createLink(input);
				return ok({ link });
			} catch (error) {
				return fail(error, "Failed to create link card");
			}
		},
	);
}
