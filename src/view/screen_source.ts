import type { Disposable } from "../types.js";

export type ScreenColorMode = "Default" | "Palette" | "Rgb";

/**
 * Rendering attributes of a run. `fg`/`bg` hold a palette index (0-255)
 * for `"Palette"`, `0xRRGGBB` for `"Rgb"`, and are ignored for `"Default"`.
 */
export interface ScreenAttrs {
	readonly fgMode: ScreenColorMode;
	readonly fg: number;
	readonly bgMode: ScreenColorMode;
	readonly bg: number;
	readonly bold: boolean;
	readonly italic: boolean;
	readonly underline: boolean;
	readonly dim: boolean;
	readonly inverse: boolean;
}

/** A stretch of text that shares one set of attributes. */
export interface ScreenRun {
	readonly text: string;
	readonly attrs: ScreenAttrs;
}

/**
 * One row. The runs' texts joined are the row's text, with a wide glyph
 * written once. `wrapped` is true when the row continues the row above it.
 */
export interface ScreenLine {
	readonly runs: readonly ScreenRun[];
	readonly wrapped: boolean;
}

/**
 * What changed since the previous notification. History changes are
 * applied in order: drop `removedTop` rows from the top, then append
 * `appended` rows at the bottom. `screenRows` lists the screen rows whose
 * content differs. `full` asks for a repaint from scratch and overrides
 * the rest; a source sends it on resize, on a buffer switch, or whenever
 * it cannot describe the change incrementally.
 */
export interface ScreenChange {
	readonly history: { readonly removedTop: number; readonly appended: number };
	readonly screenRows: readonly number[];
	readonly full: boolean;
}

/**
 * A read-only view of a terminal buffer: `history.length` rows of
 * scrollback (oldest first) above `rows` screen rows. The cursor is in
 * screen coordinates. `subscribe` fires after the source has changed;
 * the listener reads the new state straight from the source.
 */
export interface ScreenSource {
	readonly rows: number;
	readonly cols: number;
	readonly history: {
		readonly length: number;
		line(index: number): ScreenLine;
	};
	readonly screen: {
		line(row: number): ScreenLine;
	};
	readonly cursor: {
		readonly x: number;
		readonly y: number;
		readonly visible: boolean;
	};
	subscribe(listener: (change: ScreenChange) => void): Disposable;
}

/**
 * The cell surface both sterk's `BufferCell` and `@xterm/headless`'s
 * `IBufferCell` satisfy (xterm returns numbers for the style flags).
 */
export interface CellLike {
	getChars(): string;
	getWidth(): number;
	getFgColor(): number;
	getBgColor(): number;
	isFgDefault(): boolean;
	isFgPalette(): boolean;
	isBgDefault(): boolean;
	isBgPalette(): boolean;
	isBold(): boolean | number;
	isItalic(): boolean | number;
	isUnderline(): boolean | number;
	isDim(): boolean | number;
	isInverse(): boolean | number;
}

/** The line surface both sterk's `BufferLine` and xterm's `IBufferLine` satisfy. */
export interface LineLike {
	readonly isWrapped: boolean;
	getCell(x: number): CellLike | null | undefined;
}

function colorMode(isDefault: boolean, isPalette: boolean): ScreenColorMode {
	if (isDefault) return "Default";
	return isPalette ? "Palette" : "Rgb";
}

function cellAttrs(cell: CellLike): ScreenAttrs {
	return {
		fgMode: colorMode(cell.isFgDefault(), cell.isFgPalette()),
		fg: cell.getFgColor(),
		bgMode: colorMode(cell.isBgDefault(), cell.isBgPalette()),
		bg: cell.getBgColor(),
		bold: Boolean(cell.isBold()),
		italic: Boolean(cell.isItalic()),
		underline: Boolean(cell.isUnderline()),
		dim: Boolean(cell.isDim()),
		inverse: Boolean(cell.isInverse()),
	};
}

function sameAttrs(a: ScreenAttrs, b: ScreenAttrs): boolean {
	return (
		a.fgMode === b.fgMode &&
		a.fg === b.fg &&
		a.bgMode === b.bgMode &&
		a.bg === b.bg &&
		a.bold === b.bold &&
		a.italic === b.italic &&
		a.underline === b.underline &&
		a.dim === b.dim &&
		a.inverse === b.inverse
	);
}

/**
 * Convert a buffer line of `cols` cells into runs. Works on a sterk
 * `BufferLine` and on an `@xterm/headless` `IBufferLine` alike, so an
 * adapter over either is a few lines of glue. Reading an xterm buffer needs
 * the terminal built with `allowProposedApi: true`.
 */
export function screenLineFromCells(line: LineLike, cols: number): ScreenLine {
	const runs: { text: string; attrs: ScreenAttrs }[] = [];
	for (let x = 0; x < cols; x++) {
		const cell = line.getCell(x);
		if (!cell || cell.getWidth() === 0) continue;
		const text = cell.getChars() || " ";
		const attrs = cellAttrs(cell);
		const last = runs[runs.length - 1];
		if (last && sameAttrs(last.attrs, attrs)) {
			last.text += text;
			continue;
		}
		runs.push({ text, attrs });
	}
	return { runs, wrapped: line.isWrapped };
}

export function screenLineText(line: ScreenLine): string {
	let text = "";
	for (const run of line.runs) text += run.text;
	return text;
}
