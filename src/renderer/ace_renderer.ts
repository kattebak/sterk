/**
 * Ace renderer bridge — maps ScrollBuffer to Ace EditSession
 *
 * DOM structure:
 * ```html
 * <div class="sterk">           <!-- container -->
 *   <div class="sterk-viewport"> <!-- Ace editor container -->
 *     <div class="ace_editor">   <!-- Ace's own structure -->
 *       ...
 *     </div>
 *   </div>
 * </div>
 * ```
 *
 * Responsibilities:
 * - Incremental buffer → Ace document updates
 * - Cursor positioning
 * - Viewport scrolling
 * - Font size coordination
 * - Cell metrics calculation
 */

import type {
	BufferNamespaceImpl,
	ScrollBuffer,
} from "../buffer/scroll_buffer.js";
import type { Buffer } from "../types.js";
import { AceSurface } from "./ace_surface.js";
import { injectTruecolorCss } from "./theme.js";
import { buildCellClassName, VtMode } from "./vt_mode.js";

/**
 * Ace renderer implementation
 */
export class AceRenderer extends AceSurface {
	/**
	 * Optional callback fired after a coalesced rAF flush commits a repaint,
	 * receiving the affected viewport row range. Wired by the Terminal to
	 * back `Terminal.onRender` (xterm.js parity). The range covers the live
	 * viewport rows (`0 .. rows-1`); sterk re-syncs the whole visible screen
	 * per flush, so a row-precise diff would be misleading.
	 */
	private onRenderCallback:
		| ((range: { start: number; end: number }) => void)
		| null = null;
	/**
	 * Per-row rendered-attribute signature from the LAST sync, indexed by row.
	 *
	 * `syncBufferToDocument()` only rewrites a document line when its TEXT
	 * changed — which re-tokenizes the row. But an attribute-only redraw (same
	 * glyphs, new SGR colour/dim — e.g. a pulsing busy indicator that redraws
	 * "Transfiguring…" each frame with a different colour) leaves the text
	 * identical, so without this we never re-tokenize and the DOM keeps the
	 * STALE span classes. We compare each row's attribute signature against the
	 * previous sync; if it changed but the text did not, we force a re-tokenize
	 * + repaint of just that row. The signature is derived from the SAME
	 * `buildCellClassName` the tokenizer uses, so it can't drift from what
	 * actually renders. Reset on resize / buffer switch (see those methods).
	 */
	private lineSignatures: string[] = [];

	/**
	 * Get the active buffer (normal or alternate).
	 * This getter ensures the renderer always reads from the current active buffer,
	 * not a fixed reference set at construction time.
	 */
	private get buffer(): ScrollBuffer {
		return this.bufferNamespace._getScrollBuffer();
	}

	constructor(
		container: HTMLElement,
		private bufferNamespace: BufferNamespaceImpl,
		fontSize: number,
		fontFamily: string = "monospace",
	) {
		super(
			container,
			fontSize,
			fontFamily,
			new VtMode(bufferNamespace).getMode(),
		);
		this.syncBufferToDocument();
	}

	/**
	 * Handle buffer switch (normal ↔ alternate screen)
	 * Called when terminal switches between buffers
	 */
	/**
	 * Drop all per-row attribute signatures. Called when buffer content is
	 * reset wholesale (clear) so a signature from before the reset can never
	 * suppress a needed attribute-only re-render afterwards.
	 */
	resetLineSignatures(): void {
		this.lineSignatures = [];
	}

	onBufferSwitch(): void {
		// The active buffer (normal ↔ alternate) changed wholesale, so every
		// row's content AND attributes may differ. Clear the per-row attribute
		// signatures so a row index that happens to keep the same text across
		// the switch but carries different attrs is not suppressed.
		this.lineSignatures = [];
		// Force a full re-render
		this.scheduleUpdate();
	}

	/**
	 * Register the onRender callback (backs `Terminal.onRender`). Fired after
	 * each committed rAF flush with the repainted viewport row range.
	 */
	onRender(callback: (range: { start: number; end: number }) => void): void {
		this.onRenderCallback = callback;
	}

