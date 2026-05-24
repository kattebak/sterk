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

import type { Ace } from "ace-builds";
import ace from "ace-builds";
import type {
	BufferNamespaceImpl,
	ScrollBuffer,
} from "../buffer/scroll_buffer.js";
import type { Buffer } from "../types.js";
import { injectTruecolorCss } from "./theme.js";
import { VtMode } from "./vt_mode.js";

/**
 * Ace renderer implementation
 */
export class AceRenderer {
	private editor: Ace.Editor;
	private session: Ace.EditSession;
	private viewportDiv: HTMLElement;
	private wrapper: HTMLElement;
	private updateScheduled = false;
	private resizeObserver: ResizeObserver | null = null;
	private resizeFrameHandle: number | null = null;
	private lastObservedSize: { width: number; height: number } | null = null;

	/**
	 * Get the active buffer (normal or alternate).
	 * This getter ensures the renderer always reads from the current active buffer,
	 * not a fixed reference set at construction time.
	 */
	private get buffer(): ScrollBuffer {
		return this.bufferNamespace._getScrollBuffer();
	}

	constructor(
		private container: HTMLElement,
		private bufferNamespace: BufferNamespaceImpl,
		fontSize: number,
	) {
		// Create wrapper with sterk class
		this.wrapper = document.createElement("div");
		this.wrapper.classList.add("sterk");
		container.appendChild(this.wrapper);

		// Create viewport inside wrapper
		this.viewportDiv = document.createElement("div");
		this.viewportDiv.classList.add("sterk-viewport");
		this.wrapper.appendChild(this.viewportDiv);

		// Create Ace editor
		this.editor = ace.edit(this.viewportDiv);
		this.session = this.editor.getSession();

		// Configure editor
		this.editor.setOptions({
			fontSize,
			fontFamily: "monospace",
			showPrintMargin: false,
			showGutter: false,
			highlightActiveLine: false,
			highlightGutterLine: false,
			displayIndentGuides: false,
		});

		// Set read-only (terminal is not an editor)
		this.editor.setReadOnly(true);

		// Disable Ace's built-in behaviors
		this.session.setUseWrapMode(false);
		this.session.setUseSoftTabs(false);

		// Set custom VT mode for SGR rendering
		const vtMode = new VtMode(this.bufferNamespace);
		this.session.setMode(vtMode.getMode());

		// Force editor to measure layout (critical when container is pre-sized)
		this.editor.resize(true);

		// Initialize with buffer content
		this.syncBufferToDocument();

		// Observe the host container so we re-measure Ace whenever its
		// content-box pixels change — independent of `window.resize`.
		//
		// Why: on Android Chrome the soft keyboard only mutates
		// `visualViewport.height`; `window` `resize` never fires. The host
		// element shrinks (via consumer flex layout / viewport units), but
		// Ace's `VirtualRenderer` caches `$size.height` and only invalidates
		// on `window.resize` or an explicit `editor.resize()`. Without this
		// observer Ace keeps painting into the pre-keyboard viewport box and
		// the bottom rows render behind the keyboard. See kattebak/sterk#14.
		this.installResizeObserver();
	}

	/**
	 * Install a `ResizeObserver` on the host container so that any change in
	 * content-box dimensions triggers `editor.resize(true)` — forcing Ace to
	 * re-measure its cached `$size` before the next paint.
	 *
	 * Callbacks are coalesced via `requestAnimationFrame` so a burst of
	 * resize events (e.g. visualViewport scroll while the soft keyboard
	 * animates) does not thrash the renderer.
	 */
	private installResizeObserver(): void {
		// Guard for environments without ResizeObserver (e.g. older test
		// runtimes). The consumer can still call `resize()` manually.
		if (typeof ResizeObserver === "undefined") return;

		// Seed the cached size so the very first observer callback (which
		// fires synchronously on observe() in real browsers) is a no-op
		// when dimensions haven't actually changed.
		const initialRect = this.container.getBoundingClientRect();
		this.lastObservedSize = {
			width: initialRect.width,
			height: initialRect.height,
		};

		this.resizeObserver = new ResizeObserver((entries) => {
			// Always trust the latest entry. contentRect is the content-box
			// in CSS pixels — what Ace actually cares about for laying out
			// visible rows.
			const entry = entries[entries.length - 1];
			if (!entry) return;

			const { width, height } = entry.contentRect;

			// Skip if dimensions are identical to the last observed value
			// (some browsers fire spurious entries on layout reads).
			if (
				this.lastObservedSize &&
				this.lastObservedSize.width === width &&
				this.lastObservedSize.height === height
			) {
				return;
			}
			this.lastObservedSize = { width, height };

			// Coalesce: one rAF per burst. cancelAnimationFrame is a no-op
			// for stale handles, but we keep the guard for clarity.
			if (this.resizeFrameHandle !== null) return;

			const raf =
				typeof requestAnimationFrame === "function"
					? requestAnimationFrame
					: (cb: FrameRequestCallback): number => {
							// Fallback for environments without rAF.
							return setTimeout(
								() => cb(performance.now()),
								16,
							) as unknown as number;
						};

			this.resizeFrameHandle = raf(() => {
				this.resizeFrameHandle = null;
				// Force Ace to re-measure its cached $size before the next paint.
				this.editor.resize(true);
			});
		});

		this.resizeObserver.observe(this.container);
	}

