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
	parentId?: string;
	pluginData?: Record<string, string>;
	connectorStart?: { endpointNodeId?: string; magnet?: string } | null;
	connectorEnd?: { endpointNodeId?: string; magnet?: string } | null;
}

export interface FigJamBoardScan {
	fileKey: string | null;
	pageId: string;
	pageName: string;
	generatedAt: string;
	nodes: FigJamNodeSummary[];
}

export interface CreateStickyInput {
	text: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	role?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface UpdateStickyInput {
	nodeId: string;
	text?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	role?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface CreateShapeInput {
	type: "rectangle" | "circle" | "diamond";
	text?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	role?: string;
	metadata?: Record<string, string | number | boolean>;
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
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	role?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface CreateUrlLinkTextInput {
	url: string;
	label?: string;
	x?: number;
	y?: number;
	fontSize?: number;
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	role?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface CreateLinkInput {
	url: string;
	title?: string;
	x?: number;
	y?: number;
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	role?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface CreateFallbackLinkCardInput {
	url: string;
	title?: string;
	x?: number;
	y?: number;
	cardWidth?: number;
	cardHeight?: number;
	imageBytes: number[];
	mimeType: string;
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	role?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface CreateSectionInput {
	name?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	role?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface InsertImageInput {
	imageBytes: number[];
	mimeType: string;
	title?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface MoveNodeInput {
	nodeId: string;
	x: number;
	y: number;
}

export interface DeleteNodeResult {
	deleted: boolean;
	nodeId: string;
}

export interface UpdateNodeInput {
	nodeId: string;
	title?: string;
	text?: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	alias?: string;
	containerId?: string;
	groupId?: string;
	sourceUrl?: string;
	role?: string;
	metadata?: Record<string, string | number | boolean>;
}

export interface CaptureNodeScreenshotResult {
	nodeId: string;
	format: "PNG";
	byteLength: number;
	bounds: { x: number; y: number; width: number; height: number };
}

export interface FigJamRuntimeCapabilities {
	supportsSections: boolean;
	supportsRichUnfurl: boolean;
	supportsImageInsert: boolean;
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

	async getRuntimeCapabilities(): Promise<FigJamRuntimeCapabilities> {
		return this.execute<FigJamRuntimeCapabilities>(
			`
const supportsSections = typeof figma.createSection === "function";
const supportsImageInsert = typeof figma.createImage === "function";
const supportsRichUnfurl = typeof figma.createLinkPreviewAsync === "function";
return {
  supportsSections,
  supportsRichUnfurl,
  supportsImageInsert
};
`,
			8000,
		);
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
if (typeof sticky.setPluginData === "function") {
  if (typeof input.role === "string" && input.role.trim().length > 0) sticky.setPluginData("figjam.role", input.role.trim());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) sticky.setPluginData("figjam.alias", input.alias.trim());
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) sticky.setPluginData("figjam.containerId", input.containerId.trim());
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) sticky.setPluginData("figjam.groupId", input.groupId.trim());
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) sticky.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  if (input.metadata && typeof input.metadata === "object") sticky.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  sticky.setPluginData("figjam.updatedAt", new Date().toISOString());
}
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
if (typeof node.setPluginData === "function") {
  if (typeof input.role === "string" && input.role.trim().length > 0) node.setPluginData("figjam.role", input.role.trim());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) node.setPluginData("figjam.alias", input.alias.trim());
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) node.setPluginData("figjam.containerId", input.containerId.trim());
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) node.setPluginData("figjam.groupId", input.groupId.trim());
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) node.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  if (input.metadata && typeof input.metadata === "object") node.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  node.setPluginData("figjam.updatedAt", new Date().toISOString());
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
if (typeof shape.setPluginData === "function") {
  if (typeof input.role === "string" && input.role.trim().length > 0) shape.setPluginData("figjam.role", input.role.trim());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) shape.setPluginData("figjam.alias", input.alias.trim());
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) shape.setPluginData("figjam.containerId", input.containerId.trim());
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) shape.setPluginData("figjam.groupId", input.groupId.trim());
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) shape.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  if (input.metadata && typeof input.metadata === "object") shape.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  shape.setPluginData("figjam.updatedAt", new Date().toISOString());
}
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
if (typeof textNode.setPluginData === "function") {
  if (typeof input.role === "string" && input.role.trim().length > 0) textNode.setPluginData("figjam.role", input.role.trim());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) textNode.setPluginData("figjam.alias", input.alias.trim());
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) textNode.setPluginData("figjam.containerId", input.containerId.trim());
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) textNode.setPluginData("figjam.groupId", input.groupId.trim());
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) textNode.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  if (input.metadata && typeof input.metadata === "object") textNode.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  textNode.setPluginData("figjam.updatedAt", new Date().toISOString());
}
return { id: textNode.id, name: textNode.name, type: textNode.type, x: textNode.x, y: textNode.y, width: textNode.width, height: textNode.height, text: textNode.characters };
`,
			12000,
		);
	}

	async createUrlLinkText(input: CreateUrlLinkTextInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
const textNode = figma.createText();
await figma.loadFontAsync(textNode.fontName);
const textValue = typeof input.label === "string" && input.label.trim().length > 0 ? input.label.trim() : input.url;
textNode.characters = textValue;
if (typeof input.fontSize === "number") textNode.fontSize = input.fontSize;
if (typeof input.x === "number") textNode.x = input.x;
if (typeof input.y === "number") textNode.y = input.y;
if (typeof textNode.setRangeHyperlink === "function") {
  textNode.setRangeHyperlink(0, textNode.characters.length, { type: "URL", value: input.url });
}
figma.currentPage.appendChild(textNode);
if (typeof textNode.setPluginData === "function") {
  textNode.setPluginData("figjam.link.url", input.url);
  if (typeof input.role === "string" && input.role.trim().length > 0) textNode.setPluginData("figjam.role", input.role.trim());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) textNode.setPluginData("figjam.alias", input.alias.trim());
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) textNode.setPluginData("figjam.containerId", input.containerId.trim());
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) textNode.setPluginData("figjam.groupId", input.groupId.trim());
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) textNode.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  if (input.metadata && typeof input.metadata === "object") textNode.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  textNode.setPluginData("figjam.updatedAt", new Date().toISOString());
}
return { id: textNode.id, name: textNode.name, type: textNode.type, x: textNode.x, y: textNode.y, width: textNode.width, height: textNode.height, text: textNode.characters };
`,
			12000,
		);
	}

	async createFallbackLinkCard(input: CreateFallbackLinkCardInput): Promise<{
		card: FigJamNodeSummary;
		linkText: FigJamNodeSummary;
		titleText: FigJamNodeSummary;
		image: FigJamNodeSummary;
	}> {
		return this.execute<{
			card: FigJamNodeSummary;
			linkText: FigJamNodeSummary;
			titleText: FigJamNodeSummary;
			image: FigJamNodeSummary;
		}>(
			`
const input = ${JSON.stringify(input)};
if (!Array.isArray(input.imageBytes) || input.imageBytes.length === 0) {
  throw new Error("Missing image payload");
}
if (!input.mimeType || typeof input.mimeType !== "string") {
  throw new Error("Missing mimeType");
}
if (typeof figma.createImage !== "function") {
  throw new Error("IMAGE_INSERT_NOT_SUPPORTED: FigJam runtime does not expose createImage");
}

const x = typeof input.x === "number" ? input.x : 0;
const y = typeof input.y === "number" ? input.y : 0;
const cardWidth = typeof input.cardWidth === "number" ? input.cardWidth : 420;
const cardHeight = typeof input.cardHeight === "number" ? input.cardHeight : 320;
const fullTitle = typeof input.title === "string" && input.title.trim().length > 0 ? input.title.trim() : input.url;
const title = fullTitle.length > 72 ? fullTitle.slice(0, 69) + "..." : fullTitle;
const hostText = (() => {
  try {
    const parsed = new URL(input.url);
    return parsed.hostname.replace(/^www\\./i, "");
  } catch {
    return input.url;
  }
})();

const imageBytes = new Uint8Array(input.imageBytes);
const image = figma.createImage(imageBytes);

const bg = figma.createRectangle();
bg.name = title;
bg.resize(cardWidth, cardHeight);
bg.x = x;
bg.y = y;
bg.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
bg.strokes = [{ type: "SOLID", color: { r: 0.86, g: 0.89, b: 0.93 } }];
bg.strokeWeight = 1;
if ("cornerRadius" in bg) bg.cornerRadius = 12;

const titleText = figma.createText();
await figma.loadFontAsync(titleText.fontName);
titleText.characters = title;
titleText.fontSize = 18;
titleText.x = x + 18;
titleText.y = y + 12;

const linkText = figma.createText();
await figma.loadFontAsync(linkText.fontName);
linkText.characters = hostText;
if (typeof linkText.setRangeHyperlink === "function") {
  linkText.setRangeHyperlink(0, linkText.characters.length, { type: "URL", value: input.url });
}
linkText.fontSize = 12;
linkText.x = x + 18;
linkText.y = y + 40;

const imageNode = figma.createRectangle();
imageNode.name = title + " Preview";
imageNode.x = x + 18;
imageNode.y = y + 62;
imageNode.resize(cardWidth - 36, cardHeight - 80);
imageNode.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
if ("cornerRadius" in imageNode) imageNode.cornerRadius = 8;

figma.currentPage.appendChild(bg);
figma.currentPage.appendChild(titleText);
figma.currentPage.appendChild(linkText);
figma.currentPage.appendChild(imageNode);

let cardNode = bg;
if (typeof figma.group === "function") {
  cardNode = figma.group([bg, titleText, linkText, imageNode], figma.currentPage);
  cardNode.name = title;
}

const setMeta = (node) => {
  if (typeof node.setPluginData !== "function") return;
  node.setPluginData("figjam.link.url", input.url);
  if (typeof input.role === "string" && input.role.trim().length > 0) node.setPluginData("figjam.role", input.role.trim());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) node.setPluginData("figjam.alias", input.alias.trim());
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) node.setPluginData("figjam.containerId", input.containerId.trim());
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) node.setPluginData("figjam.groupId", input.groupId.trim());
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) node.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  if (input.metadata && typeof input.metadata === "object") node.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  node.setPluginData("figjam.updatedAt", new Date().toISOString());
};

setMeta(cardNode);
setMeta(titleText);
setMeta(linkText);
setMeta(imageNode);

return {
  card: { id: cardNode.id, name: cardNode.name, type: cardNode.type, x: cardNode.x, y: cardNode.y, width: cardNode.width, height: cardNode.height, text: input.url },
  titleText: { id: titleText.id, name: titleText.name, type: titleText.type, x: titleText.x, y: titleText.y, width: titleText.width, height: titleText.height, text: titleText.characters },
  linkText: { id: linkText.id, name: linkText.name, type: linkText.type, x: linkText.x, y: linkText.y, width: linkText.width, height: linkText.height, text: linkText.characters },
  image: { id: imageNode.id, name: imageNode.name, type: imageNode.type, x: imageNode.x, y: imageNode.y, width: imageNode.width, height: imageNode.height }
};
`,
			15000,
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

if (typeof linkNode.setPluginData === "function") {
  linkNode.setPluginData("figjam.link.url", input.url);
  if (typeof input.title === "string" && input.title.trim().length > 0) linkNode.setPluginData("figjam.link.title", input.title.trim());
  if (typeof input.role === "string" && input.role.trim().length > 0) linkNode.setPluginData("figjam.role", input.role.trim());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) linkNode.setPluginData("figjam.alias", input.alias.trim());
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) linkNode.setPluginData("figjam.containerId", input.containerId.trim());
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) linkNode.setPluginData("figjam.groupId", input.groupId.trim());
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) linkNode.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  if (input.metadata && typeof input.metadata === "object") linkNode.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  if (input.metadata && typeof input.metadata.runId === "string") linkNode.setPluginData("figjam.runId", input.metadata.runId);
  if (input.metadata && typeof input.metadata.itemKey === "string") linkNode.setPluginData("figjam.itemKey", input.metadata.itemKey);
  linkNode.setPluginData("figjam.updatedAt", new Date().toISOString());
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
if (typeof section.setPluginData === "function") {
  if (typeof input.role === "string" && input.role.trim().length > 0) section.setPluginData("figjam.role", input.role.trim());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) section.setPluginData("figjam.alias", input.alias.trim());
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) section.setPluginData("figjam.containerId", input.containerId.trim());
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) section.setPluginData("figjam.groupId", input.groupId.trim());
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) section.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  if (input.metadata && typeof input.metadata === "object") section.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  section.setPluginData("figjam.updatedAt", new Date().toISOString());
}
return { id: section.id, name: section.name, type: section.type, x: section.x, y: section.y, width: section.width, height: section.height };
`,
			12000,
		);
	}

	async insertImage(input: InsertImageInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
if (!Array.isArray(input.imageBytes) || input.imageBytes.length === 0) {
  throw new Error("Missing image payload");
}
if (!input.mimeType || typeof input.mimeType !== "string") {
  throw new Error("Missing mimeType");
}

if (typeof figma.createImage !== "function") {
  throw new Error("IMAGE_INSERT_NOT_SUPPORTED: FigJam runtime does not expose createImage");
}

const imageBytes = new Uint8Array(input.imageBytes);
const image = figma.createImage(imageBytes);
const imageSize = await image.getSizeAsync();

let node = null;
if (typeof figma.createRectangle === "function") {
  node = figma.createRectangle();
} else if (typeof figma.createShapeWithText === "function") {
  node = figma.createShapeWithText();
  node.shapeType = "SQUARE";
  if (node.text && node.text.fontName) {
    await figma.loadFontAsync(node.text.fontName);
    node.text.characters = "";
  }
} else {
  throw new Error("IMAGE_INSERT_NOT_SUPPORTED: no rectangle/shape constructor available");
}

const targetWidth = typeof input.width === "number" ? input.width : imageSize.width;
const targetHeight = typeof input.height === "number" ? input.height : imageSize.height;
if (typeof node.resize === "function") {
  node.resize(targetWidth, targetHeight);
}

if (typeof input.x === "number") node.x = input.x;
if (typeof input.y === "number") node.y = input.y;
if (typeof input.title === "string" && input.title.trim().length > 0) {
  node.name = input.title.trim();
}

if ("fills" in node) {
  node.fills = [
    {
      type: "IMAGE",
      imageHash: image.hash,
      scaleMode: "FILL"
    }
  ];
}

figma.currentPage.appendChild(node);

if (typeof node.setPluginData === "function") {
  node.setPluginData("figjam.role", "image_reference");
  node.setPluginData("figjam.updatedAt", new Date().toISOString());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) {
    node.setPluginData("figjam.alias", input.alias.trim());
  }
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) {
    node.setPluginData("figjam.containerId", input.containerId.trim());
  }
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) {
    node.setPluginData("figjam.groupId", input.groupId.trim());
  }
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) {
    node.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  }
  if (input.metadata && typeof input.metadata === "object") {
    node.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  }
}

return {
  id: node.id,
  name: node.name,
  type: node.type,
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height
};
`,
			15000,
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

	async captureNodeScreenshot(nodeId: string, scale = 2): Promise<CaptureNodeScreenshotResult> {
		return this.execute<CaptureNodeScreenshotResult>(
			`
const input = ${JSON.stringify({ nodeId, scale })};
const node = await figma.getNodeByIdAsync(input.nodeId);
if (!node) throw new Error("Node not found: " + input.nodeId);
if (typeof node.exportAsync !== "function") {
  throw new Error("NODE_EXPORT_NOT_SUPPORTED");
}
const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: input.scale } });
const bounds = ("x" in node && "y" in node && "width" in node && "height" in node)
  ? { x: Number(node.x || 0), y: Number(node.y || 0), width: Number(node.width || 0), height: Number(node.height || 0) }
  : { x: 0, y: 0, width: 0, height: 0 };
return {
  nodeId: node.id,
  format: "PNG",
  byteLength: bytes.length,
  bounds
};
`,
			15000,
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

	async deleteNode(nodeId: string): Promise<DeleteNodeResult> {
		return this.execute<DeleteNodeResult>(
			`
const nodeId = ${JSON.stringify(nodeId)};
const node = await figma.getNodeByIdAsync(nodeId);
if (!node) throw new Error("Node not found: " + nodeId);
if (typeof node.remove !== "function") {
  throw new Error("Node does not support removal: " + node.type);
}
node.remove();
return { deleted: true, nodeId };
`,
			12000,
		);
	}

	async updateNode(input: UpdateNodeInput): Promise<FigJamNodeSummary> {
		return this.execute<FigJamNodeSummary>(
			`
const input = ${JSON.stringify(input)};
const node = await figma.getNodeByIdAsync(input.nodeId);
if (!node) throw new Error("Node not found: " + input.nodeId);

if (typeof input.title === "string" && input.title.trim().length > 0) {
  node.name = input.title.trim();
}
if (typeof input.x === "number" && typeof node.x === "number") node.x = input.x;
if (typeof input.y === "number" && typeof node.y === "number") node.y = input.y;
if (typeof input.width === "number" && typeof input.height === "number" && typeof node.resize === "function") {
  node.resize(input.width, input.height);
}

if (typeof input.text === "string") {
  if (node.type === "STICKY") {
    await figma.loadFontAsync(node.text.fontName);
    node.text.characters = input.text;
  } else if (node.type === "TEXT") {
    await figma.loadFontAsync(node.fontName);
    node.characters = input.text;
  } else if (node.type === "SHAPE_WITH_TEXT") {
    await figma.loadFontAsync(node.text.fontName);
    node.text.characters = input.text;
  } else {
    throw new Error("Node type does not support text update: " + node.type);
  }
}

if (typeof node.setPluginData === "function") {
  if (typeof input.role === "string" && input.role.trim().length > 0) node.setPluginData("figjam.role", input.role.trim());
  if (typeof input.alias === "string" && input.alias.trim().length > 0) node.setPluginData("figjam.alias", input.alias.trim());
  if (typeof input.containerId === "string" && input.containerId.trim().length > 0) node.setPluginData("figjam.containerId", input.containerId.trim());
  if (typeof input.groupId === "string" && input.groupId.trim().length > 0) node.setPluginData("figjam.groupId", input.groupId.trim());
  if (typeof input.sourceUrl === "string" && input.sourceUrl.trim().length > 0) node.setPluginData("figjam.sourceUrl", input.sourceUrl.trim());
  if (input.metadata && typeof input.metadata === "object") node.setPluginData("figjam.metadata", JSON.stringify(input.metadata));
  node.setPluginData("figjam.updatedAt", new Date().toISOString());
}

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
return out;
`,
			12000,
		);
	}

	async scanBoardState(): Promise<FigJamBoardScan> {
		return this.execute<FigJamBoardScan>(
			`
function readPluginData(node) {
  const data = {};
  if (typeof node.getPluginDataKeys !== "function" || typeof node.getPluginData !== "function") {
    return data;
  }
  for (const key of node.getPluginDataKeys()) {
    if (!key.startsWith("figjam.")) continue;
    const value = node.getPluginData(key);
    if (typeof value === "string" && value.length > 0) {
      data[key] = value;
    }
  }
  return data;
}

function serialize(node, parentId) {
  const out = {
    id: node.id,
    name: node.name,
    type: node.type,
    parentId,
    pluginData: readPluginData(node),
  };
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
    out.children = node.children.map((child) => serialize(child, node.id));
  }
  return out;
}

const page = figma.currentPage;
return {
  fileKey: typeof figma.fileKey === "string" ? figma.fileKey : null,
  pageId: page.id,
  pageName: page.name,
  generatedAt: new Date().toISOString(),
  nodes: page.children.map((node) => serialize(node, page.id)),
};
`,
			12000,
		);
	}
}