	/**
	 * Notify the onRender subscriber of a committed repaint. Sterk re-syncs
	 * the whole visible screen per flush, so the reported range spans the
	 * live viewport rows (`0 .. visibleRows-1`).
	 */
	private emitRender(): void {
		if (!this.onRenderCallback) return;
		// Derive the visible row count from Ace's ALREADY-measured cache —
		// never force a resize here (that would inflate resize-observer
		// coalescing counts and run on every flush). Fall back to the buffer
		// length when no measurement exists yet (pre-first-paint).
		const end = Math.max(0, this.visibleRowCount() - 1);
		this.onRenderCallback({ start: 0, end });
	}

	/**
	 * Best-effort visible row count from Ace's cached layout (no re-measure).
	 * Used by {@link emitRender}; falls back to the buffer length before the
	 * first paint has measured the scroller.
	 */
	private visibleRowCount(): number {
		// biome-ignore lint/suspicious/noExplicitAny: Ace's $size / lineHeight aren't in the public typings.
		const r = this.editor.renderer as any;
		const lineHeight = typeof r.lineHeight === "number" ? r.lineHeight : 0;
		const scrollerHeight =
			typeof r.$size?.scrollerHeight === "number" ? r.$size.scrollerHeight : 0;
		if (lineHeight > 0 && scrollerHeight > 0) {
			return Math.max(1, Math.floor(scrollerHeight / lineHeight));
		}
		return this.buffer.length;
	}

	protected flush(): void {
		this.syncBufferToDocument();
		this.updateCursor();
		this.updateScroll();
		this.emitRender();
	}

	/**
	 * Sync buffer content to Ace document (incremental)
	 */
	private syncBufferToDocument(): void {
		const document = this.session.getDocument();
		const buffer = this.buffer;

		// Get current document line count
		const docLines = document.getLength();
		const bufferLines = buffer.length;

		// Pre-inject truecolor CSS for all cells in the buffer
		this.injectTruecolorStyles();

		// Ensure document has correct number of lines
		if (docLines < bufferLines) {
			// Add missing lines
			const linesToAdd: string[] = [];
			for (let i = docLines; i < bufferLines; i++) {
				linesToAdd.push("");
			}
			if (linesToAdd.length > 0) {
				document.insert(
					{ row: docLines, column: 0 },
					`${linesToAdd.join("\n")}\n`,
				);
			}
		} else if (docLines > bufferLines) {
			// Remove extra lines
			document.removeLines(bufferLines, docLines - 1);
		}

		// Drop signatures for rows that no longer exist so a future row reusing
		// that index can't be suppressed by a stale entry.
		if (this.lineSignatures.length > bufferLines) {
			this.lineSignatures.length = bufferLines;
		}

		// Update each line.
		//
		// Two independent triggers for re-rendering a row:
		//   1. TEXT changed  → removeInLine/insertInLine. The document delta
		//      fires Ace's change event, which re-tokenizes the row. (existing)
		//   2. ATTRIBUTES changed but text did not (attribute-only redraw, e.g.
		//      a pulsing busy indicator recolouring identical glyphs). The text
		//      diff above is a no-op, so we must explicitly re-tokenize +
		//      repaint the row, else the DOM keeps stale span classes.
		// A static screen changes neither, so this loop performs ZERO Ace
		// mutations frame-over-frame — the incremental design is preserved.
		for (let i = 0; i < bufferLines; i++) {
			const line = buffer.getLine(i);
			if (!line) continue;

			const text = this.renderLine(line);
			const currentText = document.getLine(i) ?? "";
			const signature = this.computeLineSignature(i);
			const prevSignature = this.lineSignatures[i];

			if (text !== currentText) {
				// Text changed — the document round-trip re-tokenizes the row.
				document.removeInLine(i, 0, currentText.length);
				document.insertInLine({ row: i, column: 0 }, text);
			} else if (signature !== prevSignature) {
				// Attribute-only change: text is identical so the document was
				// not touched and Ace would otherwise keep the stale tokens.
				// Force a re-tokenize + repaint of just this row.
				this.retokenizeRow(i);
			}

			this.lineSignatures[i] = signature;
		}
	}

