/**
 * Terminal implementation
 *
 * Coordinates the VT parser, scrollback buffer, and event emission.
 * This is the main entry point for the terminal emulator.
 */

import {
	BufferNamespaceImpl,
	type CellAttributes,
	DEFAULT_CELL_ATTRIBUTES,
	type ScrollBuffer,
} from "./buffer/scroll_buffer.js";
import { applySgr } from "./parser/sgr.js";
import { VtParser } from "./parser/vt_parser.js";
import { AceRenderer } from "./renderer/ace_renderer.js";
import { InputHandler } from "./renderer/input.js";
import type { Link } from "./renderer/links.js";
import { LinkDetector } from "./renderer/links.js";
import { MouseHandler } from "./renderer/mouse.js";
import { applyTheme } from "./renderer/theme.js";
import type {
	BufferNamespace,
	Disposable,
	OscHandler,
	Parser,
	Terminal,
	TerminalOptions,
} from "./types.js";
import { EventEmitter } from "./util/event_emitter.js";

/**
 * Parser implementation that satisfies the Parser interface
 */
class ParserImpl implements Parser {
	constructor(private vtParser: VtParser) {}

	registerOscHandler(id: number, handler: OscHandler): Disposable {
		return this.vtParser.registerOscHandler(id, handler);
	}
}

/**
 * Terminal implementation
 */
export class TerminalImpl implements Terminal {
	private bufferNamespace: BufferNamespaceImpl;
	private vtParser: VtParser;
	private parserImpl: ParserImpl;
	private emitter = new EventEmitter();
	private _options: Required<TerminalOptions>;
	// Renderer components (optional, for DOM mode)
	private aceRenderer: AceRenderer | null = null;
	private inputHandler: InputHandler | null = null;
	private mouseHandler: MouseHandler | null = null;
	private linkDetector: LinkDetector | null = null;

	constructor(options?: TerminalOptions) {
		// Default options
		this._options = {
			cols: options?.cols ?? 80,
			rows: options?.rows ?? 24,
			scrollback: options?.scrollback ?? 1000,
			theme: options?.theme ?? {},
			fontFamily: options?.fontFamily ?? "monospace",
			fontSize: options?.fontSize ?? 13,
			allowSelection: options?.allowSelection ?? true,
		};

		// Create buffer
		this.bufferNamespace = new BufferNamespaceImpl(
			this._options.cols,
			this._options.rows,
			this._options.scrollback,
		);

		// Create parser with action handlers
		this.vtParser = new VtParser({
			print: (char: string, code: number) => this.handlePrint(char, code),
			execute: (code: number) => this.handleExecute(code),
			escDispatch: (intermediates: number[], final: number) =>
				this.handleEscDispatch(intermediates, final),
			csiDispatch: (
				params: number[][],
				intermediates: number[],
				final: number,
			) => this.handleCsiDispatch(params, intermediates, final),
			oscDispatch: (id: number, data: string) =>
				this.handleOscDispatch(id, data),
			put: (_code: number) => {
				/* Not used in basic implementation */
			},
			collect: (_code: number) => {
				/* Not used in basic implementation */
			},
			param: (_code: number) => {
				/* Not used in basic implementation */
			},
			clear: () => {
				/* Parser handles clearing internally */
			},
		});

		this.parserImpl = new ParserImpl(this.vtParser);
	}

	// ── Terminal interface implementation ────────────────────────────

	get cols(): number {
		return this._options.cols;
	}

	get rows(): number {
		return this._options.rows;
	}

	get options(): Required<TerminalOptions> {
		return this._options;
	}

	get parser(): Parser {
		return this.parserImpl;
	}

	get buffer(): BufferNamespace {
		return this.bufferNamespace;
	}

	/**
	 * Get the active scroll buffer (always returns the current active buffer)
	 */
	private get scrollBuffer(): ScrollBuffer {
		return this.bufferNamespace._getScrollBuffer();
	}

