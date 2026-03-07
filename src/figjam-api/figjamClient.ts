import type { IFigmaConnector } from "../core/figma-connector.js";

export interface FigJamNodeSummary {
	id: string;
	name: string;
	type: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	text?: string;
	children?: FigJamNodeSummary[];
}

export interface CreateStickyInput {
	text: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}

export interface UpdateStickyInput {
	nodeId: string;
	text?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}

export interface CreateShapeInput {
	type: "rectangle" | "circle" | "diamond";
	text?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}

export interface CreateConnectorInput {
	fromNodeId: string;
	toNodeId: string;
}

export interface CreateTextInput {
	text: string;
	x?: number;
	y?: number;
	fontSize?: number;
}

export interface CreateLinkInput {
	url: string;
	title?: string;
	x?: number;
	y?: number;
}

export interface CreateSectionInput {
	name?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
}

export interface MoveNodeInput {
	nodeId: string;
	x: number;
	y: number;
}

export class FigJamClient {
	constructor(private readonly getConnector: () => Promise<IFigmaConnector>) {}

	private async execute<T>(userCode: string, timeoutMs = 8000): Promise<T> {
		const connector = await this.getConnector();
		const code = `
if (figma.editorType !== "figjam") {
  throw new Error("This MCP server only supports FigJam boards. Current editorType: " + figma.editorType);
}
${userCode}
`;

		const response = await connector.executeCodeViaUI(code, timeoutMs);
		if (!response?.success) {
			throw new Error(response?.error || "Unknown FigJam execution error");
		}
		return response.result as T;
	}

