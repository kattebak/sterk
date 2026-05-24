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
	/**
	 * Promise that resolves after the next coalesced rAF flush completes
	 * (buffer→document sync + cursor + scroll). Shared across all writes
	 * that land in the same tick. Becomes null again once the rAF fires.
	 *
	 * Acts as both the "is an update scheduled?" flag and the barrier that
	 * `refresh()` awaits before triggering Ace's repaint, so a forced
	 * redraw never lands on a half-synced document.
	 */
	private updatePromise: Promise<void> | null = null;
	private updateResolve: (() => void) | null = null;
	private disposed = false;
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

		// Drop Ace's default 4px content padding. Terminals deliver text
		// at exact cell coordinates (col 0 == first column); any non-zero
		// padding shifts the grid sideways and eats horizontal cells the
		// consumer thinks it has. The default `setPadding(4)` is meant
		// for code editors where readability beats parity.
		this.editor.renderer.setPadding(0);

		// Hide Ace's vertical scrollbar. The terminal has its own scroll
		// model (consumer wires gestures / keys to `scrollLines()`), and
		// the reserved scrollbar gutter (~15px on most browsers) is the
		// largest source of horizontal cell-fit drift on small screens.
		// Mobile consumers in particular expect the right-most cell to
		// sit at the container's right edge — leaving the scrollbar in
		// place clips characters or forces a `cols - N` fudge factor.
		this.injectScrollbarHideCss();

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
	 * Compute how many terminal cells fit in the current scroller area.
	 *
	 * Reads Ace's already-measured scroller size (post-padding,
	 * post-scrollbar-reservation) plus the live cell metrics, so the
	 * answer is the *actual* grid the renderer can paint without
	 * clipping — not the container size divided by cell width.
	 *
	 * Returns `null` until the editor has measured itself at least once
	 * (e.g. before `open()` has run, or before the first rAF flush).
	 *
	 * Use this in preference to `clientWidth / cellWidth` math: it
	 * already accounts for Ace's internal padding (we zero it but a
	 * future change could re-introduce it) and any reserved scrollbar
	 * gutter, so the consumer's `cols` matches what is rendered.
	 */
	getViewportCellCount(): { cols: number; rows: number } | null {
		// biome-ignore lint/suspicious/noExplicitAny: Ace's internal $size and $padding aren't in the public typings.
		const r = this.editor.renderer as any;
		const metrics = this.getCellMetrics();
		if (!metrics) return null;

		const size = r.$size as
			| { scrollerWidth?: number; scrollerHeight?: number }
			| undefined;
		const padding = typeof r.$padding === "number" ? r.$padding : 0;
		const scrollerWidth = size?.scrollerWidth ?? 0;
		const scrollerHeight = size?.scrollerHeight ?? 0;

		if (scrollerWidth <= 0 || scrollerHeight <= 0) return null;

		const usableWidth = Math.max(0, scrollerWidth - 2 * padding);
		const cols = Math.max(1, Math.floor(usableWidth / metrics.width));
		const rows = Math.max(1, Math.floor(scrollerHeight / metrics.height));
		return { cols, rows };
	}

	/**
	 * Inject the CSS that hides Ace's vertical scrollbar inside this
	 * renderer's wrapper. Scoped to `.sterk .ace_scrollbar-v` so it
	 * doesn't affect other Ace instances on the page (e.g. an editor
	 * embedded next to a terminal). Idempotent across instances.
	 */
	private injectScrollbarHideCss(): void {
		const id = "sterk-scrollbar-hide";
		if (typeof document === "undefined") return;
		if (document.getElementById(id)) return;
		const style = document.createElement("style");
		style.id = id;
		style.textContent = `
.sterk .ace_scrollbar-v { display: none !important; }
.sterk .ace_scrollbar-h { display: none !important; }
`.trim();
		document.head.appendChild(style);
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
	 * Schedule a buffer → document sync.
	 *
	 * Uses `requestAnimationFrame` to coalesce a burst of `write()` calls
	 * into a single flush. The returned promise resolves once that flush
	 * has applied buffer state to the Ace document (cursor + scroll
	 * included). All callers in the same tick share the same promise.
	 *
	 * Promise-returning is additive — existing code that ignores the
	 * return value (most call sites) is unaffected. `refresh()` uses the
	 * promise to wait for an in-flight write burst before painting.
	 */
	scheduleUpdate(): Promise<void> {
		if (this.updatePromise) return this.updatePromise;

		this.updatePromise = new Promise<void>((resolve) => {
			this.updateResolve = resolve;
		});
		const promise = this.updatePromise;

		requestAnimationFrame(() => {
			const resolve = this.updateResolve;
			this.updatePromise = null;
			this.updateResolve = null;

			if (this.disposed) {
				resolve?.();
				return;
			}

			this.syncBufferToDocument();
			this.updateCursor();
			this.updateScroll();
			resolve?.();
		});

		return promise;
	}

	/**
	 * Force Ace to re-paint every visible row from the current document.
	 *
	 * IMPORTANT: callers must only invoke this AFTER the buffer→document
	 * sync has completed (i.e. after the rAF flush). Calling it mid-burst
	 * paints a half-synced document and produces zombie rows. The public
	 * entry point that enforces that ordering is `Terminal.refresh()`.
	 */
	forceRepaint(): void {
		if (this.disposed) return;
		// Ace's VirtualRenderer.updateFull(force) re-paints every visible
		// row. We pass `true` to force a layer-rebuild even if Ace thinks
		// nothing changed (e.g. a theme swap or font change). Behind the
		// scenes Ace schedules the actual paint on its own internal
		// rAF — see updateFull → scheduleRender.
		this.editor.renderer.updateFull(true);
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
		this.disposed = true;

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

		// Resolve any pending update promise so awaiters (e.g. a
		// `refresh()` blocked on the next rAF flush) don't dangle.
		const pending = this.updateResolve;
		this.updateResolve = null;
		this.updatePromise = null;
		pending?.();

		this.editor.destroy();
		if (this.viewportDiv.parentNode) {
			this.viewportDiv.parentNode.removeChild(this.viewportDiv);
		}
		if (this.wrapper.parentNode) {
			this.wrapper.parentNode.removeChild(this.wrapper);
		}
	}
}
