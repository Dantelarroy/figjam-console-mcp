export type UiPreset = "dense" | "comfortable";
export type HeaderMode = "full" | "minimal";
export type ThemeColorMode = "auto" | "explicit";

export type Rgba = { r: number; g: number; b: number; a?: number };

export type ThemePalette = {
	sectionBg: Rgba;
	sectionStroke: Rgba;
	headerBg: Rgba;
	headerText: Rgba;
	cardStroke: Rgba;
};

export type LayoutTokens = {
	columnGapX: number;
	rowGapY: number;
	sectionPadding: number;
	headerToFirstCardGap: number;
	noteGap: number;
};

const DENSE_TOKENS: LayoutTokens = {
	columnGapX: 520,
	rowGapY: 300,
	sectionPadding: 20,
	headerToFirstCardGap: 54,
	noteGap: 20,
};

const COMFORTABLE_TOKENS: LayoutTokens = {
	columnGapX: 620,
	rowGapY: 360,
	sectionPadding: 28,
	headerToFirstCardGap: 64,
	noteGap: 28,
};

const PALETTE_POOL: ThemePalette[] = [
	{
		sectionBg: { r: 0.95, g: 0.98, b: 1, a: 1 },
		sectionStroke: { r: 0.66, g: 0.79, b: 0.95, a: 1 },
		headerBg: { r: 0.2, g: 0.42, b: 0.82, a: 1 },
		headerText: { r: 1, g: 1, b: 1, a: 1 },
		cardStroke: { r: 0.73, g: 0.83, b: 0.95, a: 1 },
	},
	{
		sectionBg: { r: 0.95, g: 1, b: 0.95, a: 1 },
		sectionStroke: { r: 0.66, g: 0.9, b: 0.72, a: 1 },
		headerBg: { r: 0.18, g: 0.6, b: 0.3, a: 1 },
		headerText: { r: 1, g: 1, b: 1, a: 1 },
		cardStroke: { r: 0.74, g: 0.92, b: 0.78, a: 1 },
	},
	{
		sectionBg: { r: 1, g: 0.96, b: 0.93, a: 1 },
		sectionStroke: { r: 0.95, g: 0.8, b: 0.67, a: 1 },
		headerBg: { r: 0.84, g: 0.46, b: 0.17, a: 1 },
		headerText: { r: 1, g: 1, b: 1, a: 1 },
		cardStroke: { r: 0.96, g: 0.84, b: 0.73, a: 1 },
	},
	{
		sectionBg: { r: 0.98, g: 0.94, b: 1, a: 1 },
		sectionStroke: { r: 0.84, g: 0.72, b: 0.95, a: 1 },
		headerBg: { r: 0.48, g: 0.28, b: 0.72, a: 1 },
		headerText: { r: 1, g: 1, b: 1, a: 1 },
		cardStroke: { r: 0.88, g: 0.79, b: 0.96, a: 1 },
	},
	{
		sectionBg: { r: 0.94, g: 1, b: 0.98, a: 1 },
		sectionStroke: { r: 0.68, g: 0.9, b: 0.83, a: 1 },
		headerBg: { r: 0.1, g: 0.56, b: 0.46, a: 1 },
		headerText: { r: 1, g: 1, b: 1, a: 1 },
		cardStroke: { r: 0.76, g: 0.92, b: 0.88, a: 1 },
	},
];

export const RESEARCH_UI_PALETTE_VERSION = "v1";

export function resolveLayoutTokens(uiPreset: UiPreset): LayoutTokens {
	return uiPreset === "comfortable" ? COMFORTABLE_TOKENS : DENSE_TOKENS;
}

function hashText(input: string): number {
	let h = 0;
	for (let i = 0; i < input.length; i += 1) h = (h * 31 + input.charCodeAt(i)) >>> 0;
	return h;
}

export function resolveThemePalette(theme: string, mode: ThemeColorMode): ThemePalette {
	const key = theme.trim().toLowerCase() || "theme";
	if (mode === "auto" && key === "board") {
		return PALETTE_POOL[0];
	}
	const idx = hashText(key) % PALETTE_POOL.length;
	return PALETTE_POOL[idx];
}

export function fallbackCardDimensions(uiPreset: UiPreset): { width: number; height: number } {
	return uiPreset === "comfortable" ? { width: 400, height: 280 } : { width: 360, height: 240 };
}
