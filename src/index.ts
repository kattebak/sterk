/**
 * Sterk — Touch-friendly terminal emulator for the web
 *
 * Pairs Ace's mature text-rendering engine with a clean-room VT core.
 * Treats shell-integration (OSC 133) as a first-class primitive rather than an extension.
 *
 * Status: M0 (API contract defined). Implementation in progress.
 *
 * Reference consumer: mobux (https://github.com/mvhenten/mobux)
 */

export const VERSION = "0.0.0";

// Re-export all type definitions
export type {
	Buffer,
	BufferCell,
	BufferLine,
	BufferNamespace,
	Disposable,
	OscHandler,
	Parser,
	Terminal,
	TerminalOptions,
	Theme,
} from "./types.js";

// ── Constructor Stub ─────────────────────────────────────────────────

import type { Terminal, TerminalOptions } from "./types.js";

/**
 * Create a new Terminal instance.
 *
 * **NOT YET IMPLEMENTED** — this is a type-safe stub for the M0 API contract.
 * Consumers can import and reference this constructor to typecheck their code,
 * but calling it will throw an error until the implementation lands in M1+.
 *
 * @param options - Terminal configuration options
 * @returns Terminal instance (when implemented)
 * @throws Error - Always throws in M0 (not yet implemented)
 *
 * @example
 * ```typescript
 * import { createTerminal } from '@kattebak/sterk';
 *
 * const term = createTerminal({
 *   cols: 80,
 *   rows: 24,
 *   theme: {
 *     foreground: '#f0f0f0',
 *     background: '#1e1e1e',
 *   },
 * });
 *
 * term.write('Hello, world!');
 * ```
 */
export function createTerminal(_options?: TerminalOptions): Terminal {
	throw new Error(
		"Terminal constructor not yet implemented — see docs/ROADMAP.md for implementation status",
	);
}
