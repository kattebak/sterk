/**
 * Scrollback buffer implementation with ring buffer and line wrapping.
 *
 * This is a clean-room implementation designed to satisfy the Buffer/BufferLine/BufferCell
 * interfaces defined in src/types.ts. It provides a ring buffer for storing terminal lines
 * with support for line wrapping and reflow on resize.
 *
 * Design notes:
 * - Lines are stored in a circular buffer to efficiently handle scrollback
 * - Each cell stores character content and SGR attributes (colors, bold, italic, etc.)
 * - Line wrapping is tracked via the isWrapped flag on BufferLine
 * - Reflow on resize is deferred to M2 (VT core will need to coordinate this)
 */

import type {
	Buffer,
	BufferCell,
	BufferLine,
	BufferNamespace,
	Disposable,
} from "../types.js";
import { EventEmitter } from "../util/event_emitter.js";
import { wcwidth } from "../util/wcwidth.js";

/**
 * SGR (Select Graphic Rendition) attributes for a cell.
 * Stores colors and text style flags.
 */
export interface CellAttributes {
	/** Foreground color mode: 0 = default, 1 = palette (0-255), 2 = RGB (24-bit) */
	fgMode: 0 | 1 | 2;
	/** Foreground color value: -1 for default, 0-255 for palette, 0xRRGGBB for RGB */
	fgColor: number;
	/** Background color mode: 0 = default, 1 = palette (0-255), 2 = RGB (24-bit) */
	bgMode: 0 | 1 | 2;
	/** Background color value: -1 for default, 0-255 for palette, 0xRRGGBB for RGB */
	bgColor: number;
	/** Bold flag (SGR 1) */
	bold: boolean;
	/** Italic flag (SGR 3) */
	italic: boolean;
	/** Underline flag (SGR 4) */
	underline: boolean;
	/** Inverse/reverse video flag (SGR 7) */
	inverse: boolean;
	/** Dim flag (SGR 2) */
	dim: boolean;
}

/**
 * Default cell attributes (all flags off, default colors).
 */
export const DEFAULT_CELL_ATTRIBUTES: CellAttributes = {
	fgMode: 0,
	fgColor: -1,
	bgMode: 0,
	bgColor: -1,
	bold: false,
	italic: false,
	underline: false,
	inverse: false,
	dim: false,
};

/**
 * Cell data structure.
 * Stores character content and SGR attributes.
 *
 * Wide-character placeholders (the trailing cell of a width-2 glyph)
 * carry `chars: ""` and `isPlaceholder: true`. They contribute zero
 * characters to `translateToString()` (so a line containing one CJK
 * ideograph yields a 1-char string, not 2), but they still hold a slot
 * in the cells array — so cursor X arithmetic stays in cell-units.
 */
export interface Cell {
	/** Character content (may be multi-char for wide/combining glyphs, empty for placeholders) */
	chars: string;
	/** Unicode code point of first character */
	code: number;
	/** SGR attributes */
	attrs: CellAttributes;
	/**
	 * True if this cell is the trailing slot of a width-2 (wide) glyph.
	 * Placeholder cells render no glyph but still occupy a column so the
	 * cursor advances in cell-units. The leading wide cell's `chars`
	 * carries the actual glyph; the placeholder's `chars` is `""`.
	 */
	isPlaceholder?: boolean;
}

/**
 * Create a blank cell with default attributes.
 */
export function createBlankCell(): Cell {
	return {
		chars: " ",
		code: 32,
		attrs: { ...DEFAULT_CELL_ATTRIBUTES },
	};
}

/**
 * Line data structure.
 * Stores an array of cells and line-level metadata.
 */
export interface Line {
	/** Array of cells (length = cols) */
	cells: Cell[];
	/** True if this line is wrapped from the previous line */
	isWrapped: boolean;
}

/**
 * Create a blank line with the specified number of columns.
 */
export function createBlankLine(cols: number): Line {
	const cells: Cell[] = [];
	for (let i = 0; i < cols; i++) {
		cells.push(createBlankCell());
	}
	return {
		cells,
		isWrapped: false,
	};
}

/**
 * Implementation of BufferCell interface.
 */
class BufferCellImpl implements BufferCell {
	constructor(private cell: Cell) {}

	getChars(): string {
		return this.cell.chars;
	}

	getCode(): number {
		return this.cell.code;
	}

