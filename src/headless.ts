/**
 * Headless entry: the VT parser, the buffer, replies and markers, with no
 * renderer and no Ace in the import graph. `open()` and `setFont()` throw;
 * import from `@kattebak/sterk` to draw a terminal.
 */

export type {
	Buffer,
	BufferCell,
	BufferLine,
	BufferNamespace,
	CsiHandler,
	DcsHandler,
	Disposable,
	EscHandler,
	IMarker,
	OscHandler,
	Parser,
	ParserHandlerIdentifier,
	TerminalOptions,
	Theme,
} from "./types.js";

import { TerminalImpl } from "./terminal.js";
import type { Terminal as TerminalInstance, TerminalOptions } from "./types.js";

export const Terminal = TerminalImpl as unknown as {
	new (options?: TerminalOptions): TerminalInstance;
};

export type Terminal = TerminalInstance;

export function createTerminal(options?: TerminalOptions): TerminalInstance {
	return new Terminal(options);
}
