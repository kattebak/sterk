/**
 * Type definitions for the @kattebak/sterk terminal emulator API.
 *
 * Design notes:
 * - OSC 133 (shell integration) is a first-class feature, not an extension.
 * - The buffer API supports read-only access to rendered cells with full
 *   attribute details (fg/bg colors, bold, italic, underline, inverse).
 */

// ── Core Terminal Interface ──────────────────────────────────────────

/**
 * The main terminal instance. Handles VT parsing, buffer management,
 * and rendering coordination.
 */
export interface Terminal {
	/**
	 * Number of columns in the terminal grid.
	 * @readonly after construction — use resize() to change
	 */
	readonly cols: number;

	/**
	 * Number of rows in the terminal grid.
	 * @readonly after construction — use resize() to change
	 */
	readonly rows: number;

	/**
	 * Terminal configuration options.
	 * Some properties (fontSize, fontFamily, theme) are live-mutable.
	 */
	options: TerminalOptions;

	/**
	 * VT parser instance. Consumers use this to register OSC handlers.
	 */
	readonly parser: Parser;

	/**
	 * Buffer accessor. Returns the active (normal or alternate) buffer.
	 */
	readonly buffer: BufferNamespace;

	/**
	 * Write data to the terminal. Accepts string or Uint8Array.
	 * Data is parsed as UTF-8 and rendered into the buffer.
	 *
	 * @param data - String or binary data to write
	 * @param callback - Optional callback invoked after write completes
	 */
	write(data: string | Uint8Array, callback?: () => void): void;

	/**
	 * Resize the terminal to the specified dimensions.
	 * Triggers a reflow of the buffer and redraws the viewport.
	 *
	 * @param cols - New column count
	 * @param rows - New row count
	 */
	resize(cols: number, rows: number): void;

	/**
	 * Clear the terminal buffer and reset the cursor to (0, 0).
	 * Equivalent to sending `\x1b[2J\x1b[H`.
	 */
	clear(): void;

	/**
	 * Scroll the viewport by the given number of lines.
	 * Positive values scroll down (revealing older content),
	 * negative values scroll up (revealing newer content).
	 *
	 * @param lines - Number of lines to scroll (signed)
	 */
	scrollLines(lines: number): void;

	/**
	 * Scroll the viewport to the bottom of the buffer.
	 * Pins viewportY to the maximum scroll position.
	 */
	scrollToBottom(): void;

	/**
	 * Force the renderer to repaint after any currently in-flight writes
	 * have been applied to the document.
	 *
	 * Sterk coalesces `write()` → Ace-document updates onto the next
	 * animation frame. Reaching into Ace's internal `renderer.updateFull()`
	 * directly can land mid-burst and paint a half-synced document,
	 * producing duplicated / stale rows ("zombie rows"). `refresh()` is
	 * the race-safe entry point: it waits for the next coalesced flush,
	 * then asks the renderer to re-paint.
	 *
	 * Typical use cases:
	 * - Theme or font swap that requires re-paint of every visible row
	 * - Manual scrollback flush
	 * - Recovery from a suspected render glitch
	 *
	 * In headless mode (terminal not attached via `open()`) this is a
	 * no-op and resolves immediately.
	 *
	 * @returns Promise that resolves once the repaint has been committed.
	 */
	refresh?(): Promise<void>;

	/**
	 * Register a callback to be invoked after each write() completes
	 * and the buffer has been updated.
	 *
	 * This is the single source of truth for "buffer changed" events.
	 * All writes (WS data, history reload, synthetic test injects) flow
	 * through this hook.
	 *
	 * @param callback - Function to invoke after each write
	 * @returns Disposable handle to unregister the callback
	 */
	onWriteParsed(callback: () => void): Disposable;

	/**
	 * Register a callback to be invoked when user input is generated.
	 * Input can come from keyboard events, mouse events, or programmatic
	 * sends (e.g. via an input bar).
	 *
	 * @param callback - Function receiving the input data as a string
	 * @returns Disposable handle to unregister the callback
	 */
	onData(callback: (data: string) => void): Disposable;