	getWidth(): number {
		// Trailing slot of a width-2 glyph occupies a column but renders no
		// glyph — report width 0 (xterm.js semantics).
		if (this.cell.isPlaceholder) {
			return 0;
		}
		// Otherwise derive from the cell's own code point. wcwidth returns
		// -1 (unprintable) / 0 (combining) / 1 / 2; clamp anything non-2
		// down to a minimum of 1 so a normal printable / combining-base
		// cell stays width 1.
		const w = wcwidth(this.cell.code);
		return w === 2 ? 2 : w === 0 ? 0 : 1;
	}

	// Foreground color accessors
	isFgDefault(): boolean {
		return this.cell.attrs.fgMode === 0;
	}

	isFgPalette(): boolean {
		return this.cell.attrs.fgMode === 1;
	}

	isFgRGB(): boolean {
		return this.cell.attrs.fgMode === 2;
	}

	getFgColor(): number {
		return this.cell.attrs.fgColor;
	}

	getFgColorMode(): number {
		return this.cell.attrs.fgMode === 0
			? 0x000
			: this.cell.attrs.fgMode === 1
				? 0x100
				: 0x200;
	}

	// Background color accessors
	isBgDefault(): boolean {
		return this.cell.attrs.bgMode === 0;
	}

	isBgPalette(): boolean {
		return this.cell.attrs.bgMode === 1;
	}

	isBgRGB(): boolean {
		return this.cell.attrs.bgMode === 2;
	}

	getBgColor(): number {
		return this.cell.attrs.bgColor;
	}

	getBgColorMode(): number {
		return this.cell.attrs.bgMode === 0
			? 0x000
			: this.cell.attrs.bgMode === 1
				? 0x100
				: 0x200;
	}

	// Text style accessors
	isBold(): boolean {
		return this.cell.attrs.bold;
	}

	isItalic(): boolean {
		return this.cell.attrs.italic;
	}

	isUnderline(): boolean {
		return this.cell.attrs.underline;
	}

	isInverse(): boolean {
		return this.cell.attrs.inverse;
	}

	isDim(): boolean {
		return this.cell.attrs.dim;
	}
}

/**
 * Implementation of BufferLine interface.
 */
class BufferLineImpl implements BufferLine {
	constructor(private line: Line) {}

	get isWrapped(): boolean {
		return this.line.isWrapped;
	}

	get length(): number {
		return this.line.cells.length;
	}

	translateToString(trimRight = false): string {
		let text = this.line.cells.map((cell) => cell.chars).join("");
		if (trimRight) {
			// Trim both leading and trailing whitespace for cleaner output
			text = text.trim();
		}
		return text;
	}

	getCell(x: number): BufferCell {
		const cell = this.line.cells[x];
		return cell
			? new BufferCellImpl(cell)
			: new BufferCellImpl(createBlankCell());
	}
}

/**
 * A live anchor into the buffer for a registered marker.
 *
 * `absoluteRow` is in the buffer's ABSOLUTE coordinate space (the same
 * space as `Buffer.length` / `getLine(y)` / `baseY`): row 0 is the oldest
 * line currently retained, and the value moves DOWN (towards 0) relative to
 * the live window as scrollback accrues and the window scrolls past it.
 *
 * The buffer mutates `absoluteRow` in lock-step with line shifts so the
 * marker keeps pointing at the same logical line, and calls `onScrolledOut`
 * exactly once when that line falls out of the retained buffer.
 */
export interface MarkerAnchor {
	/** Current absolute buffer row index of the anchored line. */
	absoluteRow: number;
	/** Invoked once when the anchored line scrolls out of the buffer. */
	onScrolledOut: () => void;
}

/**
 * Scrollback buffer implementation.
 * Uses a ring buffer to efficiently store terminal lines with scrollback.
 */
export class ScrollBuffer implements Buffer {
	private lines: Line[] = [];
	private maxLines: number;
	/** Number of columns in the buffer */
	cols: number;
	private rows: number;
	/** Which screen role this buffer serves ("normal" | "alternate") */
	private _type: "normal" | "alternate";

	/** Absolute row index of the first scrollback line */
	private _baseY = 0;
	/** Absolute row index of the topmost visible row */
	private _viewportY = 0;
	/** Cursor X position (column) */
	private _cursorX = 0;
	/** Cursor Y position (row, relative to viewport) */
	private _cursorY = 0;
	private scrollback: number;
	private scrollTop = 0;
	private scrollBottom: number;
	private wrapPending = false;