	/**
	 * Get the Ace editor instance (for consumers needing direct access)
	 */
	getEditor(): Ace.Editor {
		return this.editor;
	}

	/**
	 * Get cell metrics (character width/height in pixels)
	 */
	getCellMetrics(): { width: number; height: number } | null {
		const renderer = this.editor.renderer;
		const lineHeight = renderer.lineHeight;
		const charWidth = renderer.characterWidth;

		if (lineHeight > 0 && charWidth > 0) {
			return { width: charWidth, height: lineHeight };
		}

		return null;
	}

	/**
	 * Set font size
	 */
	setFontSize(size: number): void {
		this.editor.setFontSize(size);
	}

	/**
	 * Get the DOM element for attaching input/mouse handlers
	 */
	getElement(): HTMLElement {
		return this.editor.container;
	}

	/**
	 * Handle buffer switch (normal ↔ alternate screen)
	 * Called when terminal switches between buffers
	 */
	onBufferSwitch(): void {
		// Force a full re-render
		this.scheduleUpdate();
	}

	/**
	 * Schedule a buffer → document sync
	 * Uses requestAnimationFrame to batch updates
	 */
	scheduleUpdate(): void {
		if (this.updateScheduled) return;

		this.updateScheduled = true;
		requestAnimationFrame(() => {
			this.updateScheduled = false;
			this.syncBufferToDocument();
			this.updateCursor();
			this.updateScroll();
		});
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

		// Update each line (only if changed)
		for (let i = 0; i < bufferLines; i++) {
			const line = buffer.getLine(i);
			if (!line) continue;

			const text = this.renderLine(line);
			const currentText = document.getLine(i) ?? "";

			if (text !== currentText) {
				document.removeInLine(i, 0, currentText.length);
				document.insertInLine({ row: i, column: 0 }, text);
			}
		}
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
	 * Pre-inject CSS for all truecolor colors in the buffer
	 * This ensures the CSS classes exist before Ace tokenizes
	 */
	private injectTruecolorStyles(): void {
		const buffer = this.buffer;
		for (let row = 0; row < buffer.length; row++) {
			const line = buffer.getLine(row);
			if (!line) continue;

			// Scan all cells in the line
			const text = line.translateToString(false);
			for (let col = 0; col < text.length; col++) {
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
	 * Update viewport scroll position
	 */
	private updateScroll(): void {
		const buffer = this.buffer;
		const viewportY = buffer.viewportY;

		// Scroll to show the viewport
		this.editor.scrollToLine(viewportY, true, false, () => {});
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
		this.scheduleUpdate();
	}

	/**
	 * Clean up
	 */
	dispose(): void {
		// Tear down the resize observer first so no callback can race the
		// editor destruction.
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (
			this.resizeFrameHandle !== null &&
			typeof cancelAnimationFrame === "function"
		) {
			cancelAnimationFrame(this.resizeFrameHandle);
			this.resizeFrameHandle = null;
		}
		this.lastObservedSize = null;

		this.editor.destroy();
		if (this.viewportDiv.parentNode) {
			this.viewportDiv.parentNode.removeChild(this.viewportDiv);
		}
		if (this.wrapper.parentNode) {
			this.wrapper.parentNode.removeChild(this.wrapper);
		}
	}
}