	/**
	 * Send input data to the terminal (for forwarding to the backend).
	 * Most consumers will call this in response to keyboard/paste events.
	 *
	 * @param data - String or binary data to send
	 */
	send?(data: string | Uint8Array): void;

	/**
	 * Internal renderer instance (implementation-specific).
	 * Consumers needing deep renderer access (e.g., Ace integration) can
	 * type-assert this to their specific renderer type.
	 *
	 * @internal - Use at your own risk
	 */
	readonly renderer?: unknown;

	/**
	 * Attach the terminal to a DOM container and start rendering.
	 * This is optional — the terminal can run in headless mode without calling open().
	 *
	 * @param container - DOM element to render the terminal into
	 */
	open?(container: HTMLElement): void;

	/**
	 * Get the pixel dimensions of a single character cell.
	 * Used for scroll calculations and viewport sizing on mobile.
	 *
	 * @returns Cell width and height in CSS pixels, or null if not yet rendered
	 */
	getCellMetrics?(): { width: number; height: number } | null;

	/**
	 * Compute the exact cell grid (cols × rows) that fits in the
	 * currently rendered scroller area, accounting for any internal
	 * padding the renderer applies.
	 *
	 * Prefer this over computing `cols = floor(container.clientWidth /
	 * cellWidth)` yourself: the renderer knows its own padding and
	 * scrollbar reservation, and this method is the single source of
	 * truth. On Pixel 7 with a 412px viewport and 9px cell width, naive
	 * math gives 45 cols, but only ~43 actually fit without clipping.
	 *
	 * Returns null until the editor has measured itself (i.e. before
	 * `open()` and the first rAF flush).
	 */
	getViewportCellCount?(): { cols: number; rows: number } | null;

	/**
	 * Swap to a built-in theme by id at runtime, without re-instantiating
	 * the Terminal.
	 *
	 * Looks up the theme in the built-in `THEMES` registry (see
	 * `src/themes/index.ts`) and re-applies it: the per-instance
	 * `#sterk-theme` stylesheet is regenerated against the new palette
	 * (CSS custom properties + 256-color fg/bg rules + contrast rules)
	 * and the renderer is asked to re-paint via the race-safe `refresh()`
	 * path — never reaches into Ace's internal `renderer.updateFull()`.
	 *
	 * @param themeId - The kebab-case id of a built-in theme
	 *   (e.g. `"solarized-dark"`).
	 * @throws Error if `themeId` is not a known built-in theme.
	 */
	setTheme?(themeId: string): void;

	/**
	 * Clean up resources and detach event listeners.
	 * The Terminal instance should not be used after calling dispose().
	 */
	dispose(): void;
}

// ── Buffer Access ────────────────────────────────────────────────────

/**
 * Buffer namespace accessor. Exposes the active buffer (normal or alternate).
 */
export interface BufferNamespace {
	/**
	 * The currently active buffer.
	 * Returns the normal buffer by default; returns the alternate buffer
	 * when the terminal is in alternate screen mode (e.g. inside vim/less).
	 */
	readonly active: Buffer;
}

/**
 * Read-only view of the terminal buffer.
 * Provides access to the scrollback history, cursor position, and viewport state.
 */
export interface Buffer {
	/**
	 * Total number of lines in the buffer, including scrollback.
	 * Equal to rows + scrollback line count.
	 */
	readonly length: number;

	/**
	 * Cursor X position (column) within the active row.
	 * 0-indexed.
	 */
	readonly cursorX: number;

	/**
	 * Cursor Y position (row) relative to the viewport top.
	 * 0-indexed. Does NOT include scrollback offset — use baseY for that.
	 */
	readonly cursorY: number;

	/**
	 * Absolute row index of the first row in the scrollback buffer.
	 * When scrollback is empty, baseY === 0.
	 * When scrollback has N lines, baseY === N.
	 */
	readonly baseY: number;

