import { access, mkdir, readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import type { Browser, LaunchOptions } from "puppeteer-core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GetFigJamClient } from "../server/figjam-tooling.js";
import { ok } from "../server/figjam-tooling.js";

const insertLocalImageSchema = {
	localPath: z.string().min(1).describe("Absolute local path to image file"),
	x: z.number().optional(),
	y: z.number().optional(),
	width: z.number().positive().optional(),
	height: z.number().positive().optional(),
	title: z.string().optional(),
	alias: z.string().optional(),
	containerId: z.string().optional(),
	groupId: z.string().optional(),
	sourceUrl: z.string().url().optional(),
	metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
};

const createImageReferenceSchema = {
	localPath: z.string().min(1).describe("Absolute local path to image file"),
	sourceUrl: z.string().url().optional(),
	title: z.string().optional(),
	summary: z.string().optional(),
	alias: z.string().optional(),
	tags: z.array(z.string()).max(20).optional().default([]),
	x: z.number().optional(),
	y: z.number().optional(),
	width: z.number().positive().optional(),
	height: z.number().positive().optional(),
	containerId: z.string().optional(),
	groupId: z.string().optional(),
};

const captureWebImageSchema = {
	url: z.string().url(),
	selector: z.string().optional(),
	selectors: z.array(z.string()).min(1).max(10).optional(),
	x: z.number().int().nonnegative().optional(),
	y: z.number().int().nonnegative().optional(),
	width: z.number().int().positive().optional(),
	height: z.number().int().positive().optional(),
	outputDir: z.string().optional().default("/tmp/figjam-captures"),
	filenamePrefix: z.string().optional().default("capture"),
	format: z.enum(["png", "jpeg"]).optional().default("png"),
	timeoutMs: z.number().int().positive().max(30000).optional().default(10000),
	strict: z.boolean().optional().default(true),
};

const MIME_BY_EXT: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
};

function buildError(errorCode: string, message: string, details?: unknown) {
	return {
		isError: true as const,
		content: [
			{
				type: "text" as const,
				text: JSON.stringify({
					errorCode,
					message,
					details,
				}),
			},
		],
	};
}

function nowStamp(): string {
	const d = new Date();
	const pad = (v: number) => String(v).padStart(2, "0");
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

async function resolveBrowserPath(): Promise<string | null> {
	const candidates = [
		process.env.FIGJAM_CAPTURE_BROWSER_PATH,
		process.env.PUPPETEER_EXECUTABLE_PATH,
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Chromium.app/Contents/MacOS/Chromium",
	].filter((v): v is string => typeof v === "string" && v.length > 0);

	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Continue search
		}
	}
	return null;
}