	/**
	 * Live marker anchors. Each anchor pins itself to a buffer ABSOLUTE row
	 * (i.e. `baseY`-based, the same coordinate space `Buffer.length` /
	 * `getLine(y)` use). As lines shift out of the ring (oldest dropped when
	 * capacity is hit, `_baseY` incremented), an anchor's absolute row stays
	 * fixed while the live window moves past it; once the anchored row drops
	 * below `_baseY` (scrolled out of the buffer entirely) the anchor is
	 * pruned and notified so it can auto-dispose, matching xterm.js marker
	 * semantics. Anchors are append-only registrations; pruning + explicit
	 * dispose remove them.
	 */
	private markerAnchors: MarkerAnchor[] = [];

	constructor(
		cols: number,
		rows: number,
		scrollback: number,
		type: "normal" | "alternate" = "normal",
	) {
		this.cols = cols;
		this.rows = rows;
		this._type = type;
		this.scrollback = scrollback;
		this.maxLines = rows + scrollback;
		this.scrollBottom = rows - 1;

		// Initialize with blank lines
		for (let i = 0; i < rows; i++) {
			this.lines.push(createBlankLine(cols));
		}
	}

	// ── Buffer interface implementation ──────────────────────────────

	get length(): number {
		return this.lines.length;
	}

	get cursorX(): number {
		return this._cursorX;
	}

	get cursorY(): number {
		return this._cursorY;
	}

	get baseY(): number {
		return this._baseY;
	}

	get viewportY(): number {
		return this._viewportY;
	}

	get type(): "normal" | "alternate" {
		return this._type;
	}

	/**
	 * Absolute row index of the topmost row of the live screen.
	 *
	 * The live screen always occupies the bottom `rows` lines of the
	 * buffer; everything above it is scrollback. CSI sequences whose
	 * coordinates are screen-relative (CUP, HVP, ED, EL, …) must
	 * translate viewport-relative (0-based) rows to absolute row indices
	 * by adding this offset before touching the buffer — otherwise a
	 * "move to row N" after the buffer has grown past `rows` lands in
	 * scrollback instead of on the live screen.
	 *
	 * Pinned to `Math.max(0, lines.length - rows)` so:
	 *  - empty/cold buffer (`lines.length === rows`)        → 0
	 *  - alt screen (scrollback disabled)                   → 0
	 *  - normal screen with N rows of scrollback above live → N
	 *
	 * Regression context: the tmux/zsh "magenta status bar" duplication
	 * on Pixel 7 (mobux #N) was the CSI CUP / HVP / ED handlers passing
	 * `p1 - 1` as an absolute index instead of a viewport-relative one.
	 * Each `\x1b[<rows>;1H` from a status redraw landed at the same
	 * absolute row, so as content scrolled the previous status froze in
	 * scrollback and a new one painted at the (now-different) absolute
	 * row — accumulating one stale bar per refresh.
	 */
	get liveTop(): number {
		return Math.max(0, this.lines.length - this.rows);
	}

	getLine(y: number): BufferLine | null {
		if (y < 0 || y >= this.lines.length) {
			return null;
		}
		const line = this.lines[y];
		return line ? new BufferLineImpl(line) : null;
	}

	getNullCell(): BufferCell {
		return new BufferCellImpl(createBlankCell());
	}

	// ── Buffer mutation methods (internal, used by VT parser) ───────

	/**
	 * Set cursor position (for VT parser to call).
	 *
	 * @param x - Column index (0-based)
	 * @param y - Row index (0-based, relative to viewport)
	 */
	setCursor(x: number, y: number): void {
		this._cursorX = Math.max(0, Math.min(x, this.cols - 1));
		// Allow cursor beyond viewport when buffer has scrollback
		const maxY = Math.max(this.rows - 1, this.lines.length - 1);
		this._cursorY = Math.max(0, Math.min(y, maxY));
		this.wrapPending = false;
	}

	/**
	 * Set viewport Y (scroll position).
	 *
	 * @param y - Absolute row index of the topmost visible row
	 */
	setViewportY(y: number): void {
		const maxViewportY = Math.max(0, this.lines.length - this.rows);
		this._viewportY = Math.max(0, Math.min(y, maxViewportY));
	}

	/**
	 * Scroll the viewport by a number of lines.
	 *
	 * @param delta - Number of lines to scroll (positive = down, negative = up)
	 */
	scrollViewport(delta: number): void {
		this.setViewportY(this._viewportY + delta);
	}

	/**
	 * Scroll the viewport to the bottom (pin to latest content).
	 */
	scrollToBottom(): void {
		// Set viewport to show the last 'rows' lines
		const maxViewportY = Math.max(0, this.lines.length - this.rows);
		this.setViewportY(maxViewportY);
	}