	/**
	 * Absolute row index of the topmost visible row in the viewport.
	 * Tracks the user's scroll position.
	 * When pinned to the bottom, viewportY === baseY.
	 */
	readonly viewportY: number;

	/**
	 * Get a specific line from the buffer by absolute row index.
	 *
	 * @param y - Absolute row index (0 to length-1)
	 * @returns BufferLine if the row exists, null otherwise
	 */
	getLine(y: number): BufferLine | null;
}

/**
 * A single line in the terminal buffer.
 * Provides access to individual cells and line-level metadata.
 */
export interface BufferLine {
	/**
	 * Whether this line is a wrapped continuation of the previous line.
	 * True when the line resulted from a long line wrapping at the right margin.
	 */
	readonly isWrapped: boolean;

	/**
	 * Extract the text content of the line as a string.
	 *
	 * @param trimRight - If true, remove trailing whitespace
	 * @returns The line's text content
	 */
	translateToString(trimRight?: boolean): string;

	/**
	 * Get a specific cell from the line by column index.
	 *
	 * @param x - Column index (0 to cols-1)
	 * @returns BufferCell if the column exists, or a blank cell placeholder
	 */
	getCell(x: number): BufferCell;
}

/**
 * A single character cell in the terminal buffer.
 * Exposes the character content and all SGR attributes (colors, styles).
 */
export interface BufferCell {
	/**
	 * The character(s) in this cell. May be empty for blank cells,
	 * or multi-char for wide glyphs (e.g. emoji, CJK).
	 */
	getChars(): string;

	/**
	 * The Unicode code point of the first character in this cell.
	 * Returns 0 for blank cells.
	 */
	getCode(): number;

	// ── Foreground color ─────────────────────────────────────────────

	/**
	 * True if the foreground uses the default theme color.
	 */
	isFgDefault(): boolean;

	/**
	 * True if the foreground is a palette color (ANSI 0-255).
	 */
	isFgPalette(): boolean;

	/**
	 * True if the foreground is an RGB color (24-bit true color).
	 */
	isFgRGB(): boolean;

	/**
	 * Get the foreground color value.
	 * - Returns -1 if isFgDefault() is true
	 * - Returns 0-255 if isFgPalette() is true (ANSI palette index)
	 * - Returns 0xRRGGBB if isFgRGB() is true (24-bit RGB)
	 */
	getFgColor(): number;

	/**
	 * Get the foreground color mode bitmask.
	 * - 0x000 = default
	 * - 0x100 = palette
	 * - 0x200 = RGB
	 */
	getFgColorMode(): number;

	// ── Background color ─────────────────────────────────────────────

	/**
	 * True if the background uses the default theme color.
	 */
	isBgDefault(): boolean;

	/**
	 * True if the background is a palette color (ANSI 0-255).
	 */
	isBgPalette(): boolean;

	/**
	 * True if the background is an RGB color (24-bit true color).
	 */
	isBgRGB(): boolean;

	/**
	 * Get the background color value.
	 * - Returns -1 if isBgDefault() is true
	 * - Returns 0-255 if isBgPalette() is true (ANSI palette index)
	 * - Returns 0xRRGGBB if isBgRGB() is true (24-bit RGB)
	 */
	getBgColor(): number;

	/**
	 * Get the background color mode bitmask.
	 * - 0x000 = default
	 * - 0x100 = palette
	 * - 0x200 = RGB
	 */
	getBgColorMode(): number;

	// ── Text attributes ──────────────────────────────────────────────

	/**
	 * True if the cell has the bold attribute set (SGR 1).
	 */
	isBold(): boolean;

	/**
	 * True if the cell has the italic attribute set (SGR 3).
	 */
	isItalic(): boolean;

	/**
	 * True if the cell has the underline attribute set (SGR 4).
	 */
	isUnderline(): boolean;

	/**
	 * True if the cell has the inverse/reverse video attribute set (SGR 7).
	 * When inverse is set, fg and bg colors are swapped when rendering.
	 */
	isInverse(): boolean;

