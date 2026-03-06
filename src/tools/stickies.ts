import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { ok, fail } from "../server/figjam-tooling.js";

export function registerStickyTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"createSticky",
		"Create a sticky note in a FigJam board.",
		{
			text: z.string().min(1).describe("Sticky text content"),
			x: z.number().optional().describe("X position"),
			y: z.number().optional().describe("Y position"),
			width: z.number().optional().describe("Width"),
			height: z.number().optional().describe("Height"),
		},
		async (input) => {
			try {
				const client = await getClient();
				const sticky = await client.createSticky(input);
				return ok({ sticky });
			} catch (error) {
				return fail(error, "Failed to create sticky");
			}
		},
	);

	server.tool(
		"updateSticky",
		"Update an existing sticky note in a FigJam board.",
		{
			nodeId: z.string().min(1).describe("Sticky node id"),
			text: z.string().optional().describe("New sticky text"),
			x: z.number().optional().describe("X position"),
			y: z.number().optional().describe("Y position"),
			width: z.number().optional().describe("Width"),
			height: z.number().optional().describe("Height"),
		},
		async (input) => {
			try {
				const client = await getClient();
				const sticky = await client.updateSticky(input);
				return ok({ sticky });
			} catch (error) {
				return fail(error, "Failed to update sticky");
			}
		},
	);

	server.tool(
		"deleteSticky",
		"Delete a sticky note by node id.",
		{
			nodeId: z.string().min(1).describe("Sticky node id"),
		},
		async ({ nodeId }) => {
			try {
				const client = await getClient();
				const result = await client.deleteSticky(nodeId);
				return ok(result);
			} catch (error) {
				return fail(error, "Failed to delete sticky");
			}
		},
	);
}