	/**
	 * Insert a new line at the bottom of the buffer.
	 * This is typically called when scrolling content up (e.g., newline at bottom row).
	 *
	 * @param wrapped - Whether this line is wrapped from the previous line
	 */
	insertLine(wrapped = false): void {
		const line = createBlankLine(this.cols);
		line.isWrapped = wrapped;

		// Decide whether the viewport was "pinned to the live screen"
		// BEFORE we mutate the buffer. The live screen always occupies
		// the bottom `rows` lines of the buffer; the pinned viewport
		// position is therefore `lines.length - rows` (clamped to >= 0).
		//
		// The previous check (`viewportY === baseY`) only held while the
		// buffer was strictly smaller than the scrollback capacity, which
		// kept baseY at 0. As soon as the buffer grew past `rows` lines
		// the viewport stopped auto-scrolling and the live screen got
		// clipped below the visible area while old scrollback occupied
		// the top of the renderer.
		const wasAtBottom =
			this._viewportY === Math.max(0, this.lines.length - this.rows);

		// If we're at capacity, remove the oldest line
		if (this.lines.length >= this.maxLines) {
			this.lines.shift();
			this._baseY++;
			// The absolute coordinate space is unchanged (getLine(y) still
			// addresses the same logical rows), but the oldest retained row's
			// absolute index is now `_baseY`. Any marker anchored BELOW that
			// (its line was the one just dropped) has scrolled out of the
			// buffer and must auto-dispose. Prune + notify those anchors.
			this.pruneScrolledOutMarkers();
		}

		// Append the new line at the bottom
		this.lines.push(line);

		if (wasAtBottom) {
			this.scrollToBottom();
		}
	}

	/**
	 * Write a single-cell (width-1) character at the cursor position with
	 * the given attributes, honouring deferred autowrap. Wide and combining
	 * code points must go through `printCodePoint` so width is honoured.
	 *
	 * @param char - Character to write (assumed single column)
	 * @param code - Unicode code point
	 * @param attrs - SGR attributes
	 */
	writeCell(char: string, code: number, attrs: CellAttributes): void {
		this.printCell(char, code, attrs, 1);
	}

	/**
	 * Print a Unicode code point at the cursor, honouring its column
	 * width as determined by `wcwidth()`:
	 *
	 *  - width 1 → single normal cell
	 *  - width 2 → leading cell holds the glyph, trailing cell is an
	 *    `isPlaceholder: true` cell with `chars: ""`; a glyph that does not
	 *    fit in the remaining columns wraps first so it stays contiguous.
	 *  - width 0 (combining mark) → appended to the previous cell's `chars`
	 *    without advancing; dropped when there is no anchor cell.
	 *  - width -1 (unprintable) → no-op.
	 *
	 * Writing into the last column leaves the cursor there with a pending
	 * wrap (DECAWM); the next printable character moves to the next line,
	 * scrolling the scroll region when the cursor sits on its bottom margin.
	 */
	printCodePoint(ch: string, cp: number, attrs: CellAttributes): void {
		const w = wcwidth(cp);
		if (w < 0) return;
		if (w === 0) {
			this.appendCombiningMark(ch);
			return;
		}
		this.printCell(ch, cp, attrs, w);
	}

	private printCell(
		ch: string,
		code: number,
		attrs: CellAttributes,
		width: number,
	): void {
		if (this.wrapPending || this._cursorX + width > this.cols) {
			this.wrapToNextLine();
		}
		this.placeCell(this._cursorX, ch, code, attrs, false);
		if (width === 2 && this._cursorX + 1 < this.cols) {
			this.placeCell(this._cursorX + 1, "", 0, attrs, true);
		}
		const next = this._cursorX + width;
		if (next >= this.cols) {
			this._cursorX = this.cols - 1;
			this.wrapPending = true;
			return;
		}
		this._cursorX = next;
	}

	private wrapToNextLine(): void {
		this._cursorX = 0;
		this.index();
		const line = this.lines[this._cursorY];
		if (line) line.isWrapped = true;
	}

	private placeCell(
		x: number,
		ch: string,
		code: number,
		attrs: CellAttributes,
		isPlaceholder: boolean,
	): void {
		while (this.lines.length <= this._cursorY) {
			this.lines.push(createBlankLine(this.cols));
		}
		const line = this.lines[this._cursorY];
		if (!line) return;
		while (line.cells.length <= x) {
			line.cells.push(createBlankCell());
		}
		const cell = line.cells[x];
		if (!cell) return;
		cell.chars = ch;
		cell.code = code;
		cell.attrs = { ...attrs };
		cell.isPlaceholder = isPlaceholder;
	}