	write(data: string | Uint8Array, callback?: () => void): void {
		this.vtParser.write(data);
		if (this.aceRenderer) {
			this.aceRenderer.scheduleUpdate();
		}
		this.emitter.emit("write-parsed");
		if (callback) {
			callback();
		}
	}

	resize(cols: number, rows: number): void {
		this._options.cols = cols;
		this._options.rows = rows;
		this.scrollBuffer.resize(cols, rows);
		if (this.aceRenderer) {
			this.aceRenderer.resize(cols, rows);
		}
	}

	clear(): void {
		this.scrollBuffer.clear();
		this.vtParser.currentAttrs = { ...DEFAULT_CELL_ATTRIBUTES };
	}

	scrollLines(lines: number): void {
		this.scrollBuffer.scrollViewport(lines);
		if (this.aceRenderer) {
			this.aceRenderer.scheduleUpdate();
		}
	}

	scrollToBottom(): void {
		this.scrollBuffer.scrollToBottom();
		if (this.aceRenderer) {
			this.aceRenderer.scheduleUpdate();
		}
	}

	onWriteParsed(callback: () => void): Disposable {
		this.emitter.on("write-parsed", callback);
		return {
			dispose: () => {
				this.emitter.off("write-parsed", callback);
			},
		};
	}

	onData(callback: (data: string) => void): Disposable {
		const wrapper = (data: unknown) => {
			if (typeof data === "string") {
				callback(data);
			}
		};
		this.emitter.on("data", wrapper);
		return {
			dispose: () => {
				this.emitter.off("data", wrapper);
			},
		};
	}

	send(data: string | Uint8Array): void {
		const str =
			typeof data === "string" ? data : new TextDecoder().decode(data);
		this.emitter.emit("data", str);
	}

	open(container: HTMLElement): void {
		if (this.aceRenderer) {
			throw new Error("Terminal is already opened");
		}

		// Create renderer
		this.aceRenderer = new AceRenderer(
			container,
			this.bufferNamespace,
			this._options.fontSize,
		);

		// Apply theme
		applyTheme(this._options.theme);

		// Create input handler
		const editorElement = this.aceRenderer.getElement();
		this.inputHandler = new InputHandler(editorElement);
		this.inputHandler.onData((data) => {
			this.emitter.emit("data", data);
		});

		// Create mouse handler
		this.mouseHandler = new MouseHandler(editorElement, () =>
			this.getCellMetrics(),
		);
		this.mouseHandler.onData((data) => {
			this.emitter.emit("data", data);
		});
		this.mouseHandler.onScroll((lines) => {
			this.scrollLines(lines);
		});

		// Create link detector
		this.linkDetector = new LinkDetector(
			editorElement,
			() => this.buffer.active,
			() => this.getCellMetrics(),
		);
		this.linkDetector.onHover((link: Link | null) => {
			this.emitter.emit("link-hover", link);
		});
		this.linkDetector.onClick((link: Link) => {
			this.emitter.emit("link-click", link);
		});

		// Initial render
		this.aceRenderer.scheduleUpdate();
	}

	get renderer(): unknown {
		return this.aceRenderer ?? undefined;
	}

	getCellMetrics(): { width: number; height: number } | null {
		if (this.aceRenderer) {
			return this.aceRenderer.getCellMetrics();
		}
		return null;
	}

	dispose(): void {
		if (this.aceRenderer) {
			this.aceRenderer.dispose();
			this.aceRenderer = null;
		}
		if (this.inputHandler) {
			this.inputHandler.dispose();
			this.inputHandler = null;
		}
		if (this.mouseHandler) {
			this.mouseHandler.dispose();
			this.mouseHandler = null;
		}
		if (this.linkDetector) {
			this.linkDetector.dispose();
			this.linkDetector = null;
		}
		this.emitter.removeAllListeners();
	}

	// ── Parser action handlers ───────────────────────────────────────