	/**
	 * Compute a compact rendered-attribute signature for buffer row `i` by
	 * walking its cells and joining each cell's `buildCellClassName` — the SAME
	 * class string the tokenizer emits. Two syncs whose rows render identically
	 * produce identical signatures; any change to a rendered class (fg/bg mode
	 * or value, bold/italic/underline/dim, inverse) changes the signature by
	 * construction, so it can never miss a class change the DOM would show.
	 */
	private computeLineSignature(row: number): string {
		const buffer = this.buffer;
		const line = buffer.getLine(row);
		if (!line) return "";
		const cols = buffer.cols;
		const parts: string[] = [];
		for (let col = 0; col < cols; col++) {
			// "|" separates cells so e.g. a class shift between adjacent cells
			// can't alias with the same classes packed differently.
			parts.push(buildCellClassName(line.getCell(col)));
		}
		return parts.join("|");
	}

	/**
	 * Render a buffer line to text (SGR styling is handled by VtMode tokenizer)
	 */
	private renderLine(
		line: Buffer extends { getLine(y: number): infer L } ? L : never,
	): string {
		if (!line) return "";
		return line.translateToString(false);
	}

	/**
	 * Pre-inject CSS for all truecolor colors in the buffer.
	 *
	 * Walks the cell grid (not the line-text character stream), since
	 * wide-char placeholders contribute zero characters to the joined
	 * line text but still hold an entry in the cells array (see
	 * `scroll_buffer.ts` cell encoding for the wcwidth contract).
	 * Iterating `cols` instead of `text.length` keeps the scan
	 * deterministic across CJK / emoji content.
	 */
	private injectTruecolorStyles(): void {
		const buffer = this.buffer;
		const cols = buffer.cols;
		for (let row = 0; row < buffer.length; row++) {
			const line = buffer.getLine(row);
			if (!line) continue;

			for (let col = 0; col < cols; col++) {
				const cell = line.getCell(col);

				// Check for truecolor foreground
				if (cell.isFgRGB()) {
					const rgb = cell.getFgColor();
					injectTruecolorCss(rgb, "fg");
				}

				// Check for truecolor background
				if (cell.isBgRGB()) {
					const rgb = cell.getBgColor();
					injectTruecolorCss(rgb, "bg");
				}
			}
		}
	}

	/**
	 * Update cursor position
	 */
	private updateCursor(): void {
		const buffer = this.buffer;
		const cursorY = buffer.baseY + buffer.cursorY;
		const cursorX = buffer.cursorX;

		// Clamp to valid range
		const row = Math.max(0, Math.min(cursorY, buffer.length - 1));
		const col = Math.max(0, cursorX);

		this.editor.moveCursorTo(row, col);
	}

	/**
	 * Update viewport scroll position.
	 *
	 * We use Ace's session.setScrollTop(pixels) directly rather than
	 * editor.scrollToLine(row, ...). scrollToLine is a no-op when the
	 * target row is already inside Ace's visible range — which is the
	 * case for terminal use, where the document is only marginally
	 * larger than the viewport (active rows + a few lines of
	 * scrollback). The result was that as soon as the buffer grew past
	 * `rows` lines, the active screen (which sits at the bottom of the
	 * document) was clipped below the visible area while the older
	 * scrollback continued to occupy the top.
	 *
	 * Pixel-anchoring scrollTop to viewportY * lineHeight forces the
	 * top of the visible area to align with the top of the active
	 * screen on every update, which is exactly the terminal semantic.
	 */
	private updateScroll(): void {
		this.scrollDocumentTo(this.buffer.viewportY);
	}

	/**
	 * Scroll viewport by lines
	 */
	scrollLines(lines: number): void {
		this.buffer.scrollViewport(lines);
		this.updateScroll();
	}

	/**
	 * Scroll to bottom
	 */
	scrollToBottom(): void {
		this.buffer.scrollToBottom();
		this.updateScroll();
	}

	/**
	 * Resize the terminal
	 */
	resize(cols: number, rows: number): void {
		this.buffer.resize(cols, rows);
		// Column count changed → per-cell layout differs, so old per-row
		// signatures are no longer comparable. Clear them; the next sync
		// recomputes against the new geometry.
		this.lineSignatures = [];
		this.scheduleUpdate();
	}

	override dispose(): void {
		this.onRenderCallback = null;
		super.dispose();
	}
}