	/**
	 * Append a zero-width combining mark to the cell before the cursor (or
	 * the cell under it while a wrap is pending). The mark is dropped when
	 * there is no anchor cell.
	 */
	private appendCombiningMark(ch: string): void {
		let anchorX = this.wrapPending ? this._cursorX : this._cursorX - 1;
		if (anchorX < 0) return;
		const line = this.lines[this._cursorY];
		if (!line) return;
		let anchor = line.cells[anchorX];
		if (anchor?.isPlaceholder && anchorX > 0) {
			anchorX--;
			anchor = line.cells[anchorX];
		}
		if (!anchor || anchor.isPlaceholder) return;
		anchor.chars += ch;
	}

	/**
	 * True while the cursor sits on the last column after printing there;
	 * the next printable character wraps to the next line first.
	 */
	get isWrapPending(): boolean {
		return this.wrapPending;
	}

	/**
	 * First column an erase "from the cursor" (EL 0, ED 0) clears. While a
	 * wrap is pending the cursor counts as past the last column, so the
	 * character already printed there survives (xterm.js behaviour).
	 */
	get eraseFromX(): number {
		return this.wrapPending ? this.cols : this._cursorX;
	}

	/** Cursor row relative to the top of the live screen (0-based). */
	get screenCursorY(): number {
		return this._cursorY - this.liveTop;
	}

	/**
	 * Move the cursor to a live-screen position. `row` is 0-based and
	 * relative to the top of the live screen, not to the buffer.
	 */
	setScreenCursor(x: number, row: number): void {
		this._cursorX = Math.max(0, Math.min(x, this.cols - 1));
		this._cursorY = this.liveTop + Math.max(0, Math.min(row, this.rows - 1));
		this.wrapPending = false;
	}

	/** Top margin of the scroll region (0-based live-screen row). */
	get regionTop(): number {
		return this.scrollTop;
	}

	/** Bottom margin of the scroll region (0-based live-screen row, inclusive). */
	get regionBottom(): number {
		return this.scrollBottom;
	}

	/**
	 * DECSTBM: set the scroll region to live-screen rows `top..bottom`
	 * (0-based, inclusive) and home the cursor. A region of fewer than two
	 * rows is ignored.
	 */
	setScrollRegion(top: number, bottom: number): void {
		const clampedBottom = Math.min(bottom, this.rows - 1);
		if (top < 0 || top >= clampedBottom) return;
		this.scrollTop = top;
		this.scrollBottom = clampedBottom;
		this.setScreenCursor(0, 0);
	}

	/**
	 * IND: move the cursor down one row, scrolling the scroll region up when
	 * the cursor is on its bottom margin. The column is unchanged.
	 */
	index(): void {
		this.wrapPending = false;
		const row = this.screenCursorY;
		if (row === this.scrollBottom) {
			this.scrollRegionUp(this.scrollTop, this.scrollBottom, true);
			return;
		}
		if (row < this.rows - 1) {
			this._cursorY++;
		}
	}

	/**
	 * RI: move the cursor up one row, scrolling the scroll region down when
	 * the cursor is on its top margin.
	 */
	reverseIndex(): void {
		this.wrapPending = false;
		const row = this.screenCursorY;
		if (row === this.scrollTop) {
			this.scrollRegionDown(this.scrollTop, this.scrollBottom);
			return;
		}
		if (row > 0) {
			this._cursorY--;
		}
	}

	/** SU: scroll the scroll region up `n` lines; the cursor stays put. */
	scrollUp(n: number): void {
		const count = Math.min(n, this.scrollBottom - this.scrollTop + 1);
		for (let i = 0; i < count; i++) {
			this.scrollRegionUp(this.scrollTop, this.scrollBottom, false);
		}
	}

	/** SD: scroll the scroll region down `n` lines; the cursor stays put. */
	scrollDown(n: number): void {
		const count = Math.min(n, this.scrollBottom - this.scrollTop + 1);
		for (let i = 0; i < count; i++) {
			this.scrollRegionDown(this.scrollTop, this.scrollBottom);
		}
	}

	/**
	 * IL: insert `n` blank lines at the cursor row, pushing the rows below
	 * it down within the scroll region. No-op outside the region.
	 */
	insertLines(n: number): void {
		const row = this.screenCursorY;
		if (row < this.scrollTop || row > this.scrollBottom) return;
		const count = Math.min(n, this.scrollBottom - row + 1);
		for (let i = 0; i < count; i++) {
			this.scrollRegionDown(row, this.scrollBottom);
		}
		this._cursorX = 0;
		this.wrapPending = false;
	}