	/**
	 * True if the cell has the dim attribute set (SGR 2).
	 * Dim text is typically rendered at reduced opacity.
	 */
	isDim(): boolean;
}

// ── Parser & OSC Handlers ────────────────────────────────────────────

/**
 * VT parser instance. Handles escape sequences, CSI, OSC, and DCS.
 *
 * OSC 133 (shell integration) is a first-class feature in sterk.
 * Consumers register handlers for specific OSC identifiers to receive
 * parsed OSC data without monkey-patching the parser internals.
 */
export interface Parser {
	/**
	 * Register a handler for a specific OSC sequence identifier.
	 *
	 * Multiple handlers can be registered for the same OSC ID and will be
	 * invoked in registration order. If a handler returns `true`, propagation
	 * stops and subsequent handlers for that OSC ID are not invoked.
	 *
	 * OSC 133 (shell integration) is NOT automatically handled by sterk.
	 * Consumers must register their own OSC 133 handler if they want to
	 * track prompt boundaries, command execution, or command output regions.
	 *
	 * Example: Register a handler for OSC 133 (shell integration):
	 * ```
	 * term.parser.registerOscHandler(133, (data) => {
	 *   const kind = data.charAt(0); // 'A', 'B', 'C', 'D'
	 *   if (kind === 'A' || kind === 'B') {
	 *     // Mark prompt boundary at current cursor position
	 *     return true; // Stop propagation
	 *   }
	 *   return false; // Allow other handlers
	 * });
	 * ```
	 *
	 * @param id - OSC identifier (e.g. 0 for title, 133 for shell integration)
	 * @param handler - Callback invoked when the OSC sequence is parsed
	 * @returns Disposable handle to unregister the handler
	 */
	registerOscHandler(id: number, handler: OscHandler): Disposable;
}

/**
 * Callback invoked when an OSC sequence is parsed.
 *
 * @param data - The OSC payload string (everything after `OSC <id> ;` and before `ST`)
 * @returns True if the handler consumed the sequence, false to allow fallthrough
 */
export type OscHandler = (data: string) => boolean | undefined;

// ── Options & Configuration ──────────────────────────────────────────

/**
 * Terminal configuration options.
 * Passed to the Terminal constructor and live-mutable via `term.options`.
 */
export interface TerminalOptions {
	/**
	 * Initial number of columns. Can be changed via resize().
	 */
	cols?: number;

	/**
	 * Initial number of rows. Can be changed via resize().
	 */
	rows?: number;

	/**
	 * Number of lines to keep in scrollback history.
	 * @default 1000
	 */
	scrollback?: number;

	/**
	 * Color theme. Defines foreground, background, and ANSI palette colors.
	 */
	theme?: Theme;

	/**
	 * Font family for rendered text.
	 * @default 'monospace'
	 */
	fontFamily?: string;

	/**
	 * Font size in pixels. Live-mutable.
	 * @default 13
	 */
	fontSize?: number;

	/**
	 * Allow users to select text with mouse/touch.
	 * @default true
	 */
	allowSelection?: boolean;
}

/**
 * Color theme definition.
 * Specifies the default foreground/background and the 16-color ANSI palette.
 *
 * @remarks
 * Palette colors are indexed 0-15:
 * - 0-7: standard ANSI colors (black, red, green, yellow, blue, magenta, cyan, white)
 * - 8-15: bright variants of the standard colors
 */
export interface Theme {
	/**
	 * Default foreground color (text color).
	 * CSS color string (hex, rgb, named color).
	 */
	foreground?: string;

	/**
	 * Default background color.
	 * CSS color string (hex, rgb, named color).
	 */
	background?: string;

	/**
	 * Cursor color. If not set, uses the inverse of the foreground.
	 */
	cursor?: string;

	/**
	 * Cursor accent color (for block cursor text color).
	 */
	cursorAccent?: string;

	/**
	 * Selection background color.
	 */
	selectionBackground?: string;

