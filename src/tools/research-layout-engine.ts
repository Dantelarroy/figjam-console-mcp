export type LayoutMode = "grid" | "column";

export type LayoutInput = {
	mode: LayoutMode;
	originX: number;
	originY: number;
	columns: number;
	gapX: number;
	gapY: number;
};

export type PlannedSlot = {
	index: number;
	column: number;
	x: number;
	y: number;
};

export type PlannedColumnCursor = {
	columnCount: number;
	cursorByColumn: number[];
};

export function computePlannedSlots(
	layout: LayoutInput,
	itemHeights: number[],
): { slots: PlannedSlot[]; cursors: PlannedColumnCursor } {
	const columns = Math.max(1, layout.columns || 1);
	const cursorByColumn = Array.from({ length: columns }, () => layout.originY);
	const slots: PlannedSlot[] = [];

	for (let i = 0; i < itemHeights.length; i += 1) {
		if (layout.mode === "grid") {
			const column = i % columns;
			const x = layout.originX + column * layout.gapX;
			const y = layout.originY + Math.floor(i / columns) * layout.gapY;
			slots.push({ index: i, column, x, y });
			continue;
		}

		const column = i % columns;
		const x = layout.originX + column * layout.gapX;
		const y = cursorByColumn[column];
		slots.push({ index: i, column, x, y });
		cursorByColumn[column] += Math.max(1, itemHeights[i]) + layout.gapY;
	}

	return {
		slots,
		cursors: { columnCount: columns, cursorByColumn },
	};
}

export type MeasuredPlacement = {
	index: number;
	column: number;
	x: number;
	y: number;
	height: number;
};

export function computeMeasuredColumnReflow(
	layout: LayoutInput,
	placements: MeasuredPlacement[],
): Array<{ index: number; x: number; y: number }> {
	if (layout.mode !== "column") {
		return placements.map((p) => ({ index: p.index, x: p.x, y: p.y }));
	}
	const columns = Math.max(1, layout.columns || 1);
	const cursorByColumn = Array.from({ length: columns }, () => layout.originY);
	const out: Array<{ index: number; x: number; y: number }> = [];

	for (const p of [...placements].sort((a, b) => a.index - b.index)) {
		const y = cursorByColumn[p.column];
		cursorByColumn[p.column] += Math.max(1, p.height) + layout.gapY;
		out.push({ index: p.index, x: p.x, y });
	}
	return out;
}

export function computeOverlapCount(
	items: Array<{ x: number; y: number; width: number; height: number }>,
): number {
	const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
	let overlapCount = 0;
	for (const item of items) {
		const overlaps = boxes.some(
			(box) =>
				item.x < box.x + box.width &&
				item.x + item.width > box.x &&
				item.y < box.y + box.height &&
				item.y + item.height > box.y,
		);
		if (overlaps) overlapCount += 1;
		boxes.push(item);
	}
	return overlapCount;
}