	/**
	 * DL: delete `n` lines at the cursor row, pulling the rows below it up
	 * within the scroll region. No-op outside the region.
	 */
	deleteLines(n: number): void {
		const row = this.screenCursorY;
		if (row < this.scrollTop || row > this.scrollBottom) return;
		const count = Math.min(n, this.scrollBottom - row + 1);
		for (let i = 0; i < count; i++) {
			this.scrollRegionUp(row, this.scrollBottom, false);
		}
		this._cursorX = 0;
		this.wrapPending = false;
	}

	/**
	 * Scroll live-screen rows `top..bottom` up one line. When the region
	 * starts at the top of the screen and `feedsScrollback` is set, the top
	 * row moves into scrollback (dropped on a buffer without scrollback);
	 * otherwise it is discarded.
	 */
	private scrollRegionUp(
		top: number,
		bottom: number,
		feedsScrollback: boolean,
	): void {
		const row = this.screenCursorY;
		const wasAtBottom = this._viewportY === this.liveTop;
		const live = this.liveTop;
		if (feedsScrollback && top === 0) {
			this.insertBlankLineAt(live + bottom + 1);
			if (this.lines.length > this.maxLines) {
				this.lines.shift();
				this._baseY++;
				this.pruneScrolledOutMarkers();
			}
		} else {
			this.removeLineAt(live + top);
			this.insertBlankLineAt(live + bottom);
		}
		this._cursorY = this.liveTop + row;
		if (wasAtBottom) {
			this.scrollToBottom();
		}
	}

	/** Scroll live-screen rows `top..bottom` down one line. */
	private scrollRegionDown(top: number, bottom: number): void {
		const live = this.liveTop;
		this.removeLineAt(live + bottom);
		this.insertBlankLineAt(live + top);
	}

	/**
	 * Remove the line at buffer index `index`. Markers below it move up with
	 * their lines; markers on it are disposed.
	 */
	private removeLineAt(index: number): void {
		this.lines.splice(index, 1);
		const row = this._baseY + index;
		const evicted: MarkerAnchor[] = [];
		this.markerAnchors = this.markerAnchors.filter((anchor) => {
			if (anchor.absoluteRow === row) {
				evicted.push(anchor);
				return false;
			}
			if (anchor.absoluteRow > row) anchor.absoluteRow--;
			return true;
		});
		for (const anchor of evicted) anchor.onScrolledOut();
	}

	/**
	 * Insert a blank line at buffer index `index`; markers at or below it
	 * move down with their lines.
	 */
	private insertBlankLineAt(index: number): void {
		this.lines.splice(index, 0, createBlankLine(this.cols));
		const row = this._baseY + index;
		for (const anchor of this.markerAnchors) {
			if (anchor.absoluteRow >= row) anchor.absoluteRow++;
		}
	}

	/**
	 * Blank columns `fromX..toX` (inclusive) of a live-screen row. Clearing a
	 * whole row also drops its wrapped flag.
	 */
	eraseScreenRow(row: number, fromX = 0, toX = this.cols - 1): void {
		const line = this.lines[this.liveTop + row];
		if (!line) return;
		const end = Math.min(toX, line.cells.length - 1);
		for (let x = Math.max(0, fromX); x <= end; x++) {
			line.cells[x] = createBlankCell();
		}
		if (fromX <= 0 && toX >= this.cols - 1) {
			line.isWrapped = false;
		}
	}

	/**
	 * ED 3: drop every scrollback line, keeping the live screen and the
	 * cursor's position on it.
	 */
	clearScrollback(): void {
		const dropped = this.liveTop;
		if (dropped === 0) return;
		this.lines.splice(0, dropped);
		this._baseY += dropped;
		this._cursorY -= dropped;
		this._viewportY = 0;
		this.pruneScrolledOutMarkers();
	}

	/**
	 * Clear the buffer (remove all lines and reset cursor).
	 */
	clear(): void {
		this.lines = [];
		for (let i = 0; i < this.rows; i++) {
			this.lines.push(createBlankLine(this.cols));
		}
		this._baseY = 0;
		this._viewportY = 0;
		this._cursorX = 0;
		this._cursorY = 0;
		this.wrapPending = false;
		this.scrollTop = 0;
		this.scrollBottom = this.rows - 1;
		// A clear wipes the lines the markers anchored to, so every marker has
		// effectively scrolled out — notify and drop them all (xterm.js
		// disposes markers when their line is gone).
		if (this.markerAnchors.length > 0) {
			const evicted = this.markerAnchors;
			this.markerAnchors = [];
			for (const anchor of evicted) anchor.onScrolledOut();
		}
	}

