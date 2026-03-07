import { access, mkdir, readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Browser, LaunchOptions } from "puppeteer-core";
import type { FigJamNodeSummary } from "../figjam-api/figjamClient.js";
import type { GetFigJamClient } from "../server/figjam-tooling.js";

const MIME_BY_EXT: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
};

function deriveTitleFromUrl(url: string): string {
	try {
		const u = new URL(url);
		const host = u.hostname.replace(/^www\./i, "");
		const path = u.pathname.replace(/^\/+|\/+$/g, "");
		const pathHead = path ? path.split("/")[0] : "";
		if (!pathHead) return host;
		return `${host} / ${pathHead}`.slice(0, 120);
	} catch {
		return url.slice(0, 120);
	}
}

function normalizeDisplayTitle(url: string, title?: string): string {
	const raw = (title || "").trim();
	if (!raw) return deriveTitleFromUrl(url);
	const lower = raw.toLowerCase();
	if (lower.includes("fallback") || /^\d{8,}$/.test(raw.replace(/\D/g, ""))) {
		return deriveTitleFromUrl(url);
	}
	return raw.slice(0, 120);
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

async function captureWebImageToFile(url: string, outputDir = "/tmp/figjam-captures"): Promise<string> {
	const browserPath = await resolveBrowserPath();
	if (!browserPath) throw new Error("BROWSER_NOT_AVAILABLE");
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
		await page.goto(url, { waitUntil: "networkidle2", timeout: 12000 });
		await mkdir(outputDir, { recursive: true });
		const out = `${outputDir}/link-preview-${nowStamp()}.png`;
		await page.screenshot({
			path: out,
			type: "png",
			clip: { x: 0, y: 0, width: 1280, height: 720 },
		});
		return out;
	} finally {
		if (browser) await browser.close();
	}
}

async function readLocalImage(localPath: string): Promise<{ imageBytes: number[]; mimeType: string }> {
	const ext = extname(localPath).toLowerCase();
	const mimeType = MIME_BY_EXT[ext];
	if (!mimeType) throw new Error("UNSUPPORTED_IMAGE_FORMAT");
	const buffer = await readFile(localPath);
	return { imageBytes: Array.from(buffer.values()), mimeType };
}

export async function createLinkWithImageFallback(
	getClient: GetFigJamClient,
	input: {
		url: string;
		title?: string;
		x: number;
		y: number;
		alias?: string;
		groupId?: string;
		containerId?: string;
		role?: string;
		preferNative?: boolean;
	},
): Promise<{
	mode: "native_link" | "fallback_link_image";
	primary: FigJamNodeSummary;
	imageNode: FigJamNodeSummary | null;
	linkNode: FigJamNodeSummary | null;
	titleNode: FigJamNodeSummary | null;
	fallbackReason: string | null;
}> {
	const client = await getClient();
	const displayTitle = normalizeDisplayTitle(input.url, input.title);
	try {
		if (input.preferNative === false) {
			throw new Error("NATIVE_LINK_BYPASSED");
		}
		const link = await client.createLink({
			url: input.url,
			title: displayTitle,
			x: input.x,
			y: input.y,
			alias: input.alias,
			groupId: input.groupId,
			containerId: input.containerId,
			role: input.role || "reference",
			sourceUrl: input.url,
		});
		return {
			mode: "native_link",
			primary: link,
			imageNode: null,
			linkNode: link,
			titleNode: null,
			fallbackReason: null,
		};
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		let linkText: FigJamNodeSummary | null = null;
		let titleNode: FigJamNodeSummary | null = null;

		let imageNode: FigJamNodeSummary | null = null;
		let primary: FigJamNodeSummary;
		try {
			const filePath = await captureWebImageToFile(input.url);
			const { imageBytes, mimeType } = await readLocalImage(filePath);
			const card = await client.createFallbackLinkCard({
				url: input.url,
				title: displayTitle,
				x: input.x,
				y: input.y,
				imageBytes,
				mimeType,
				alias: input.alias,
				groupId: input.groupId,
				containerId: input.containerId,
				role: "reference_fallback_card",
				sourceUrl: input.url,
				metadata: { fallbackMode: "link_with_image", fallbackReason: reason },
			});
			primary = card.card;
			linkText = card.linkText;
			titleNode = card.titleText;
			imageNode = card.image;
		} catch {
			const text = await client.createUrlLinkText({
				url: input.url,
				label: displayTitle,
				x: input.x,
				y: input.y,
				fontSize: 20,
				alias: input.alias,
				groupId: input.groupId,
				containerId: input.containerId,
				role: "reference_link_text",
				sourceUrl: input.url,
				metadata: { fallbackReason: reason },
			});
			primary = text;
			linkText = text;
			titleNode = text;
			imageNode = null;
		}

		return {
			mode: "fallback_link_image",
			primary,
			imageNode,
			linkNode: linkText,
			titleNode,
			fallbackReason: reason,
		};
	}
}