	/**
	 * ANSI palette colors (indexes 0-15).
	 * Each entry is a CSS color string.
	 *
	 * If fewer than 16 colors are provided, sterk will use default
	 * ANSI colors for the missing indexes.
	 */
	palette?: string[];

	// ── Extended xterm.js theme properties (optional, for future compat) ──

	/**
	 * ANSI black (color 0). Alias for palette[0].
	 */
	black?: string;

	/**
	 * ANSI red (color 1). Alias for palette[1].
	 */
	red?: string;

	/**
	 * ANSI green (color 2). Alias for palette[2].
	 */
	green?: string;

	/**
	 * ANSI yellow (color 3). Alias for palette[3].
	 */
	yellow?: string;

	/**
	 * ANSI blue (color 4). Alias for palette[4].
	 */
	blue?: string;

	/**
	 * ANSI magenta (color 5). Alias for palette[5].
	 */
	magenta?: string;

	/**
	 * ANSI cyan (color 6). Alias for palette[6].
	 */
	cyan?: string;

	/**
	 * ANSI white (color 7). Alias for palette[7].
	 */
	white?: string;

	/**
	 * ANSI bright black / gray (color 8). Alias for palette[8].
	 */
	brightBlack?: string;

	/**
	 * ANSI bright red (color 9). Alias for palette[9].
	 */
	brightRed?: string;

	/**
	 * ANSI bright green (color 10). Alias for palette[10].
	 */
	brightGreen?: string;

	/**
	 * ANSI bright yellow (color 11). Alias for palette[11].
	 */
	brightYellow?: string;

	/**
	 * ANSI bright blue (color 12). Alias for palette[12].
	 */
	brightBlue?: string;

	/**
	 * ANSI bright magenta (color 13). Alias for palette[13].
	 */
	brightMagenta?: string;

	/**
	 * ANSI bright cyan (color 14). Alias for palette[14].
	 */
	brightCyan?: string;

	/**
	 * ANSI bright white (color 15). Alias for palette[15].
	 */
	brightWhite?: string;
}

/**
 * A complete, named, built-in color theme.
 *
 * Distinct from `Theme` (the consumer-supplied xterm-style options bag):
 * `BuiltinTheme` is a fully-specified value object that sterk ships with
 * an `id` (kebab-case, used for `Terminal.setTheme(id)`), a human-readable
 * `name`, and the entire 16-color ANSI palette plus default fg/bg/cursor/
 * selection colors. Built-in themes are registered in `THEMES` (see
 * `src/themes/index.ts`) and can be selected by id at runtime.
 *
 * For round-trip compatibility with the xterm-style `Theme` consumers
 * already pass to `createTerminal({ theme })`, a `BuiltinTheme` can be
 * projected to a `Theme` via `builtinThemeToTheme()` (see `src/themes/index.ts`).
 */
export interface BuiltinTheme {
	/**
	 * Machine-readable id (kebab-case). Used for `Terminal.setTheme(id)`.
	 */
	id: string;

	/**
	 * Human-readable display name (e.g. "Solarized Dark").
	 */
	name: string;

	/**
	 * The 16-color ANSI palette. Index 0-7 are the standard ANSI colors,
	 * 8-15 are bright variants. Each entry is a CSS hex color string.
	 */
	ansi: readonly [
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
	];

	/**
	 * Default foreground (text) color.
	 */
	defaultFg: string;

	/**
	 * Default background color.
	 */
	defaultBg: string;

	/**
	 * Cursor color.
	 */
	cursor: string;

	/**
	 * Selection background color (CSS color — usually with alpha).
	 */
	selectionBg: string;

	/**
	 * Optional selection foreground override. Most themes leave the text
	 * legible by default and omit this.
	 */
	selectionFg?: string;
}

// ── Disposable Pattern ───────────────────────────────────────────────

/**
 * Disposable handle returned by event subscriptions.
 * Calling dispose() unregisters the handler.
 */
export interface Disposable {
	dispose(): void;
}