	/**
	 * Resize the buffer without reflowing content. Growing the row count
	 * pulls scrollback back onto the screen before adding blank rows;
	 * shrinking it drops blank rows below the cursor first and moves the
	 * rest of the overflow into scrollback. The scroll region resets to the
	 * full screen.
	 *
	 * @param cols - New column count
	 * @param rows - New row count
	 */
	resize(cols: number, rows: number): void {
		if (cols === this.cols && rows === this.rows) return;
		const wasAtBottom = this._viewportY === this.liveTop;
		const oldCols = this.cols;
		const wasWrapPending = this.wrapPending;

		for (const line of this.lines) {
			if (line.cells.length > cols) {
				line.cells.length = cols;
			} else {
				while (line.cells.length < cols) {
					line.cells.push(createBlankCell());
				}
			}
		}

		if (rows < this.rows) {
			let surplus = this.rows - rows;
			while (surplus > 0 && this.lines.length - 1 > this._cursorY) {
				this.removeLineAt(this.lines.length - 1);
				surplus--;
			}
		}

		this.cols = cols;
		this.rows = rows;
		this.maxLines = rows + this.scrollback;

		while (this.lines.length < rows) {
			this.lines.push(createBlankLine(cols));
		}
		const overflow = this.lines.length - this.maxLines;
		if (overflow > 0) {
			this.lines.splice(0, overflow);
			this._baseY += overflow;
			this._cursorY -= overflow;
			this.pruneScrolledOutMarkers();
		}

		this._cursorX = Math.min(this._cursorX, cols - 1);
		this._cursorY = Math.max(
			this.liveTop,
			Math.min(this._cursorY, this.lines.length - 1),
		);
		this.wrapPending = false;
		if (wasWrapPending && cols > oldCols) {
			this._cursorX = oldCols;
		}
		this.scrollTop = 0;
		this.scrollBottom = rows - 1;

		if (wasAtBottom) {
			this.scrollToBottom();
			return;
		}
		this.setViewportY(this._viewportY);
	}

	/**
	 * Register a marker anchored at an absolute buffer row. Returns the live
	 * {@link MarkerAnchor} (whose `absoluteRow` the buffer keeps current) so
	 * the caller can read the marker's line and unregister it on dispose.
	 *
	 * The anchor's `absoluteRow` is clamped into the current valid range
	 * (`baseY .. length-1`). `onScrolledOut` fires at most once, when the
	 * anchored line is dropped from the ring.
	 *
	 * @internal
	 */
	registerMarkerAnchor(
		absoluteRow: number,
		onScrolledOut: () => void,
	): MarkerAnchor {
		const clamped = Math.max(
			this._baseY,
			Math.min(absoluteRow, this._baseY + this.lines.length - 1),
		);
		const anchor: MarkerAnchor = { absoluteRow: clamped, onScrolledOut };
		this.markerAnchors.push(anchor);
		return anchor;
	}

	/**
	 * Unregister a marker anchor (explicit dispose). Idempotent — unknown
	 * anchors are ignored.
	 *
	 * @internal
	 */
	unregisterMarkerAnchor(anchor: MarkerAnchor): void {
		const idx = this.markerAnchors.indexOf(anchor);
		if (idx !== -1) this.markerAnchors.splice(idx, 1);
	}

	/**
	 * Drop and notify any marker anchors whose line has fallen out of the
	 * retained buffer (absolute row now below `_baseY`). Called after the
	 * ring drops its oldest line.
	 */
	private pruneScrolledOutMarkers(): void {
		if (this.markerAnchors.length === 0) return;
		// Partition: keep anchors still in-buffer, collect the scrolled-out
		// ones to notify AFTER mutating the array so a callback that re-enters
		// (e.g. disposes another marker) sees a consistent registry.
		const survivors: MarkerAnchor[] = [];
		const evicted: MarkerAnchor[] = [];
		for (const anchor of this.markerAnchors) {
			if (anchor.absoluteRow < this._baseY) {
				evicted.push(anchor);
			} else {
				survivors.push(anchor);
			}
		}
		this.markerAnchors = survivors;
		for (const anchor of evicted) {
			anchor.onScrolledOut();
		}
	}

	/**
	 * Get direct access to internal line data (for testing/debugging).
	 * @internal
	 */
	_getInternalLine(y: number): Line | undefined {
		return this.lines[y];
	}
}

