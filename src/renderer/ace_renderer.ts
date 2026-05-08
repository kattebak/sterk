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
	private updateScheduled = false;

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
		const wrapper = document.createElement("div");
		wrapper.classList.add("sterk");
		container.appendChild(wrapper);

		// Create viewport inside wrapper
		this.viewportDiv = document.createElement("div");
		this.viewportDiv.classList.add("sterk-viewport");
		wrapper.appendChild(this.viewportDiv);

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
		this.editor.destroy();
		if (this.viewportDiv.parentNode) {
			this.viewportDiv.parentNode.removeChild(this.viewportDiv);
		}
	}
}
