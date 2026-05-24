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
} from "../types.js";
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
 * Scrollback buffer implementation.
 * Uses a ring buffer to efficiently store terminal lines with scrollback.
 */
export class ScrollBuffer implements Buffer {
	private lines: Line[] = [];
	private maxLines: number;
	/** Number of columns in the buffer */
	cols: number;
	private rows: number;

	/** Absolute row index of the first scrollback line */
	private _baseY = 0;
	/** Absolute row index of the topmost visible row */
	private _viewportY = 0;
	/** Cursor X position (column) */
	private _cursorX = 0;
	/** Cursor Y position (row, relative to viewport) */
	private _cursorY = 0;

	constructor(cols: number, rows: number, scrollback: number) {
		this.cols = cols;
		this.rows = rows;
		this.maxLines = rows + scrollback;

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

	getLine(y: number): BufferLine | null {
		if (y < 0 || y >= this.lines.length) {
			return null;
		}
		const line = this.lines[y];
		return line ? new BufferLineImpl(line) : null;
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

		// If we're at capacity, remove the oldest line
		if (this.lines.length >= this.maxLines) {
			this.lines.shift();
			this._baseY++;
		}

		// Append the new line at the bottom
		this.lines.push(line);

		// Keep viewport pinned to bottom if it was already there
		if (this._viewportY === this._baseY) {
			this.scrollToBottom();
		}
	}

	/**
	 * Write a single-cell (width-1) character at the cursor position with
	 * the given attributes. Used by the parser/terminal for ASCII writes
	 * and by control sequences that need to drop a blank or sentinel cell
	 * (e.g. erase-line emitting " "). Wide and combining code points must
	 * go through `printCodePoint` so width is honoured.
	 *
	 * @param char - Character to write (assumed single column)
	 * @param code - Unicode code point
	 * @param attrs - SGR attributes
	 */
	writeCell(char: string, code: number, attrs: CellAttributes): void {
		this.placeCell(char, code, attrs, false);
		this.advanceCursor(1);
	}

	/**
	 * Print a Unicode code point at the cursor, honouring its column
	 * width as determined by `wcwidth()`. Routes:
	 *
	 *  - width 1 → single normal cell, cursor advances by 1
	 *  - width 2 → leading cell holds the glyph, trailing cell is a
	 *    `isPlaceholder: true` cell with `chars: ""` and `code: 0`;
	 *    cursor advances by 2. If only one column remains on the line
	 *    we wrap to the next line (xterm-style) so the glyph stays
	 *    contiguous.
	 *  - width 0 (combining mark) → append the code point's char to the
	 *    *previous* cell's `chars` buffer without advancing the cursor.
	 *    If there is no previous cell on this line (cursor at column 0
	 *    or previous cell is a placeholder), Kuhn's spec says to drop
	 *    the combining mark; we follow that.
	 *  - width -1 (unprintable) → no-op.
	 *
	 * This is the parity counterpart to aceterm's `libterm.js:475-491`
	 * wide-char + combining-mark write path (mobux audit Row 33).
	 *
	 * @param ch - The character (1-2 UTF-16 code units representing one code point)
	 * @param cp - Unicode code point (matches `ch.codePointAt(0)`)
	 * @param attrs - SGR attributes to bake onto the leading cell
	 */
	printCodePoint(ch: string, cp: number, attrs: CellAttributes): void {
		const w = wcwidth(cp);

		if (w < 0) {
			// Unprintable — drop. (C0/C1 controls are already filtered by
			// the parser, but a defensive guard keeps callers honest.)
			return;
		}

		if (w === 0) {
			// Combining mark: glue onto the previous cell's character buffer
			// without advancing the cursor. If there's no anchor cell, the
			// mark is dropped (Kuhn's behaviour — better than rendering an
			// orphaned diacritic on its own).
			this.appendCombiningMark(ch);
			return;
		}

		if (w === 2) {
			// Wide glyph: if only one column remains, wrap to the next row
			// so the glyph is never split across a line boundary. xterm,
			// foot, and iTerm all do this.
			if (this._cursorX >= this.cols - 1) {
				// Implicit wrap: push to start of next line.
				this._cursorX = 0;
				if (this._cursorY < this.rows - 1) {
					this._cursorY++;
				}
				// (If we're already on the last row, the caller's newline
				// machinery will handle scrolling; we just write at col 0.)
			}
			this.placeCell(ch, cp, attrs, false);
			this.advanceCursor(1);
			// Trailing placeholder slot.
			this.placeCell("", 0, attrs, true);
			this.advanceCursor(1);
			return;
		}

		// Default: width-1 cell.
		this.placeCell(ch, cp, attrs, false);
		this.advanceCursor(1);
	}

	/**
	 * Write the character `ch` into the cell at the current cursor
	 * position. Does **not** advance the cursor; the caller is
	 * responsible for advancing in cell-units. Used by both `writeCell`
	 * (normal path) and `printCodePoint` (wide-char path).
	 */
	private placeCell(
		ch: string,
		code: number,
		attrs: CellAttributes,
		isPlaceholder: boolean,
	): void {
		const relativeY = this._cursorY;

		while (this.lines.length <= relativeY) {
			this.lines.push(createBlankLine(this.cols));
		}

		const line = this.lines[relativeY];
		if (!line) return;

		while (line.cells.length <= this._cursorX) {
			line.cells.push(createBlankCell());
		}

		const cell = line.cells[this._cursorX];
		if (!cell) return;

		cell.chars = ch;
		cell.code = code;
		cell.attrs = { ...attrs };
		if (isPlaceholder) {
			cell.isPlaceholder = true;
		} else {
			// Important: clear any stale placeholder flag from a previous
			// occupant of this slot. Otherwise overwriting a width-2 trail
			// with a fresh width-1 glyph would leave the placeholder bit
			// set and confuse the renderer.
			cell.isPlaceholder = false;
		}
	}

	/**
	 * Advance the cursor by `n` cell-units, wrapping at column edge to
	 * the next row (with viewport clamping). Shared by all write paths
	 * so wide-char and ASCII cursor math go through one place.
	 */
	private advanceCursor(n: number): void {
		for (let i = 0; i < n; i++) {
			this._cursorX++;
			if (this._cursorX >= this.cols) {
				this._cursorX = 0;
				this._cursorY = Math.min(this._cursorY + 1, this.rows - 1);
			}
		}
	}

	/**
	 * Append a zero-width combining mark to the previous cell on the
	 * current row. If there is no anchor cell (cursor at column 0, or
	 * previous cell is a width-2 placeholder), the mark is dropped —
	 * matching Kuhn's POSIX wcwidth contract.
	 */
	private appendCombiningMark(ch: string): void {
		if (this._cursorX === 0) return;

		const line = this.lines[this._cursorY];
		if (!line) return;

		// The anchor is the *previous* cell. If that cell is a placeholder
		// (the trailing half of a width-2 glyph), step back one more so
		// the combining mark glues onto the leading cell.
		let anchorX = this._cursorX - 1;
		let anchor = line.cells[anchorX];
		if (anchor?.isPlaceholder && anchorX > 0) {
			anchorX--;
			anchor = line.cells[anchorX];
		}
		if (!anchor || anchor.isPlaceholder) return;

		anchor.chars += ch;
		// Cursor does *not* advance.
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
	}

	/**
	 * Resize the buffer to new dimensions.
	 * This is a simplified resize that doesn't reflow content (reflow deferred to M2).
	 *
	 * @param cols - New column count
	 * @param rows - New row count
	 */
	resize(cols: number, rows: number): void {
		this.cols = cols;
		this.rows = rows;

		// Resize existing lines (truncate or pad)
		for (const line of this.lines) {
			if (line.cells.length > cols) {
				line.cells.length = cols;
			} else {
				while (line.cells.length < cols) {
					line.cells.push(createBlankCell());
				}
			}
		}

		// Clamp cursor position
		this._cursorX = Math.min(this._cursorX, cols - 1);
		this._cursorY = Math.min(this._cursorY, rows - 1);

		// Update viewport
		this.setViewportY(this._viewportY);
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

	constructor(cols: number, rows: number, scrollback: number) {
		// Normal buffer has scrollback
		this.normalBuffer = new ScrollBuffer(cols, rows, scrollback);
		// Alternate buffer has NO scrollback (standard terminal behavior)
		this.alternateBuffer = new ScrollBuffer(cols, rows, 0);
		this.activeBuffer = this.normalBuffer;
	}

	get active(): Buffer {
		return this.activeBuffer;
	}

	/**
	 * Get the normal buffer (for internal use).
	 * @internal
	 */
	get normal(): ScrollBuffer {
		return this.normalBuffer;
	}

	/**
	 * Get the alternate buffer (for internal use).
	 * @internal
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
	 * Switch to alternate screen buffer
	 * @internal
	 */
	switchToAlternate(): void {
		this.activeBuffer = this.alternateBuffer;
	}

	/**
	 * Switch to normal screen buffer
	 * @internal
	 */
	switchToNormal(): void {
		this.activeBuffer = this.normalBuffer;
	}

	/**
	 * Save cursor position and attributes (DECSC)
	 * @internal
	 */
	saveCursor(attrs: CellAttributes): void {
		this.savedCursor = {
			cursorX: this.activeBuffer.cursorX,
			cursorY: this.activeBuffer.cursorY,
			attrs: { ...attrs },
		};
	}

	/**
	 * Restore cursor position and attributes (DECRC)
	 * @internal
	 */
	restoreCursor(attrs: CellAttributes): void {
		if (this.savedCursor) {
			this.activeBuffer.setCursor(
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