/**
 * Saved cursor state for DECSC/DECRC and alternate screen switching
 */
export interface SavedCursor {
	cursorX: number;
	/** Row relative to the top of the live screen. */
	cursorY: number;
	attrs: CellAttributes;
}

/**
 * BufferNamespace implementation.
 * Supports normal and alternate screen buffers (M4).
 */
export class BufferNamespaceImpl implements BufferNamespace {
	private normalBuffer: ScrollBuffer;
	private alternateBuffer: ScrollBuffer;
	private activeBuffer: ScrollBuffer;
	private savedCursor: SavedCursor | null = null;
	private emitter = new EventEmitter();

	constructor(cols: number, rows: number, scrollback: number) {
		// Normal buffer has scrollback
		this.normalBuffer = new ScrollBuffer(cols, rows, scrollback, "normal");
		// Alternate buffer has NO scrollback (standard terminal behavior)
		this.alternateBuffer = new ScrollBuffer(cols, rows, 0, "alternate");
		this.activeBuffer = this.normalBuffer;
	}

	get active(): Buffer {
		return this.activeBuffer;
	}

	/**
	 * The normal (primary) buffer. Public xterm-compatible accessor; also
	 * returned by `active` when not in alternate-screen mode.
	 */
	get normal(): ScrollBuffer {
		return this.normalBuffer;
	}

	/**
	 * The alternate screen buffer. Public xterm-compatible accessor; also
	 * returned by `active` while in alternate-screen mode.
	 */
	get alternate(): ScrollBuffer {
		return this.alternateBuffer;
	}

	/**
	 * Check if alternate screen is active
	 * @internal
	 */
	isAlternate(): boolean {
		return this.activeBuffer === this.alternateBuffer;
	}

	/**
	 * Register a callback invoked when the active buffer switches between
	 * the normal and alternate screens. The callback receives the
	 * newly-active buffer. Mirrors xterm.js `buffer.onBufferChange`.
	 */
	onBufferChange(callback: (activeBuffer: Buffer) => void): Disposable {
		const wrapper = (buffer: unknown) => {
			callback(buffer as Buffer);
		};
		this.emitter.on("buffer-change", wrapper);
		return {
			dispose: () => {
				this.emitter.off("buffer-change", wrapper);
			},
		};
	}

	/**
	 * Switch to alternate screen buffer
	 * @internal
	 */
	switchToAlternate(): void {
		if (this.activeBuffer === this.alternateBuffer) return;
		this.activeBuffer = this.alternateBuffer;
		this.emitter.emit("buffer-change", this.activeBuffer);
	}

	/**
	 * Switch to normal screen buffer
	 * @internal
	 */
	switchToNormal(): void {
		if (this.activeBuffer === this.normalBuffer) return;
		this.activeBuffer = this.normalBuffer;
		this.emitter.emit("buffer-change", this.activeBuffer);
	}

	/**
	 * Save cursor position and attributes (DECSC)
	 * @internal
	 */
	saveCursor(attrs: CellAttributes): void {
		this.savedCursor = {
			cursorX: this.activeBuffer.cursorX,
			cursorY: this.activeBuffer.screenCursorY,
			attrs: { ...attrs },
		};
	}

	/**
	 * Restore cursor position and attributes (DECRC)
	 * @internal
	 */
	restoreCursor(attrs: CellAttributes): void {
		if (this.savedCursor) {
			this.activeBuffer.setScreenCursor(
				this.savedCursor.cursorX,
				this.savedCursor.cursorY,
			);
			// Restore SGR attributes
			attrs.fgMode = this.savedCursor.attrs.fgMode;
			attrs.fgColor = this.savedCursor.attrs.fgColor;
			attrs.bgMode = this.savedCursor.attrs.bgMode;
			attrs.bgColor = this.savedCursor.attrs.bgColor;
			attrs.bold = this.savedCursor.attrs.bold;
			attrs.italic = this.savedCursor.attrs.italic;
			attrs.underline = this.savedCursor.attrs.underline;
			attrs.inverse = this.savedCursor.attrs.inverse;
			attrs.dim = this.savedCursor.attrs.dim;
		}
	}

	/**
	 * Get direct access to the active scroll buffer (for internal use).
	 * @internal
	 */
	_getScrollBuffer(): ScrollBuffer {
		return this.activeBuffer;
	}

	/**
	 * Resize both buffers
	 * @internal
	 */
	resize(cols: number, rows: number): void {
		this.normalBuffer.resize(cols, rows);
		this.alternateBuffer.resize(cols, rows);
	}
}