async function runWebCapture(input: {
	url: string;
	selector?: string;
	selectors?: string[];
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	outputDir: string;
	filenamePrefix: string;
	format: "png" | "jpeg";
	timeoutMs: number;
	strict: boolean;
}): Promise<{
	localPath: string;
	url: string;
	sourceUrl: string;
	selectorUsed?: string;
	mode: "selector" | "clip" | "fullPage";
	format: "png" | "jpeg";
	width?: number;
	height?: number;
	capturedAt: string;
}> {
	const hasClip =
		typeof input.x === "number" &&
		typeof input.y === "number" &&
		typeof input.width === "number" &&
		typeof input.height === "number";
	const hasSelectorPath =
		(typeof input.selector === "string" && input.selector.trim().length > 0) ||
		(Array.isArray(input.selectors) && input.selectors.length > 0);

	if (!hasClip && !hasSelectorPath && input.strict) {
		throw new Error("NO_CAPTURE_TARGET");
	}

	const browserPath = await resolveBrowserPath();
	if (!browserPath) {
		throw new Error("BROWSER_NOT_AVAILABLE");
	}

	const puppeteer = await import("puppeteer-core");
	let browser: Browser | null = null;
	try {
		const launchOptions: LaunchOptions = {
			executablePath: browserPath,
			headless: true,
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		};
		browser = await puppeteer.default.launch(launchOptions);
		const page = await browser.newPage();
		await page.goto(input.url, { waitUntil: "networkidle2", timeout: input.timeoutMs });

		await mkdir(input.outputDir, { recursive: true });
		const localPath = `${input.outputDir}/${input.filenamePrefix}-${nowStamp()}.${input.format}`;

		let mode: "selector" | "clip" | "fullPage" = "fullPage";
		let selectorUsed: string | undefined;
		let width: number | undefined;
		let height: number | undefined;

		if (typeof input.selector === "string" && input.selector.trim().length > 0) {
			const handle = await page.$(input.selector);
			if (!handle) throw new Error("NO_CAPTURE_TARGET");
			const box = await handle.boundingBox();
			if (!box) throw new Error("ELEMENT_NOT_VISIBLE");
			await handle.screenshot({ path: localPath, type: input.format });
			mode = "selector";
			selectorUsed = input.selector;
			width = Math.round(box.width);
			height = Math.round(box.height);
		} else if (Array.isArray(input.selectors) && input.selectors.length > 0) {
			let captured = false;
			for (const selector of input.selectors) {
				const handle = await page.$(selector);
				if (!handle) continue;
				const box = await handle.boundingBox();
				if (!box) continue;
				await handle.screenshot({ path: localPath, type: input.format });
				mode = "selector";
				selectorUsed = selector;
				width = Math.round(box.width);
				height = Math.round(box.height);
				captured = true;
				break;
			}
			if (!captured) throw new Error("NO_CAPTURE_TARGET");
		} else if (hasClip) {
			await page.screenshot({
				path: localPath,
				type: input.format,
				clip: {
					x: input.x as number,
					y: input.y as number,
					width: input.width as number,
					height: input.height as number,
				},
			});
			mode = "clip";
			width = input.width;
			height = input.height;
		} else {
			await page.screenshot({ path: localPath, type: input.format, fullPage: true });
			mode = "fullPage";
		}

		return {
			localPath,
			url: input.url,
			sourceUrl: input.url,
			selectorUsed,
			mode,
			format: input.format,
			width,
			height,
			capturedAt: new Date().toISOString(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("Navigation")) throw new Error("NAVIGATION_FAILED");
		if (message.includes("NO_CAPTURE_TARGET")) throw new Error("NO_CAPTURE_TARGET");
		if (message.includes("ELEMENT_NOT_VISIBLE")) throw new Error("ELEMENT_NOT_VISIBLE");
		throw new Error(`SCREENSHOT_FAILED:${message}`);
	} finally {
		if (browser) await browser.close();
	}
}

async function readLocalImage(localPath: string): Promise<{ imageBytes: number[]; mimeType: string }> {
	const ext = extname(localPath).toLowerCase();
	const mimeType = MIME_BY_EXT[ext];
	if (!mimeType) {
		throw new Error("UNSUPPORTED_IMAGE_FORMAT");
	}
	const buffer = await readFile(localPath);
	return {
		imageBytes: Array.from(buffer.values()),
		mimeType,
	};
}

export function registerImageTools(server: McpServer, getClient: GetFigJamClient): void {
	server.tool(
		"captureWebImage",
		"Capture a deterministic web image screenshot to local disk for FigJam insertion.",
		captureWebImageSchema,
		async (input) => {
			try {
				const capture = await runWebCapture({
					url: input.url,
					selector: input.selector,
					selectors: input.selectors,
					x: input.x,
					y: input.y,
					width: input.width,
					height: input.height,
					outputDir: input.outputDir ?? "/tmp/figjam-captures",
					filenamePrefix: input.filenamePrefix ?? "capture",
					format: input.format ?? "png",
					timeoutMs: input.timeoutMs ?? 10000,
					strict: input.strict ?? true,
				});
				return ok({ capture });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("NO_CAPTURE_TARGET")) {
					return buildError("NO_CAPTURE_TARGET", "No deterministic capture target was provided/found");
				}
				if (message.includes("BROWSER_NOT_AVAILABLE")) {
					return buildError(
						"BROWSER_NOT_AVAILABLE",
						"No browser executable found. Set FIGJAM_CAPTURE_BROWSER_PATH or install Chrome/Chromium.",
					);
				}
				if (message.includes("NAVIGATION_FAILED")) {
					return buildError("NAVIGATION_FAILED", "Failed to navigate to URL");
				}
				if (message.includes("ELEMENT_NOT_VISIBLE")) {
					return buildError("ELEMENT_NOT_VISIBLE", "Target element is not visible");
				}
				if (message.includes("SCREENSHOT_FAILED")) {
					return buildError("SCREENSHOT_FAILED", "Failed to capture screenshot", { error: message });
				}
				return buildError("INVALID_INPUT", "Failed to capture web image", { error: message });
			}
		},
	);

	server.tool(
		"insertLocalImage",
		"Insert a local image file into FigJam as a deterministic image artifact with metadata.",
		insertLocalImageSchema,
		async (input) => {
			try {
				const { imageBytes, mimeType } = await readLocalImage(input.localPath);
				const client = await getClient();
				const imageNode = await client.insertImage({
					imageBytes,
					mimeType,
					title: input.title,
					x: input.x,
					y: input.y,
					width: input.width,
					height: input.height,
					alias: input.alias,
					containerId: input.containerId,
					groupId: input.groupId,
					sourceUrl: input.sourceUrl,
					metadata: input.metadata,
				});

				return ok({
					artifact: {
						nodeId: imageNode.id,
						type: imageNode.type,
						x: imageNode.x,
						y: imageNode.y,
						width: imageNode.width,
						height: imageNode.height,
						alias: input.alias,
						containerId: input.containerId,
						groupId: input.groupId,
						sourceUrl: input.sourceUrl,
						updatedAt: new Date().toISOString(),
					},
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("ENOENT")) {
					return buildError("FILE_NOT_FOUND", "Local image file not found", { localPath: input.localPath });
				}
				if (message.includes("UNSUPPORTED_IMAGE_FORMAT")) {
					return buildError("UNSUPPORTED_IMAGE_FORMAT", "Supported formats: png, jpg, jpeg, webp");
				}
				if (message.includes("IMAGE_INSERT_NOT_SUPPORTED")) {
					return buildError("IMAGE_INSERT_NOT_SUPPORTED", message);
				}
				if (message.includes("No active Figma connector")) {
					return buildError("BRIDGE_NOT_CONNECTED", "FigJam bridge is not connected");
				}
				return buildError("INVALID_INPUT", "Failed to insert local image", { error: message });
			}
		},
	);

	server.tool(
		"createImageReference",
		"Create a structured image reference artifact from a local image path.",
		createImageReferenceSchema,
		async (input) => {
			try {
				const { imageBytes, mimeType } = await readLocalImage(input.localPath);
				const client = await getClient();
				const alias =
					typeof input.alias === "string" && input.alias.trim().length > 0
						? input.alias.trim()
						: basename(input.localPath).replace(/\.[^.]+$/, "");

				const metadata: Record<string, string | number | boolean> = {
					role: "image_reference",
					updatedAt: new Date().toISOString(),
				};
				if (typeof input.title === "string" && input.title.trim().length > 0) metadata.title = input.title.trim();
				if (typeof input.summary === "string" && input.summary.trim().length > 0) {
					metadata.summary = input.summary.trim();
				}
				if (Array.isArray(input.tags) && input.tags.length > 0) metadata.tags = input.tags.join(",");

				const node = await client.insertImage({
					imageBytes,
					mimeType,
					title: input.title,
					x: input.x,
					y: input.y,
					width: input.width,
					height: input.height,
					alias,
					containerId: input.containerId,
					groupId: input.groupId,
					sourceUrl: input.sourceUrl,
					metadata,
				});

				return ok({
					reference: {
						artifactNodeId: node.id,
						alias,
						type: "image_reference",
						sourceUrl: input.sourceUrl,
						containerId: input.containerId,
						groupId: input.groupId,
						metadata: {
							title: input.title,
							summary: input.summary,
							tags: input.tags ?? [],
						},
						updatedAt: new Date().toISOString(),
					},
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (message.includes("ENOENT")) {
					return buildError("FILE_NOT_FOUND", "Local image file not found", { localPath: input.localPath });
				}
				if (message.includes("UNSUPPORTED_IMAGE_FORMAT")) {
					return buildError("UNSUPPORTED_IMAGE_FORMAT", "Supported formats: png, jpg, jpeg, webp");
				}
				if (message.includes("IMAGE_INSERT_NOT_SUPPORTED")) {
					return buildError("IMAGE_INSERT_NOT_SUPPORTED", message);
				}
				if (message.includes("No active Figma connector")) {
					return buildError("BRIDGE_NOT_CONNECTED", "FigJam bridge is not connected");
				}
				return buildError("INVALID_INPUT", "Failed to create image reference", { error: message });
			}
		},
	);
}
