/**
 * Sterk — Touch-friendly terminal emulator for the web
 *
 * Pairs Ace's mature text-rendering engine with a clean-room VT core.
 * Treats shell-integration (OSC 133) as a first-class primitive rather than an extension.
 *
 * Status: M0 (API contract defined). Implementation in progress.
 *

 */

export const VERSION = "0.0.0";

// Re-export all type definitions
export type {
	Buffer,
	BufferCell,
	BufferLine,
	BufferNamespace,
	BuiltinTheme,
	Disposable,
	OscHandler,
	Parser,
	Terminal,
	TerminalOptions,
	Theme,
} from "./types.js";

// ── B10/B11: Built-in themes ────────────────────────────────────────

export {
	builtinThemeToTheme,
	DEFAULT_BUILTIN_THEME_ID,
	GRUVBOX_DARK_SOFT,
	getBuiltinTheme,
	NORD,
	SOLARIZED_DARK,
	SOLARIZED_LIGHT,
	THEMES,
	TOMORROW_NIGHT,
} from "./themes/index.js";

// ── M1: Color Palette Utilities ─────────────────────────────────────

export {
	ANSI_COLORS,
	buildPalette,
	contrastFg,
	hexToPalette,
	hexToRgb,
	LUMINANCE_THRESHOLD,
	type PaletteIndex,
	paletteToHex,
	paletteToRgb,
	type RGB,
	relativeLuminance,
	rgbToHex,
	rgbToPalette,
} from "./util/colors.js";

// ── M1: EventEmitter Shim ───────────────────────────────────────────

export { EventEmitter } from "./util/event_emitter.js";

// ── M1: Scrollback Buffer (internal, not exported) ──────────────────
// The ScrollBuffer and related classes are internal implementation details.
// They will be used by the Terminal implementation but are not part of the
// public API surface. Consumers interact with buffers via the Buffer/BufferLine/
// BufferCell interfaces defined in types.ts.

// ── Constructor Stub ─────────────────────────────────────────────────

import { TerminalImpl } from "./terminal.js";
import type { Terminal, TerminalOptions } from "./types.js";

/**
 * Create a new Terminal instance.
 *
 * @param options - Terminal configuration options
 * @returns Terminal instance
 *
 * @example
 * ```typescript
 * import { createTerminal } from '@kattebak/sterk';
 *
 * const term = createTerminal({
 *   cols: 80,
 *   rows: 24,
 *   scrollback: 10000,
 *   theme: {
 *     foreground: '#f0f0f0',
 *     background: '#1e1e1e',
 *   },
 * });
 *
 * term.write('Hello, world!');
 * term.write('\x1b[1;31mBold red text\x1b[0m\n');
 * ```
 */
export function createTerminal(options?: TerminalOptions): Terminal {
	return new TerminalImpl(options);
}