	/**
	 * Print a character to the buffer
	 */
	private handlePrint(char: string, code: number): void {
		this.scrollBuffer.writeCell(char, code, this.vtParser.currentAttrs);
	}

	/**
	 * Execute a C0 or C1 control code
	 */
	private handleExecute(code: number): void {
		switch (code) {
			case 0x07: // BEL
				// Bell - emit event but don't make noise in M2
				this.emitter.emit("bell");
				break;

			case 0x08: // BS (backspace)
				{
					const x = this.scrollBuffer.cursorX;
					if (x > 0) {
						this.scrollBuffer.setCursor(x - 1, this.scrollBuffer.cursorY);
					}
				}
				break;

			case 0x09: // HT (horizontal tab)
				{
					// Tab to next 8-column boundary
					const x = this.scrollBuffer.cursorX;
					const nextTab = Math.floor((x + 8) / 8) * 8;
					this.scrollBuffer.setCursor(
						Math.min(nextTab, this.cols - 1),
						this.scrollBuffer.cursorY,
					);
				}
				break;

			case 0x0a: // LF (line feed)
			case 0x0b: // VT (vertical tab, treat as LF)
			case 0x0c: // FF (form feed, treat as LF)
				{
					// Modern terminals treat LF as newline (LF+CR) by default
					const y = this.scrollBuffer.cursorY;
					if (y >= this.rows - 1) {
						// At bottom row - insert new line and move cursor to it
						this.scrollBuffer.insertLine();
						// Move cursor to the newly inserted line (at the end of buffer)
						const newLineIndex = this.scrollBuffer.length - 1;
						this.scrollBuffer.setCursor(0, newLineIndex);
					} else {
						// Move cursor to start of next line
						this.scrollBuffer.setCursor(0, y + 1);
					}
				}
				break;

			case 0x0d: // CR (carriage return)
				this.scrollBuffer.setCursor(0, this.scrollBuffer.cursorY);
				break;

			// Other C0 controls - ignore for now
			default:
				break;
		}
	}

	/**
	 * Handle ESC sequences
	 */
	private handleEscDispatch(intermediates: number[], final: number): void {
		// Handle cursor save/restore (DECSC/DECRC)
		if (intermediates.length === 0) {
			switch (final) {
				case 0x37: // ESC 7 - DECSC (save cursor)
					this.bufferNamespace.saveCursor(this.vtParser.currentAttrs);
					break;
				case 0x38: // ESC 8 - DECRC (restore cursor)
					this.bufferNamespace.restoreCursor(this.vtParser.currentAttrs);
					break;
				default:
					// Unknown ESC sequence - ignore
					break;
			}
		}
	}

