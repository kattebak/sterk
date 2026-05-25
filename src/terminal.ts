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
import {
	DEFAULT_FONT_ID,
	getBuiltinFont,
	injectFontFace,
} from "./fonts/index.js";
import { applySgr } from "./parser/sgr.js";
import { VtParser } from "./parser/vt_parser.js";
import { AceRenderer } from "./renderer/ace_renderer.js";
import { InputHandler } from "./renderer/input.js";
import type { Link } from "./renderer/links.js";
import { LinkDetector } from "./renderer/links.js";
import {
	MouseEncoding,
	MouseHandler,
	MouseTrackingMode,
} from "./renderer/mouse.js";
import { applyTheme, clearTruecolorCache } from "./renderer/theme.js";
import { builtinThemeToTheme, getBuiltinTheme } from "./themes/index.js";
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

	// DEC private mouse state — tracked at the terminal level so that DEC
	// escapes (e.g. tmux's `\x1b[?1000h\x1b[?1006h` on session attach) are
	// honoured even when they arrive before `open()` wires a MouseHandler.
	// When `open()` runs, these are flushed onto the freshly-created
	// handler. See `handleDecPrivateMode` for the protocol wire-up.
	private pendingMouseTracking: MouseTrackingMode = MouseTrackingMode.Off;
	private pendingMouseEncoding: MouseEncoding = MouseEncoding.Default;

	constructor(options?: TerminalOptions) {
		// Resolve the font option. The contract: bare `createTerminal()` must
		// render with a bundled font (JetBrains Mono) so consumers don't have
		// to wire `@font-face` themselves. A consumer can opt OUT by passing
		// an empty-string `font` AND their own `fontFamily` (or by setting
		// `font: ""`), in which case we fall back to plain `monospace`.
		// Any other `font` value is resolved through `BUILTIN_FONTS`; the
		// resolved family becomes the `fontFamily` baseline (with `monospace`
		// fallback for graceful degradation while the asset is loading).
		//
		// `fontFamily` passed explicitly without a `font` still wins — that
		// is the escape hatch for consumers that want to manage their own
		// font stack.
		const fontId =
			options?.font === undefined
				? DEFAULT_FONT_ID
				: options.font === ""
					? undefined
					: options.font;
		let resolvedFontFamily = options?.fontFamily ?? "monospace";
		if (fontId !== undefined) {
			const font = getBuiltinFont(fontId);
			injectFontFace(font);
			// Built-in font takes precedence over any consumer-supplied
			// `fontFamily` (the explicit-opt-out path above sets fontId to
			// undefined, so this only fires when the consumer asked for a
			// bundled font).
			resolvedFontFamily = `'${font.family}', monospace`;
		}

		// Default options
		this._options = {
			cols: options?.cols ?? 80,
			rows: options?.rows ?? 24,
			scrollback: options?.scrollback ?? 1000,
			theme: options?.theme ?? {},
			fontFamily: resolvedFontFamily,
			font: fontId ?? "",
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

	/**
	 * Write data followed by CRLF. xterm-compatible convenience wrapper.
	 */
	writeln(data: string | Uint8Array, callback?: () => void): void {
		const str =
			typeof data === "string" ? data : new TextDecoder().decode(data);
		this.write(`${str}\r\n`, callback);
	}

	/**
	 * Full terminal reset (RIS-like).
	 *
	 * Resets the terminal to its power-on state:
	 * - if the alternate screen is active, switch back to the normal buffer
	 *   first (so the visible/normal buffer is the one we clear)
	 * - clear the buffer and home the cursor (reuses `clear()`, which also
	 *   re-seeds `currentAttrs` to the defaults)
	 * - reset the VT parser to GROUND, dropping any half-parsed sequence and
	 *   pending UTF-8 bytes, and re-seeding its SGR attrs
	 * - notify the renderer of the buffer switch and schedule a repaint
	 *
	 * Registered OSC handlers and `onData`/`onWriteParsed` subscriptions are
	 * preserved — a reset clears terminal *content/state*, not consumer
	 * wiring.
	 */
	reset(): void {
		// Leave the alternate screen if we're in it, so the cleared buffer is
		// the normal one the user sees post-reset.
		if (this.bufferNamespace.isAlternate()) {
			this.bufferNamespace.switchToNormal();
		}
		// clear() empties the active buffer, homes the cursor, and resets
		// currentAttrs to DEFAULT_CELL_ATTRIBUTES.
		this.clear();
		// Bring the parser back to power-on (GROUND state + default SGR +
		// fresh UTF-8 decoder). This also re-seeds currentAttrs, which is
		// harmless overlap with clear() above.
		this.vtParser.reset();
		if (this.aceRenderer) {
			this.aceRenderer.onBufferSwitch();
		}
	}

	/**
	 * Move keyboard focus to the terminal input surface (Ace editor).
	 * No-op in headless mode.
	 */
	focus(): void {
		this.aceRenderer?.focus();
	}

	/**
	 * Remove keyboard focus from the terminal input surface (Ace editor).
	 * No-op in headless mode.
	 */
	blur(): void {
		this.aceRenderer?.blur();
	}

	/**
	 * Inject `data` as if pasted. Routes through the same `onData` path as
	 * `send()`. Bracketed-paste mode (DEC 2004) is not tracked in this
	 * codebase, so the paste is delivered verbatim (plain paste).
	 */
	paste(data: string): void {
		this.send(data);
	}

	/**
	 * Alias of `send()` for xterm.js compatibility. `wasUserInput` is
	 * accepted for signature parity but ignored — this path makes no
	 * synthetic-vs-user distinction.
	 */
	input(data: string | Uint8Array, _wasUserInput?: boolean): void {
		this.send(data);
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
		// Buffer content was reset wholesale; drop the renderer's per-row
		// attribute signatures so none can suppress a needed re-render later.
		this.aceRenderer?.resetLineSignatures();
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

	/**
	 * Force the renderer to repaint after any currently in-flight writes
	 * have been applied to the document.
	 *
	 * Sterk batches `write()` → Ace-document updates on the next
	 * animation frame. A naive "force repaint" call (e.g. reaching into
	 * Ace's `renderer.updateFull()`) can land mid-burst and paint a
	 * half-synced document — that's the "zombie rows" symptom mobux PR
	 * #79 produced. `refresh()` is the race-safe entry point: it awaits
	 * the next coalesced flush, then asks Ace to re-paint.
	 *
	 * In headless mode (terminal not opened to a DOM container) this is
	 * a no-op and resolves immediately.
	 *
	 * @returns Promise that resolves once the repaint has been committed.
	 */
	async refresh(): Promise<void> {
		if (!this.aceRenderer) return;
		// Wait for any in-flight write burst to flush into the document.
		// scheduleUpdate() returns the existing pending promise if one is
		// in flight, or queues a fresh rAF if not — either way, awaiting
		// it guarantees buffer→document sync is complete before we paint.
		await this.aceRenderer.scheduleUpdate();
		// Now safe to force Ace's repaint: the document reflects the
		// buffer steady state, no parser writes in flight.
		this.aceRenderer?.forceRepaint();
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
			this._options.fontFamily,
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
		// Flush any DEC mouse state buffered from writes that arrived before
		// `open()`. Without this, a tmux session that enables mouse on attach
		// (writes its `?1000h?1006h` before the harness paints) would land
		// in a freshly-constructed MouseHandler with `Off` defaults.
		this.mouseHandler.setTrackingMode(this.pendingMouseTracking);
		this.mouseHandler.setEncoding(this.pendingMouseEncoding);

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

	/**
	 * Compute the exact grid (cols × rows) that fits in the rendered
	 * scroller area. See `AceRenderer.getViewportCellCount()` for why
	 * this is preferable to `clientWidth / cellWidth` math.
	 */
	getViewportCellCount(): { cols: number; rows: number } | null {
		if (this.aceRenderer) {
			return this.aceRenderer.getViewportCellCount();
		}
		return null;
	}

	/**
	 * Swap to a built-in theme by id at runtime.
	 *
	 * The look-up resolves against the `THEMES` registry in
	 * `src/themes/index.ts`; an unknown id throws (cheap typo catch). The
	 * resolved palette is projected to the xterm-style `Theme` shape via
	 * `builtinThemeToTheme()`, then re-applied through the same
	 * `applyTheme()` pipeline used at construct time — so a runtime swap
	 * and a fresh-construct swap go through identical CSS-generation code.
	 *
	 * After re-injecting the stylesheet we clear the truecolor cache (so
	 * the contrast fallback re-derives against the new bg) and ask the
	 * renderer to re-paint via `scheduleUpdate()`. We never reach into
	 * Ace's `renderer.updateFull()` directly: a forced full-paint mid-write
	 * burst can produce zombie rows (mobux PR #79 lesson). `scheduleUpdate()`
	 * coalesces with any in-flight write into the next rAF.
	 */
	setTheme(themeId: string): void {
		const builtin = getBuiltinTheme(themeId);
		const theme = builtinThemeToTheme(builtin);
		this._options.theme = theme;
		applyTheme(theme);
		clearTruecolorCache();
		if (this.aceRenderer) {
			this.aceRenderer.scheduleUpdate();
		}
	}

	/**
	 * Swap to a built-in monospace font by id at runtime.
	 *
	 * Look-up resolves through `BUILTIN_FONTS` in `src/fonts/index.ts`; an
	 * unknown id throws (same shape as `setTheme`'s typo guard). The font's
	 * `@font-face` rule is lazily injected into the shared
	 * `<style id="sterk-fonts">` element on first use (idempotent across
	 * instances), and the renderer is told to apply the new family with
	 * `monospace` as the fallback so the grid stays legible while the
	 * woff2 is loading.
	 *
	 * We trigger `scheduleUpdate()` rather than a forced repaint: Ace's
	 * `setOption('fontFamily', ...)` already invalidates the cached cell
	 * metrics, so the next coalesced rAF flush picks up the new sizing
	 * without risking the mid-burst zombie-rows scenario that
	 * `forceRepaint()` would expose.
	 */
	setFont(fontId: string): void {
		const font = getBuiltinFont(fontId);
		injectFontFace(font);
		const family = `'${font.family}', monospace`;
		this._options.font = font.id;
		this._options.fontFamily = family;
		if (this.aceRenderer) {
			this.aceRenderer.setFontFamily(family);
			this.aceRenderer.scheduleUpdate();
		}
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
	 * Print a character to the buffer.
	 *
	 * The parser hands us one code point at a time (already UTF-8
	 * decoded), so we route through `printCodePoint` which consults
	 * `wcwidth` and lays out wide / combining / single-width cells
	 * appropriately. ASCII fast-paths through the same call (width 1).
	 *
	 * Aceterm-parity reference: `libterm.js:475-491` did the same routing
	 * via `wc.js`. See audit Row 33 / wcwidth module JSDoc.
	 */
	private handlePrint(char: string, code: number): void {
		this.scrollBuffer.printCodePoint(char, code, this.vtParser.currentAttrs);
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
					// VT100 CUP / HVP coordinates are 1-based and **relative to
					// the visible screen** — NOT to the buffer's absolute line
					// index. The scrollback ring keeps the live screen at the
					// bottom `rows` lines (offset = `liveTop`); we must add
					// that offset, otherwise `\x1b[<rows>;1H` from a status-
					// bar redraw lands on a scrollback line and the previous
					// status freezes on-screen. Each refresh appends another
					// stale bar — which is what produced the "magenta status
					// bar duplicates 3×" the user reported in mobux.
					const row = p1 - 1; // 1-based to 0-based, viewport-relative
					const col = p2 - 1;
					const absRow = this.scrollBuffer.liveTop + row;
					this.scrollBuffer.setCursor(
						Math.max(0, Math.min(col, this.cols - 1)),
						Math.max(
							this.scrollBuffer.liveTop,
							Math.min(absRow, this.scrollBuffer.liveTop + this.rows - 1),
						),
					);
				}
				break;

			case 0x4a: // ED - Erase in Display
				// Per ECMA-48 §8.3.39, missing parameter defaults to **0**
				// (erase from cursor to end of display). The outer `p1` falls
				// back to 1, which is the right default for cursor-movement
				// commands (CUU/CUD/CUP/...) but the WRONG default for ED.
				// Routing `\x1b[J` as ED-mode-1 (erase above cursor) instead
				// of ED-mode-0 (erase below) corrupts the screen during any
				// `clear()`-style sequence sent without an explicit parameter.
				this.eraseInDisplay(params[0]?.[0] ?? 0);
				break;

			case 0x4b: // EL - Erase in Line
				// Per ECMA-48 §8.3.41, missing parameter defaults to **0**
				// (erase from cursor to end of line). Pre-fix, `\x1b[K`
				// (the textbook "erase to end of line" tmux/zsh status
				// redraws emit) was routed as EL-mode-1 (erase to LEFT of
				// cursor) because `p1` falls back to 1. That blanked the
				// stale prompt prefix instead of the tail, leaving stale
				// chars on the right end of the row — one of the two bugs
				// that produced the mobux "magenta status bar duplicates"
				// regression (the other being CUP-as-absolute, fixed
				// above).
				this.eraseInLine(params[0]?.[0] ?? 0);
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

				case 1000: // VT200 mouse tracking — press + release
					this.applyMouseTracking(MouseTrackingMode.VT200, set);
					break;

				case 1002: // Cell-motion mouse tracking — press + release + drag
					this.applyMouseTracking(MouseTrackingMode.CellMotion, set);
					break;

				case 1003: // All-motion mouse tracking — press + release + every motion
					this.applyMouseTracking(MouseTrackingMode.AllMotion, set);
					break;

				case 1006: // SGR 1006 encoding — orthogonal to tracking mode
					this.applyMouseEncoding(
						set ? MouseEncoding.SGR : MouseEncoding.Default,
					);
					break;

				// Other DEC private modes - ignore for now
				default:
					break;
			}
		}
	}

	/**
	 * Apply a DEC mouse tracking mode change (1000 / 1002 / 1003).
	 *
	 * Tracking modes are mutually exclusive: setting any of them replaces
	 * the previously-active tracking mode. Resetting (`?...l`) clears
	 * tracking only when the currently-active mode matches the one being
	 * reset — this matches xterm's behaviour (tmux disables modes in the
	 * same order it enabled them, so a stray `?1000l` after `?1002h` must
	 * not clobber the 1002 state).
	 */
	private applyMouseTracking(mode: MouseTrackingMode, set: boolean): void {
		if (set) {
			this.pendingMouseTracking = mode;
		} else if (this.pendingMouseTracking === mode) {
			this.pendingMouseTracking = MouseTrackingMode.Off;
		} else {
			return;
		}
		this.mouseHandler?.setTrackingMode(this.pendingMouseTracking);
	}

	/** Apply a DEC mouse encoding change (1006 is orthogonal to tracking). */
	private applyMouseEncoding(encoding: MouseEncoding): void {
		this.pendingMouseEncoding = encoding;
		this.mouseHandler?.setEncoding(encoding);
	}
}
