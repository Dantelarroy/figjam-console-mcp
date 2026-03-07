import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { ok, fail } from "../server/figjam-tooling.js";
import { createLinkWithImageFallback } from "./link-fallback.js";

export function registerLinkTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"createLink",
		"Create a FigJam URL reference. Uses native link card when metadata exists, otherwise falls back to clickable native link text plus screenshot preview.",
		{
			url: z.string().url().describe("URL to render as link card"),
			title: z.string().optional().describe("Optional display title"),
			x: z.number().optional().describe("X position"),
			y: z.number().optional().describe("Y position"),
			alias: z.string().optional().describe("Deterministic alias"),
			containerId: z.string().optional().describe("Structural container id"),
			groupId: z.string().optional().describe("Logical group id"),
			sourceUrl: z.string().optional().describe("Source URL"),
			role: z.string().optional().describe("Artifact role"),
			metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
		},
		async (input) => {
			try {
				const rendered = await createLinkWithImageFallback(getClient, {
					url: input.url,
					title: input.title,
					x: typeof input.x === "number" ? input.x : 0,
					y: typeof input.y === "number" ? input.y : 0,
					alias: input.alias,
					groupId: input.groupId,
					containerId: input.containerId,
					role: input.role,
				});
				return ok({
					mode: rendered.mode,
					link: rendered.primary,
					titleText: rendered.titleNode,
					imagePreview: rendered.imageNode,
					linkText: rendered.linkNode,
					fallbackReason: rendered.fallbackReason,
				});
			} catch (error) {
				return fail(error, "Failed to create link card");
			}
		},
	);
}