	/**
	 * Handle CSI sequences
	 */
	private handleCsiDispatch(
		params: number[][],
		_intermediates: number[],
		final: number,
	): void {
		const p1 = params[0]?.[0] ?? 1; // Most commands default to 1
		const p2 = params[1]?.[0] ?? 1;

		switch (final) {
			case 0x41: // CUU - Cursor Up
				{
					// Param 0 is treated as 1 for cursor movement
					const n = Math.max(1, p1);
					const y = this.scrollBuffer.cursorY;
					this.scrollBuffer.setCursor(
						this.scrollBuffer.cursorX,
						Math.max(0, y - n),
					);
				}
				break;

			case 0x42: // CUD - Cursor Down
				{
					// Param 0 is treated as 1 for cursor movement
					const n = Math.max(1, p1);
					const y = this.scrollBuffer.cursorY;
					this.scrollBuffer.setCursor(
						this.scrollBuffer.cursorX,
						Math.min(this.rows - 1, y + n),
					);
				}
				break;

			case 0x43: // CUF - Cursor Forward
				{
					// Param 0 is treated as 1 for cursor movement
					const n = Math.max(1, p1);
					const x = this.scrollBuffer.cursorX;
					this.scrollBuffer.setCursor(
						Math.min(this.cols - 1, x + n),
						this.scrollBuffer.cursorY,
					);
				}
				break;

			case 0x44: // CUB - Cursor Back
				{
					// Param 0 is treated as 1 for cursor movement
					const n = Math.max(1, p1);
					const x = this.scrollBuffer.cursorX;
					this.scrollBuffer.setCursor(
						Math.max(0, x - n),
						this.scrollBuffer.cursorY,
					);
				}
				break;

			case 0x48: // CUP - Cursor Position
			case 0x66: // HVP - Horizontal and Vertical Position
				{
					const row = p1 - 1; // 1-based to 0-based
					const col = p2 - 1;
					this.scrollBuffer.setCursor(
						Math.max(0, Math.min(col, this.cols - 1)),
						Math.max(0, Math.min(row, this.rows - 1)),
					);
				}
				break;

			case 0x4a: // ED - Erase in Display
				this.eraseInDisplay(p1);
				break;

			case 0x4b: // EL - Erase in Line
				this.eraseInLine(p1);
				break;

			case 0x68: // SM - Set Mode (CSI ? ... h)
			case 0x6c: // RM - Reset Mode (CSI ? ... l)
				// Check for DEC private modes (indicated by '?' intermediate)
				if (_intermediates.length === 1 && _intermediates[0] === 0x3f) {
					this.handleDecPrivateMode(params, final === 0x68);
				}
				break;

			case 0x73: // DECSC (CSI s) - Save cursor (non-standard, but common)
				this.bufferNamespace.saveCursor(this.vtParser.currentAttrs);
				break;

			case 0x75: // DECRC (CSI u) - Restore cursor (non-standard, but common)
				this.bufferNamespace.restoreCursor(this.vtParser.currentAttrs);
				break;

			case 0x6d: // SGR - Select Graphic Rendition
				applySgr(params, this.vtParser.currentAttrs);
				break;

			// Unknown CSI sequences - ignore
			default:
				break;
		}
	}

	/**
	 * Handle OSC sequences
	 */
	private handleOscDispatch(_id: number, _data: string): void {
		// OSC sequences are handled by registered handlers
		// We don't auto-handle any OSC sequences in the terminal itself
	}

	/**
	 * Erase in Display (ED)
	 * @param mode - 0: below cursor, 1: above cursor, 2: entire screen
	 */
	private eraseInDisplay(mode: number): void {
		const blankAttrs: CellAttributes = { ...DEFAULT_CELL_ATTRIBUTES };

		switch (mode) {
			case 0: // Erase below cursor (inclusive)
				{
					// Clear from cursor to end of current line
					this.eraseInLine(0);

					// Clear all lines below current
					const startY = this.scrollBuffer.cursorY + 1;
					for (let y = startY; y < this.rows; y++) {
						for (let x = 0; x < this.cols; x++) {
							const savedCursor = {
								x: this.scrollBuffer.cursorX,
								y: this.scrollBuffer.cursorY,
							};
							this.scrollBuffer.setCursor(x, y);
							this.scrollBuffer.writeCell(" ", 32, blankAttrs);
							this.scrollBuffer.setCursor(savedCursor.x, savedCursor.y);
						}
					}
				}
				break;

			case 1: // Erase above cursor (inclusive)
				{
					// Clear all lines above current
					const endY = this.scrollBuffer.cursorY;
					for (let y = 0; y < endY; y++) {
						for (let x = 0; x < this.cols; x++) {
							const savedCursor = {
								x: this.scrollBuffer.cursorX,
								y: this.scrollBuffer.cursorY,
							};
							this.scrollBuffer.setCursor(x, y);
							this.scrollBuffer.writeCell(" ", 32, blankAttrs);
							this.scrollBuffer.setCursor(savedCursor.x, savedCursor.y);
						}
					}

					// Clear from start of current line to cursor
					this.eraseInLine(1);
				}
				break;

			case 2: // Erase entire screen
			case 3: // Erase entire screen + scrollback (treat as 2 for now)
				this.clear();
				break;

			default:
				break;
		}
	}

