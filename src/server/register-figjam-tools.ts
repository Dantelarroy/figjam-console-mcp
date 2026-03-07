import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GetFigJamClient } from "./figjam-tooling.js";
import { registerStickyTools } from "../tools/stickies.js";
import { registerShapeTools } from "../tools/shapes.js";
import { registerLinkTools } from "../tools/links.js";
import { registerConnectorTools } from "../tools/connectors.js";
import { registerTextTools } from "../tools/text.js";
import { registerSectionTools } from "../tools/sections.js";
import { registerBoardTools } from "../tools/board.js";
import { registerImageTools } from "../tools/images.js";
import { registerWorkflowTools } from "../tools/workflows.js";
import { registerResearchWorkspaceTools } from "../tools/research-workspace.js";
import { registerDBITools } from "../tools/dbi.js";

export function registerFigJamTools(server: McpServer, getClient: GetFigJamClient): void {
	registerStickyTools(server, getClient);
	registerShapeTools(server, getClient);
	registerLinkTools(server, getClient);
	registerConnectorTools(server, getClient);
	registerTextTools(server, getClient);
	registerSectionTools(server, getClient);
	registerBoardTools(server, getClient);
	registerImageTools(server, getClient);
	registerWorkflowTools(server, getClient);
	registerResearchWorkspaceTools(server, getClient);
	registerDBITools(server, getClient);
}
