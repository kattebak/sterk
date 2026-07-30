/**
 * Shared snapshot/dump helpers for the corpus test gates.
 *
 * These produce deterministic, diffable representations of buffer state:
 *   - per-cell attribute dumps (char + compact fg/bg encoding + style flags)
 *   - token streams via the VtMode Ace tokenizer
 *
 * Used by test/corpus.tokens.test.ts (static frames) and
 * test/corpus.animation.test.ts (in-place cumulative redraws).
 */

import type { BufferNamespaceImpl } from "../src/buffer/scroll_buffer.js";
import type { createTerminal } from "../src/index.js";
import { VtMode } from "../src/renderer/vt_mode.js";

export type Term = ReturnType<typeof createTerminal>;

/** Compact mode+value encoding for a fg/bg color. */
export function encodeColor(
	mode: "default" | "palette" | "rgb",
	value: number,
): string {
	if (mode === "default") return "default";
	if (mode === "palette") return `p${value}`;
	return `#${(value >>> 0).toString(16).padStart(6, "0")}`;
}

export interface CellDump {
	ch: string;
	fg: string;
	bg: string;
	/** xterm 1/0 contract: 1 = set, 0 = unset. */
	bold: number;
	italic: number;
	underline: number;
	inverse: number;
	dim: number;
}

export interface TokenDump {
	type: string;
	value: string;
}

/** Number of columns on the active scroll buffer. */
export function activeCols(term: Term): number {
	return (term.buffer as unknown as BufferNamespaceImpl)._getScrollBuffer()
		.cols;
}

/** Full per-cell attribute dump for one cell. */
export function dumpCell(cell: import("../src/types.js").BufferCell): CellDump {
	const fg = cell.isFgDefault()
		? encodeColor("default", -1)
		: cell.isFgPalette()
			? encodeColor("palette", cell.getFgColor())
			: encodeColor("rgb", cell.getFgColor());
	const bg = cell.isBgDefault()
		? encodeColor("default", -1)
		: cell.isBgPalette()
			? encodeColor("palette", cell.getBgColor())
			: encodeColor("rgb", cell.getBgColor());
	return {
		ch: cell.getChars(),
		fg,
		bg,
		bold: cell.isBold(),
		italic: cell.isItalic(),
		underline: cell.isUnderline(),
		inverse: cell.isInverse(),
		dim: cell.isDim(),
	};
}

/** True if a cell dump is a fully-default blank cell (space/empty, no attrs). */
export function isDefaultBlank(c: CellDump): boolean {
	return (
		(c.ch === " " || c.ch === "") &&
		c.fg === "default" &&
		c.bg === "default" &&
		!c.bold &&
		!c.italic &&
		!c.underline &&
		!c.inverse &&
		!c.dim
	);
}

/**
 * Per-cell attribute dump for a row, trimming trailing all-default blank cells
 * so snapshots stay tight.
 */
export function dumpCells(term: Term, row: number): CellDump[] {
	const line = term.buffer.active.getLine(row);
	if (!line) return [];
	const cols = activeCols(term);

	const cells: CellDump[] = [];
	for (let x = 0; x < cols; x++) {
		cells.push(dumpCell(line.getCell(x)));
	}

	let end = cells.length;
	while (end > 0) {
		const last = cells[end - 1];
		if (!last || !isDefaultBlank(last)) break;
		end--;
	}
	return cells.slice(0, end);
}

/** Token stream for a row via the VtMode Ace tokenizer. */
export function dumpTokens(term: Term, row: number): TokenDump[] {
	const bufferNs = term.buffer as unknown as BufferNamespaceImpl;
	const line = term.buffer.active.getLine(row);
	if (!line) return [];
	const mode = new VtMode(bufferNs);
	// VtMode's tokenizer takes (lineText, state, row); the Ace type only
	// declares (line, state), so widen to the runtime signature.
	const tokenizer = mode.getMode().getTokenizer() as unknown as {
		getLineTokens: (
			lineText: string,
			state: string,
			row: number,
		) => { tokens: { type: string; value: string }[] };
	};
	const result = tokenizer.getLineTokens(
		line.translateToString(false),
		"start",
		row,
	);
	return result.tokens.map((t) => ({ type: t.type, value: t.value }));
}

/** Joined token values for a row (for token/document parity checks). */
export function joinedTokenValues(term: Term, row: number): string {
	return dumpTokens(term, row)
		.map((t) => t.value)
		.join("");
}