	async createSticky(input: CreateStickyInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
const sticky = figma.createSticky();
await figma.loadFontAsync(sticky.text.fontName);
sticky.text.characters = input.text;
if (typeof input.x === "number") sticky.x = input.x;
if (typeof input.y === "number") sticky.y = input.y;
if (typeof input.width === "number" && typeof input.height === "number") {
  sticky.resize(input.width, input.height);
}
figma.currentPage.appendChild(sticky);
return { id: sticky.id, name: sticky.name, type: sticky.type, x: sticky.x, y: sticky.y, width: sticky.width, height: sticky.height, text: sticky.text.characters };
`,
			12000,
		);
	}

	async updateSticky(input: UpdateStickyInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
const node = await figma.getNodeByIdAsync(input.nodeId);
if (!node || node.type !== "STICKY") {
  throw new Error("Sticky not found: " + input.nodeId);
}
if (typeof input.text === "string") {
  await figma.loadFontAsync(node.text.fontName);
  node.text.characters = input.text;
}
if (typeof input.x === "number") node.x = input.x;
if (typeof input.y === "number") node.y = input.y;
if (typeof input.width === "number" && typeof input.height === "number") {
  node.resize(input.width, input.height);
}
return { id: node.id, name: node.name, type: node.type, x: node.x, y: node.y, width: node.width, height: node.height, text: node.text.characters };
`,
			12000,
		);
	}

	async deleteSticky(nodeId: string): Promise<{ deleted: boolean; nodeId: string }> {
		return this.execute<{ deleted: boolean; nodeId: string }>(
			`
const nodeId = ${JSON.stringify(nodeId)};
const node = await figma.getNodeByIdAsync(nodeId);
if (!node || node.type !== "STICKY") {
  throw new Error("Sticky not found: " + nodeId);
}
node.remove();
return { deleted: true, nodeId };
`,
		);
	}

	async createShape(input: CreateShapeInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
const shape = figma.createShapeWithText();
const shapeMap = { rectangle: "SQUARE", circle: "ELLIPSE", diamond: "DIAMOND" };
shape.shapeType = shapeMap[input.type] || "SQUARE";
if (typeof input.text === "string") {
  await figma.loadFontAsync(shape.text.fontName);
  shape.text.characters = input.text;
}
if (typeof input.x === "number") shape.x = input.x;
if (typeof input.y === "number") shape.y = input.y;
if (typeof input.width === "number" && typeof input.height === "number") {
  shape.resize(input.width, input.height);
}
figma.currentPage.appendChild(shape);
return { id: shape.id, name: shape.name, type: shape.type, x: shape.x, y: shape.y, width: shape.width, height: shape.height, text: shape.text.characters };
`,
			12000,
		);
	}

	async createConnector(input: CreateConnectorInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
const fromNode = await figma.getNodeByIdAsync(input.fromNodeId);
const toNode = await figma.getNodeByIdAsync(input.toNodeId);
if (!fromNode) throw new Error("Source node not found: " + input.fromNodeId);
if (!toNode) throw new Error("Target node not found: " + input.toNodeId);
const connector = figma.createConnector();
connector.connectorStart = { endpointNodeId: fromNode.id, magnet: "AUTO" };
connector.connectorEnd = { endpointNodeId: toNode.id, magnet: "AUTO" };
figma.currentPage.appendChild(connector);
return { id: connector.id, name: connector.name, type: connector.type };
`,
			12000,
		);
	}

	async createText(input: CreateTextInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
const textNode = figma.createText();
await figma.loadFontAsync(textNode.fontName);
textNode.characters = input.text;
if (typeof input.fontSize === "number") textNode.fontSize = input.fontSize;
if (typeof input.x === "number") textNode.x = input.x;
if (typeof input.y === "number") textNode.y = input.y;
figma.currentPage.appendChild(textNode);
return { id: textNode.id, name: textNode.name, type: textNode.type, x: textNode.x, y: textNode.y, width: textNode.width, height: textNode.height, text: textNode.characters };
`,
			12000,
		);
	}

	async createLink(input: CreateLinkInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
if (typeof figma.createLinkPreviewAsync !== "function") {
  throw new Error("Link preview API is not available in this FigJam runtime");
}

let linkNode = null;
try {
  linkNode = await figma.createLinkPreviewAsync(input.url);
} catch (error) {
  throw new Error("Failed to create link preview: " + (error && error.message ? error.message : String(error)));
}

if (!linkNode) {
  throw new Error("Link preview API returned an empty node");
}

if (typeof input.x === "number" && typeof linkNode.x === "number") linkNode.x = input.x;
if (typeof input.y === "number" && typeof linkNode.y === "number") linkNode.y = input.y;
if (typeof input.title === "string" && input.title.trim().length > 0 && typeof linkNode.name === "string") {
  linkNode.name = input.title.trim();
}
if (!linkNode.parent) figma.currentPage.appendChild(linkNode);

// Strict quality gate: only keep rich cards/embeds.
if (linkNode.type === "LINK_UNFURL") {
  const data = linkNode.linkUnfurlData || {};
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description = typeof data.description === "string" ? data.description.trim() : "";
  const hasThumbnail = !!(data.thumbnailUrl || data.thumbnail);
  const hasFavicon = !!(data.favicon || data.faviconUrl);
  const isRich = Boolean(title || description || hasThumbnail || hasFavicon);
  if (!isRich) {
    linkNode.remove();
    throw new Error("Link preview exists but has no rich metadata (title/description/thumbnail/favicon).");
  }
}

if (typeof linkNode.setPluginData === "function") {
  linkNode.setPluginData("figjam.link.url", input.url);
  if (typeof input.title === "string" && input.title.trim().length > 0) {
    linkNode.setPluginData("figjam.link.title", input.title.trim());
  }
}

const urlValue = typeof linkNode.url === "string" ? linkNode.url : input.url;
return {
  id: linkNode.id,
  name: linkNode.name,
  type: linkNode.type,
  x: linkNode.x,
  y: linkNode.y,
  width: linkNode.width,
  height: linkNode.height,
  text: urlValue
};
`,
			12000,
		);
	}

	async createSection(input: CreateSectionInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
if (typeof figma.createSection !== "function") {
  throw new Error("Sections are not available in this FigJam environment");
}
const section = figma.createSection();
if (typeof input.name === "string" && input.name.length > 0) section.name = input.name;
if (typeof input.x === "number") section.x = input.x;
if (typeof input.y === "number") section.y = input.y;
if (typeof input.width === "number" && typeof input.height === "number") {
  section.resize(input.width, input.height);
}
figma.currentPage.appendChild(section);
return { id: section.id, name: section.name, type: section.type, x: section.x, y: section.y, width: section.width, height: section.height };
`,
			12000,
		);
	}

	async getBoardNodes(): Promise<FigJamNodeSummary[]> {
		return this.execute<FigJamNodeSummary[]>(
			`
function serialize(node) {
  const out = { id: node.id, name: node.name, type: node.type };
  if (typeof node.x === "number") out.x = node.x;
  if (typeof node.y === "number") out.y = node.y;
  if (typeof node.width === "number") out.width = node.width;
  if (typeof node.height === "number") out.height = node.height;
  if (node.type === "STICKY" && node.text) out.text = node.text.characters;
  if (node.type === "TEXT" && typeof node.characters === "string") out.text = node.characters;
  if (node.type === "SHAPE_WITH_TEXT" && node.text) out.text = node.text.characters;
  if (node.type === "LINK_UNFURL") {
    if (typeof node.url === "string") out.text = node.url;
    else if (node.link && typeof node.link.url === "string") out.text = node.link.url;
  }
  if (node.type === "CONNECTOR") {
    out.connectorStart = node.connectorStart || null;
    out.connectorEnd = node.connectorEnd || null;
  }
  if ("children" in node && Array.isArray(node.children) && node.children.length > 0) {
    out.children = node.children.map(serialize);
  }
  return out;
}
return figma.currentPage.children.map(serialize);
`,
			12000,
		);
	}

	async getStickies(): Promise<FigJamNodeSummary[]> {
		return this.execute<FigJamNodeSummary[]>(
			`
const stickies = figma.currentPage.findAll((node) => node.type === "STICKY");
return stickies.map((sticky) => ({
  id: sticky.id,
  name: sticky.name,
  type: sticky.type,
  x: sticky.x,
  y: sticky.y,
  width: sticky.width,
  height: sticky.height,
  text: sticky.text.characters,
}));
`,
			12000,
		);
	}

	async getConnections(): Promise<Array<Record<string, unknown>>> {
		return this.execute<Array<Record<string, unknown>>>(
			`
const connectors = figma.currentPage.findAll((node) => node.type === "CONNECTOR");
return connectors.map((connector) => ({
  id: connector.id,
  name: connector.name,
  type: connector.type,
  connectorStart: connector.connectorStart || null,
  connectorEnd: connector.connectorEnd || null,
  x: connector.x,
  y: connector.y,
  width: connector.width,
  height: connector.height,
}));
`,
			12000,
		);
	}

	async moveNode(input: MoveNodeInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
const node = await figma.getNodeByIdAsync(input.nodeId);
if (!node) throw new Error("Node not found: " + input.nodeId);
if (typeof node.x !== "number" || typeof node.y !== "number") {
  throw new Error("Node does not support positioning: " + node.type);
}
node.x = input.x;
node.y = input.y;
return {
  id: node.id,
  name: node.name,
  type: node.type,
  x: node.x,
  y: node.y,
  width: typeof node.width === "number" ? node.width : undefined,
  height: typeof node.height === "number" ? node.height : undefined
};
`,
			12000,
		);
	}
}