	/**
	 * Erase in Line (EL)
	 * @param mode - 0: to right of cursor, 1: to left of cursor, 2: entire line
	 */
	private eraseInLine(mode: number): void {
		const blankAttrs: CellAttributes = { ...DEFAULT_CELL_ATTRIBUTES };
		const y = this.scrollBuffer.cursorY;
		const cursorX = this.scrollBuffer.cursorX;

		switch (mode) {
			case 0: // Erase to right of cursor (inclusive)
				for (let x = cursorX; x < this.cols; x++) {
					const savedCursor = {
						x: this.scrollBuffer.cursorX,
						y: this.scrollBuffer.cursorY,
					};
					this.scrollBuffer.setCursor(x, y);
					this.scrollBuffer.writeCell(" ", 32, blankAttrs);
					this.scrollBuffer.setCursor(savedCursor.x, savedCursor.y);
				}
				break;

			case 1: // Erase to left of cursor (inclusive)
				for (let x = 0; x <= cursorX; x++) {
					const savedCursor = {
						x: this.scrollBuffer.cursorX,
						y: this.scrollBuffer.cursorY,
					};
					this.scrollBuffer.setCursor(x, y);
					this.scrollBuffer.writeCell(" ", 32, blankAttrs);
					this.scrollBuffer.setCursor(savedCursor.x, savedCursor.y);
				}
				break;

			case 2: // Erase entire line
				for (let x = 0; x < this.cols; x++) {
					const savedCursor = {
						x: this.scrollBuffer.cursorX,
						y: this.scrollBuffer.cursorY,
					};
					this.scrollBuffer.setCursor(x, y);
					this.scrollBuffer.writeCell(" ", 32, blankAttrs);
					this.scrollBuffer.setCursor(savedCursor.x, savedCursor.y);
				}
				break;

			default:
				break;
		}
	}

	/**
	 * Handle DEC private modes (CSI ? ... h / CSI ? ... l)
	 * Used for alternate screen buffer switching and other terminal modes.
	 */
	private handleDecPrivateMode(params: number[][], set: boolean): void {
		for (const paramGroup of params) {
			if (!paramGroup || paramGroup.length === 0) continue;
			const mode = paramGroup[0];
			if (mode === undefined) continue;

			switch (mode) {
				case 1047: // DECSET 1047 - Switch to/from alternate screen
					if (set) {
						this.bufferNamespace.switchToAlternate();
						if (this.aceRenderer) {
							this.aceRenderer.onBufferSwitch();
						}
					} else {
						this.bufferNamespace.switchToNormal();
						if (this.aceRenderer) {
							this.aceRenderer.onBufferSwitch();
						}
					}
					break;

				case 1048: // DECSET 1048 - Save/restore cursor position
					if (set) {
						this.bufferNamespace.saveCursor(this.vtParser.currentAttrs);
					} else {
						this.bufferNamespace.restoreCursor(this.vtParser.currentAttrs);
					}
					break;

				case 1049: // DECSET 1049 - Combined (save cursor + switch to alt + clear alt)
					if (set) {
						// Save cursor
						this.bufferNamespace.saveCursor(this.vtParser.currentAttrs);
						// Switch to alternate
						this.bufferNamespace.switchToAlternate();
						// Clear alternate screen
						this.scrollBuffer.clear();
						// Notify renderer
						if (this.aceRenderer) {
							this.aceRenderer.onBufferSwitch();
						}
					} else {
						// Clear alternate screen
						this.scrollBuffer.clear();
						// Switch back to normal
						this.bufferNamespace.switchToNormal();
						// Restore cursor
						this.bufferNamespace.restoreCursor(this.vtParser.currentAttrs);
						// Notify renderer
						if (this.aceRenderer) {
							this.aceRenderer.onBufferSwitch();
						}
					}
					break;

				// Other DEC private modes - ignore for now
				default:
					break;
			}
		}
	}
}
