export type EditorType = "figma" | "figjam" | "slides" | "unknown";

export type CapabilityKey =
	| "variables"
	| "components"
	| "designSystem"
	| "designCode"
	| "figjamPrimitives";

export interface CapabilityContext {
	editorType: EditorType;
	capabilities: Record<CapabilityKey, boolean>;
	source: "fileInfo" | "runtime" | "url" | "default";
	resolvedAt: number;
}

export interface CapabilityContextDependencies {
	getConnectedFileInfo?: () => any | null;
	getCurrentUrl?: () => string | null;
	getDesktopConnector?: () => Promise<any>;
	cacheTtlMs?: number;
}

const DEFAULT_CACHE_TTL_MS = 2000;

let cachedContext: CapabilityContext | null = null;

function normalizeEditorType(value: unknown): EditorType {
	if (typeof value !== "string") return "unknown";
	const normalized = value.toLowerCase();
	if (normalized === "figjam") return "figjam";
	if (normalized === "figma") return "figma";
	if (normalized === "slides") return "slides";
	return "unknown";
}

function inferEditorTypeFromUrl(url: string | null): EditorType {
	if (!url) return "unknown";
	const normalized = url.toLowerCase();
	if (normalized.includes("/board/")) return "figjam";
	if (normalized.includes("/design/")) return "figma";
	if (normalized.includes("/slides/")) return "slides";
	return "unknown";
}

function capabilitiesForEditorType(editorType: EditorType): Record<CapabilityKey, boolean> {
	switch (editorType) {
		case "figjam":
			return {
				variables: false,
				components: false,
				designSystem: false,
				designCode: false,
				figjamPrimitives: true,
			};
		case "figma":
		case "slides":
			return {
				variables: true,
				components: true,
				designSystem: true,
				designCode: true,
				figjamPrimitives: true,
			};
		case "unknown":
		default:
			// Fail-open to preserve upstream behavior when editor detection isn't available.
			return {
				variables: true,
				components: true,
				designSystem: true,
				designCode: true,
				figjamPrimitives: true,
			};
	}
}

async function resolveEditorTypeFromRuntime(getDesktopConnector?: () => Promise<any>): Promise<EditorType> {
	if (!getDesktopConnector) return "unknown";

	try {
		const connector = await getDesktopConnector();
		if (!connector?.executeInPluginContext) return "unknown";

		const result = await connector.executeInPluginContext(`(function () {
			try {
				if (typeof figma === "undefined") return "unknown";
				return String(figma.editorType || "unknown");
			} catch {
				return "unknown";
			}
		})()`);

		return normalizeEditorType(result);
	} catch {
		return "unknown";
	}
}

export async function resolveCapabilityContext(
	deps: CapabilityContextDependencies,
): Promise<CapabilityContext> {
	const now = Date.now();
	const ttl = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;

	if (cachedContext && now - cachedContext.resolvedAt < ttl) {
		return cachedContext;
	}

	const fileInfo = deps.getConnectedFileInfo?.() || null;
	const fileInfoEditorType = normalizeEditorType(fileInfo?.editorType);
	if (fileInfoEditorType !== "unknown") {
		cachedContext = {
			editorType: fileInfoEditorType,
			capabilities: capabilitiesForEditorType(fileInfoEditorType),
			source: "fileInfo",
			resolvedAt: now,
		};
		return cachedContext;
	}

	const runtimeEditorType = await resolveEditorTypeFromRuntime(deps.getDesktopConnector);
	if (runtimeEditorType !== "unknown") {
		cachedContext = {
			editorType: runtimeEditorType,
			capabilities: capabilitiesForEditorType(runtimeEditorType),
			source: "runtime",
			resolvedAt: now,
		};
		return cachedContext;
	}

	const urlEditorType = inferEditorTypeFromUrl(deps.getCurrentUrl?.() || null);
	if (urlEditorType !== "unknown") {
		cachedContext = {
			editorType: urlEditorType,
			capabilities: capabilitiesForEditorType(urlEditorType),
			source: "url",
			resolvedAt: now,
		};
		return cachedContext;
	}

	cachedContext = {
		editorType: "unknown",
		capabilities: capabilitiesForEditorType("unknown"),
		source: "default",
		resolvedAt: now,
	};
	return cachedContext;
}
