/**
 * VT Parser - Clean-room implementation from Paul Williams' DEC ANSI parser spec
 *
 * References:
 * - https://vt100.net/emu/dec_ansi_parser (Paul Williams' state machine)
 * - https://invisible-island.net/xterm/ctlseqs/ctlseqs.html (XTerm control sequences)
 * - ECMA-48 / ANSI X3.64 standards
 *
 * This parser implements a subset of the full VT500-series parser:
 * - C0 control codes (BEL, BS, HT, LF, VT, FF, CR, ESC)
 * - CSI sequences (cursor movement, erase, SGR)
 * - OSC sequences (titles, shell integration OSC 133)
 *
 * Unsupported sequences are silently ignored.
 */

import type { CellAttributes } from "../buffer/scroll_buffer.js";
import { DEFAULT_CELL_ATTRIBUTES } from "../buffer/scroll_buffer.js";
import type {
	CsiHandler,
	DcsHandler,
	EscHandler,
	OscHandler,
	ParserHandlerIdentifier,
} from "../types.js";

/**
 * Build the lookup key for a CSI/ESC/DCS handler from its prefix,
 * intermediate bytes and final byte. The three byte groups are joined with
 * NUL separators so they can never collide (e.g. prefix `?` + final `h`
 * must not match intermediate ` ` + final `h`).
 */
function handlerKey(
	prefix: number,
	intermediates: number[],
	final: number,
): string {
	return `${prefix}\0${intermediates.join(",")}\0${final}`;
}

/**
 * Resolve a {@link ParserHandlerIdentifier} (string-encoded bytes from the
 * public API) into the numeric lookup key used internally.
 */
function identifierToKey(id: ParserHandlerIdentifier): string {
	const prefix = id.prefix ? id.prefix.charCodeAt(0) : 0;
	const intermediates = id.intermediates
		? Array.from(id.intermediates, (c) => c.charCodeAt(0))
		: [];
	const final = id.final.charCodeAt(0);
	return handlerKey(prefix, intermediates, final);
}

/**
 * Split the parser's combined `intermediates` array (which collects both the
 * 0x3c–0x3f private-marker prefix and 0x20–0x2f intermediate bytes) back into
 * the xterm-style `prefix` byte and the true intermediate bytes.
 */
function splitPrefix(collected: number[]): {
	prefix: number;
	intermediates: number[];
} {
	let prefix = 0;
	const intermediates: number[] = [];
	for (const byte of collected) {
		if (byte >= 0x3c && byte <= 0x3f) {
			// Private markers live at the head of the sequence; keep the first.
			if (prefix === 0) {
				prefix = byte;
			}
		} else {
			intermediates.push(byte);
		}
	}
	return { prefix, intermediates };
}

/**
 * Convert the parser's internal `number[][]` parameter representation into the
 * xterm-style `(number | number[])[]` shape: a missing/empty parameter becomes
 * `0` (xterm's default), a single value becomes a `number`, and a parameter
 * carrying sub-parameters becomes a `number[]`.
 */
function toPublicParams(params: number[][]): (number | number[])[] {
	return params.map((p) => {
		if (p.length === 0) {
			return 0;
		}
		if (p.length === 1) {
			return p[0] ?? 0;
		}
		return p;
	});
}

/**
 * Parser states (from Paul Williams' state machine)
 */
enum ParserState {
	GROUND = 0,
	ESCAPE = 1,
	ESCAPE_INTERMEDIATE = 2,
	CSI_ENTRY = 3,
	CSI_PARAM = 4,
	CSI_INTERMEDIATE = 5,
	CSI_IGNORE = 6,
	OSC_STRING = 7,
	DCS_ENTRY = 8,
	DCS_PARAM = 9,
	DCS_INTERMEDIATE = 10,
	DCS_PASSTHROUGH = 11,
	DCS_IGNORE = 12,
	SOS_PM_APC_STRING = 13,
}

/**
 * Actions the parser can take
 */
interface ParserActions {
	/** Print a character to the buffer */
	print(char: string, code: number): void;
	/** Execute a C0 or C1 control code */
	execute(code: number): void;
	/** Dispatch an ESC sequence */
	escDispatch(intermediates: number[], final: number): void;
	/** Dispatch a CSI sequence */
	csiDispatch(params: number[][], intermediates: number[], final: number): void;
	/** Dispatch an OSC sequence */
	oscDispatch(id: number, data: string): void;
	/** Put a character into the current param/intermediate buffer */
	put(code: number): void;
	/** Collect an intermediate character */
	collect(code: number): void;
	/** Collect a parameter character */
	param(code: number): void;
	/** Clear the parser state */
	clear(): void;
	/** Hook for DCS sequences (not implemented in M2) */
	hook?(params: number[][], intermediates: number[], final: number): void;
	/** Unhook from DCS (not implemented in M2) */
	unhook?(): void;
	/** DCS put (not implemented in M2) */
	dcsPut?(code: number): void;
}

/**
 * UTF-8 decoder state
 */
class Utf8Decoder {
	private buffer: number[] = [];
	private expected = 0;

	/**
	 * Get the number of bytes expected (0 if not in a sequence)
	 */
	getExpected(): number {
		return this.expected;
	}

	/**
	 * Process a byte and return the decoded character if complete
	 */
	decode(byte: number): string | null {
		// ASCII fast path
		if (byte < 0x80) {
			if (this.buffer.length > 0) {
				// Invalid sequence, reset
				this.buffer = [];
				this.expected = 0;
			}
			return String.fromCharCode(byte);
		}

		// Multi-byte sequence start
		if (byte >= 0xc0 && byte < 0xe0) {
			this.buffer = [byte];
			this.expected = 2;
			return null;
		}
		if (byte >= 0xe0 && byte < 0xf0) {
			this.buffer = [byte];
			this.expected = 3;
			return null;
		}
		if (byte >= 0xf0 && byte < 0xf8) {
			this.buffer = [byte];
			this.expected = 4;
			return null;
		}

		// Continuation byte
		if (byte >= 0x80 && byte < 0xc0) {
			if (this.buffer.length === 0) {
				// Unexpected continuation, ignore
				return null;
			}
			this.buffer.push(byte);

			// Check if complete
			if (this.buffer.length === this.expected) {
				const codePoint = this.decodeCodePoint(this.buffer);
				this.buffer = [];
				this.expected = 0;
				if (codePoint !== null) {
					return String.fromCodePoint(codePoint);
				}
			}
			return null;
		}

		// Invalid byte, reset
		this.buffer = [];
		this.expected = 0;
		return null;
	}

	private decodeCodePoint(bytes: number[]): number | null {
		if (
			bytes.length === 2 &&
			bytes[0] !== undefined &&
			bytes[1] !== undefined
		) {
			return ((bytes[0] & 0x1f) << 6) | (bytes[1] & 0x3f);
		}
		if (
			bytes.length === 3 &&
			bytes[0] !== undefined &&
			bytes[1] !== undefined &&
			bytes[2] !== undefined
		) {
			return (
				((bytes[0] & 0x0f) << 12) | ((bytes[1] & 0x3f) << 6) | (bytes[2] & 0x3f)
			);
		}
		if (
			bytes.length === 4 &&
			bytes[0] !== undefined &&
			bytes[1] !== undefined &&
			bytes[2] !== undefined &&
			bytes[3] !== undefined
		) {
			return (
				((bytes[0] & 0x07) << 18) |
				((bytes[1] & 0x3f) << 12) |
				((bytes[2] & 0x3f) << 6) |
				(bytes[3] & 0x3f)
			);
		}
		return null;
	}
}

/**
 * VT Parser implementation
 */
export class VtParser {
	private state = ParserState.GROUND;
	private intermediates: number[] = [];
	private params: number[][] = [[]];
	private currentParam = 0;
	private oscData = "";
	private utf8Decoder = new Utf8Decoder();
	private oscHandlers = new Map<number, OscHandler[]>();
	private csiHandlers = new Map<string, CsiHandler[]>();
	private escHandlers = new Map<string, EscHandler[]>();
	private dcsHandlers = new Map<string, DcsHandler[]>();
	private oscPendingEscape = false; // Track if we're waiting for \ after ESC in OSC
	private stringPendingEscape = false; // Same, for DCS/SOS/PM/APC string states

	/** Current SGR attributes */
	currentAttrs: CellAttributes = { ...DEFAULT_CELL_ATTRIBUTES };

	constructor(private actions: ParserActions) {}

	/**
	 * Register a handler for a specific OSC sequence
	 */
	registerOscHandler(id: number, handler: OscHandler): { dispose: () => void } {
		if (!this.oscHandlers.has(id)) {
			this.oscHandlers.set(id, []);
		}
		const handlers = this.oscHandlers.get(id);
		handlers?.push(handler);

		return {
			dispose: () => {
				const handlersAfterRemove = this.oscHandlers.get(id);
				if (handlersAfterRemove) {
					const index = handlersAfterRemove.indexOf(handler);
					if (index !== -1) {
						handlersAfterRemove.splice(index, 1);
					}
					if (handlersAfterRemove.length === 0) {
						this.oscHandlers.delete(id);
					}
				}
			},
		};
	}

	/**
	 * Register a CSI handler. See {@link Parser.registerCsiHandler}.
	 */
	registerCsiHandler(
		id: ParserHandlerIdentifier,
		handler: CsiHandler,
	): { dispose: () => void } {
		return this.addHandler(this.csiHandlers, identifierToKey(id), handler);
	}

	/**
	 * Register an ESC handler. See {@link Parser.registerEscHandler}.
	 *
	 * ESC sequences carry no private-marker prefix, so any `prefix` in the
	 * identifier is ignored.
	 */
	registerEscHandler(
		id: ParserHandlerIdentifier,
		handler: EscHandler,
	): { dispose: () => void } {
		return this.addHandler(
			this.escHandlers,
			identifierToKey({ intermediates: id.intermediates, final: id.final }),
			handler,
		);
	}

	/**
	 * Register a DCS handler. See {@link Parser.registerDcsHandler}.
	 */
	registerDcsHandler(
		id: ParserHandlerIdentifier,
		handler: DcsHandler,
	): { dispose: () => void } {
		return this.addHandler(this.dcsHandlers, identifierToKey(id), handler);
	}

	/**
	 * Add a handler to a keyed registry and return its Disposable. Shared
	 * by the CSI/ESC/DCS registration methods.
	 */
	private addHandler<T>(
		registry: Map<string, T[]>,
		key: string,
		handler: T,
	): { dispose: () => void } {
		let handlers = registry.get(key);
		if (!handlers) {
			handlers = [];
			registry.set(key, handlers);
		}
		handlers.push(handler);

		return {
			dispose: () => {
				const current = registry.get(key);
				if (!current) {
					return;
				}
				const index = current.indexOf(handler);
				if (index !== -1) {
					current.splice(index, 1);
				}
				if (current.length === 0) {
					registry.delete(key);
				}
			},
		};
	}

	/**
	 * Run the registered handlers for a key in reverse registration order
	 * (last registered first), matching xterm.js. Returns `true` if any
	 * handler consumed the sequence (returned a synchronous `true`), in which
	 * case the caller must suppress default processing.
	 *
	 * Async handlers (returning a Promise) are treated as `false` for the
	 * current dispatch — sterk's parser is synchronous and must not block.
	 * The promise is still awaited best-effort so rejections surface, but its
	 * resolution does not retroactively consume the (already-dispatched)
	 * sequence.
	 */
	private runHandlers<T>(
		handlers: T[] | undefined,
		invoke: (handler: T) => boolean | Promise<boolean>,
	): boolean {
		if (!handlers || handlers.length === 0) {
			return false;
		}
		// Snapshot so a handler disposing itself mid-iteration is safe.
		const snapshot = handlers.slice();
		for (let i = snapshot.length - 1; i >= 0; i--) {
			const handler = snapshot[i];
			if (handler === undefined) {
				continue;
			}
			const result = invoke(handler);
			if (result === true) {
				return true;
			}
			if (typeof result === "object" && typeof result.then === "function") {
				// Best-effort await; does not consume the sequence synchronously.
				result.catch(() => {
					/* swallow — parser must not throw on consumer handler */
				});
			}
		}
		return false;
	}

	/**
	 * Write data to the parser (string or Uint8Array)
	 */
	write(data: string | Uint8Array): void {
		if (typeof data === "string") {
			// Convert string to bytes
			const encoder = new TextEncoder();
			const bytes = encoder.encode(data);
			for (const byte of bytes) {
				this.processByte(byte);
			}
		} else {
			for (const byte of data) {
				this.processByte(byte);
			}
		}
	}

	/**
	 * Process a single byte through the state machine
	 */
	private processByte(byte: number): void {
		// Handle anywhere transitions (ESC, C0 controls)
		if (this.handleAnywhereTransitions(byte)) {
			return;
		}

		switch (this.state) {
			case ParserState.GROUND:
				this.handleGround(byte);
				break;
			case ParserState.ESCAPE:
				this.handleEscape(byte);
				break;
			case ParserState.ESCAPE_INTERMEDIATE:
				this.handleEscapeIntermediate(byte);
				break;
			case ParserState.CSI_ENTRY:
				this.handleCsiEntry(byte);
				break;
			case ParserState.CSI_PARAM:
				this.handleCsiParam(byte);
				break;
			case ParserState.CSI_INTERMEDIATE:
				this.handleCsiIntermediate(byte);
				break;
			case ParserState.CSI_IGNORE:
				this.handleCsiIgnore(byte);
				break;
			case ParserState.OSC_STRING:
				this.handleOscString(byte);
				break;
			case ParserState.DCS_ENTRY:
				this.handleDcsEntry(byte);
				break;
			case ParserState.DCS_PARAM:
				this.handleDcsParam(byte);
				break;
			case ParserState.DCS_INTERMEDIATE:
				this.handleDcsIntermediate(byte);
				break;
			case ParserState.DCS_PASSTHROUGH:
			case ParserState.DCS_IGNORE:
			case ParserState.SOS_PM_APC_STRING:
				this.handleStringConsume(byte);
				break;
			default:
				// Unsupported states - ignore
				break;
		}
	}

	/**
	 * Handle anywhere transitions (ESC, C0 controls)
	 * Returns true if handled
	 */
	private handleAnywhereTransitions(byte: number): boolean {
		// String-consuming states (OSC + DCS passthrough/ignore + SOS/PM/APC)
		// handle ESC (start of ST) and BEL locally rather than letting the
		// anywhere-transition logic execute/redirect them.
		const inStringState =
			this.state === ParserState.OSC_STRING ||
			this.state === ParserState.DCS_PASSTHROUGH ||
			this.state === ParserState.DCS_IGNORE ||
			this.state === ParserState.SOS_PM_APC_STRING;

		// ESC transitions to ESCAPE state, except in string states where ESC is
		// the first byte of a possible ST (ESC \) and is handled locally.
		if (byte === 0x1b && !inStringState) {
			this.transitionTo(ParserState.ESCAPE);
			return true;
		}

		// C0 controls (00-1F except ESC)
		// In string states, BEL (0x07) terminates and ESC (0x1B) begins ST, so
		// don't execute them - let the per-state handler deal with them.
		if (byte < 0x20 && !(inStringState && (byte === 0x07 || byte === 0x1b))) {
			this.actions.execute(byte);
			return true;
		}

		// C1 controls (80-9F) - but only if NOT in the middle of UTF-8 sequence
		// UTF-8 continuation bytes are 0x80-0xBF, which overlap with C1 controls
		// If we're expecting UTF-8 continuation bytes, don't treat them as C1 controls
		if (byte >= 0x80 && byte <= 0x9f && this.utf8Decoder.getExpected() === 0) {
			// CSI (9B) transitions to CSI_ENTRY
			if (byte === 0x9b) {
				this.transitionTo(ParserState.CSI_ENTRY);
				return true;
			}
			// OSC (9D) transitions to OSC_STRING
			if (byte === 0x9d) {
				this.transitionTo(ParserState.OSC_STRING);
				return true;
			}
			// Other C1 controls - execute
			this.actions.execute(byte);
			return true;
		}

		return false;
	}

	/**
	 * GROUND state: print printable characters
	 */
	private handleGround(byte: number): void {
		// Printable ASCII (20-7E)
		if (byte >= 0x20 && byte <= 0x7e) {
			this.actions.print(String.fromCharCode(byte), byte);
			return;
		}

		// UTF-8 multi-byte sequences (80-FF in ground state)
		if (byte >= 0x80) {
			const char = this.utf8Decoder.decode(byte);
			if (char) {
				this.actions.print(char, char.codePointAt(0) ?? byte);
			}
			return;
		}

		// DEL (7F) - ignore
		if (byte === 0x7f) {
			return;
		}
	}

	/**
	 * ESCAPE state: handle escape sequences
	 */
	private handleEscape(byte: number): void {
		// Intermediate bytes (20-2F)
		if (byte >= 0x20 && byte <= 0x2f) {
			this.intermediates.push(byte);
			this.transitionTo(ParserState.ESCAPE_INTERMEDIATE);
			return;
		}

		// Final bytes (30-7E)
		if (byte >= 0x30 && byte <= 0x7e) {
			// CSI ([)
			if (byte === 0x5b) {
				this.transitionTo(ParserState.CSI_ENTRY);
				return;
			}

			// OSC (])
			if (byte === 0x5d) {
				this.transitionTo(ParserState.OSC_STRING);
				return;
			}

			// DCS (P) - enter the DCS lifecycle so registered DCS handlers can
			// fire on the final byte. NOTE: payload assembly is not implemented;
			// see `dispatchDcs`.
			if (byte === 0x50) {
				this.transitionTo(ParserState.DCS_ENTRY);
				return;
			}

			// SOS (X), PM (^), APC (_) - not implemented, consume the string.
			if (byte === 0x58 || byte === 0x5e || byte === 0x5f) {
				this.transitionTo(ParserState.SOS_PM_APC_STRING);
				return;
			}

			// Other escape sequences
			this.dispatchEsc(byte);
			this.transitionTo(ParserState.GROUND);
			return;
		}

		// DEL (7F) - ignore
		if (byte === 0x7f) {
			return;
		}
	}

	/**
	 * ESCAPE_INTERMEDIATE state
	 */
	private handleEscapeIntermediate(byte: number): void {
		// Intermediate bytes (20-2F)
		if (byte >= 0x20 && byte <= 0x2f) {
			this.intermediates.push(byte);
			return;
		}

		// Final bytes (30-7E)
		if (byte >= 0x30 && byte <= 0x7e) {
			this.dispatchEsc(byte);
			this.transitionTo(ParserState.GROUND);
			return;
		}

		// DEL (7F) - ignore
		if (byte === 0x7f) {
			return;
		}
	}

	/**
	 * CSI_ENTRY state
	 */
	private handleCsiEntry(byte: number): void {
		// Parameter bytes (30-39, 3B) or collect (3C-3F)
		if ((byte >= 0x30 && byte <= 0x39) || byte === 0x3b) {
			this.handleCsiParam(byte);
			this.state = ParserState.CSI_PARAM;
			return;
		}

		if (byte >= 0x3c && byte <= 0x3f) {
			this.intermediates.push(byte);
			this.state = ParserState.CSI_PARAM;
			return;
		}

		// Intermediate bytes (20-2F)
		if (byte >= 0x20 && byte <= 0x2f) {
			this.intermediates.push(byte);
			this.transitionTo(ParserState.CSI_INTERMEDIATE);
			return;
		}

		// Colon (3A) - error, ignore
		if (byte === 0x3a) {
			this.transitionTo(ParserState.CSI_IGNORE);
			return;
		}

		// Final bytes (40-7E)
		if (byte >= 0x40 && byte <= 0x7e) {
			this.dispatchCsi(byte);
			this.transitionTo(ParserState.GROUND);
			return;
		}

		// DEL (7F) - ignore
		if (byte === 0x7f) {
			return;
		}
	}

	/**
	 * CSI_PARAM state
	 */
	private handleCsiParam(byte: number): void {
		// Parameter digits (30-39)
		if (byte >= 0x30 && byte <= 0x39) {
			const digit = byte - 0x30;
			const current = this.params[this.currentParam];
			if (!current) {
				this.params[this.currentParam] = [digit];
			} else if (current.length === 0) {
				current.push(digit);
			} else {
				current[0] = (current[0] ?? 0) * 10 + digit;
			}
			return;
		}

		// Semicolon (3B) - next parameter
		if (byte === 0x3b) {
			this.currentParam++;
			this.params[this.currentParam] = [];
			return;
		}

		// Colon or invalid parameter chars (3A, 3C-3F) - error, ignore
		if (byte === 0x3a || (byte >= 0x3c && byte <= 0x3f)) {
			this.transitionTo(ParserState.CSI_IGNORE);
			return;
		}

		// Intermediate bytes (20-2F)
		if (byte >= 0x20 && byte <= 0x2f) {
			this.intermediates.push(byte);
			this.transitionTo(ParserState.CSI_INTERMEDIATE);
			return;
		}

		// Final bytes (40-7E)
		if (byte >= 0x40 && byte <= 0x7e) {
			this.dispatchCsi(byte);
			this.transitionTo(ParserState.GROUND);
			return;
		}

		// DEL (7F) - ignore
		if (byte === 0x7f) {
			return;
		}
	}

	/**
	 * CSI_INTERMEDIATE state
	 */
	private handleCsiIntermediate(byte: number): void {
		// Intermediate bytes (20-2F)
		if (byte >= 0x20 && byte <= 0x2f) {
			this.intermediates.push(byte);
			return;
		}

		// Parameter bytes after intermediate - error, ignore
		if (byte >= 0x30 && byte <= 0x3f) {
			this.transitionTo(ParserState.CSI_IGNORE);
			return;
		}

		// Final bytes (40-7E)
		if (byte >= 0x40 && byte <= 0x7e) {
			this.dispatchCsi(byte);
			this.transitionTo(ParserState.GROUND);
			return;
		}

		// DEL (7F) - ignore
		if (byte === 0x7f) {
			return;
		}
	}

	/**
	 * CSI_IGNORE state (consume until final byte)
	 */
	private handleCsiIgnore(byte: number): void {
		// Final bytes (40-7E) - transition back to ground
		if (byte >= 0x40 && byte <= 0x7e) {
			this.transitionTo(ParserState.GROUND);
			return;
		}

		// Everything else - ignore
	}

	/**
	 * OSC_STRING state (accumulate until ST)
	 */
	private handleOscString(byte: number): void {
		// Check if we're expecting \ after ESC
		if (this.oscPendingEscape) {
			if (byte === 0x5c) {
				// ESC \ - ST terminator
				this.oscPendingEscape = false;
				this.dispatchOsc();
				this.transitionTo(ParserState.GROUND);
				return;
			}
			// Not ST, add ESC to data and continue
			this.oscPendingEscape = false;
			this.oscData += "\x1b";
			// Fall through to handle current byte
		}

		// BEL (07) terminates OSC
		if (byte === 0x07) {
			this.dispatchOsc();
			this.transitionTo(ParserState.GROUND);
			return;
		}

		// ST as C1 control (9C)
		if (byte === 0x9c) {
			this.dispatchOsc();
			this.transitionTo(ParserState.GROUND);
			return;
		}

		// ESC - might be start of ST (ESC \)
		if (byte === 0x1b) {
			this.oscPendingEscape = true;
			return;
		}

		// Accumulate printable characters
		if (byte >= 0x20 && byte <= 0x7e) {
			this.oscData += String.fromCharCode(byte);
			return;
		}

		// Ignore other control codes in OSC strings
	}

	/**
	 * Dispatch accumulated OSC string
	 */
	private dispatchOsc(): void {
		// Parse OSC id and data
		const semicolonIndex = this.oscData.indexOf(";");
		if (semicolonIndex === -1) {
			// No semicolon - just OSC id with no data
			const id = Number.parseInt(this.oscData, 10);
			if (!Number.isNaN(id)) {
				this.callOscHandlers(id, "");
			}
			return;
		}

		const idStr = this.oscData.substring(0, semicolonIndex);
		const data = this.oscData.substring(semicolonIndex + 1);
		const id = Number.parseInt(idStr, 10);

		if (!Number.isNaN(id)) {
			this.callOscHandlers(id, data);
		}
	}

	/**
	 * Call registered OSC handlers
	 */
	private callOscHandlers(id: number, data: string): void {
		const handlers = this.oscHandlers.get(id);
		if (handlers) {
			for (const handler of handlers) {
				const stopPropagation = handler(data);
				if (stopPropagation === true) {
					break;
				}
			}
		}

		// Always call the actions.oscDispatch for internal handling
		this.actions.oscDispatch(id, data);
	}

	/**
	 * Dispatch a CSI sequence. Runs consumer-registered CSI handlers (xterm
	 * `registerCsiHandler` semantics: reverse order, `true` consumes); if none
	 * consume it, falls through to sterk's built-in default processing via
	 * `actions.csiDispatch`.
	 */
	private dispatchCsi(final: number): void {
		const { prefix, intermediates } = splitPrefix(this.intermediates);
		const handlers = this.csiHandlers.get(
			handlerKey(prefix, intermediates, final),
		);
		if (handlers && handlers.length > 0) {
			const publicParams = toPublicParams(this.params);
			const consumed = this.runHandlers(handlers, (h) => h(publicParams));
			if (consumed) {
				return;
			}
		}
		this.actions.csiDispatch(this.params, this.intermediates, final);
	}

	/**
	 * Dispatch an ESC sequence. Runs consumer-registered ESC handlers; if none
	 * consume it, falls through to `actions.escDispatch`.
	 */
	private dispatchEsc(final: number): void {
		// ESC sequences have no private-marker prefix; intermediates are the
		// 0x20-0x2f bytes only.
		const handlers = this.escHandlers.get(
			handlerKey(0, this.intermediates, final),
		);
		if (handlers && handlers.length > 0) {
			const consumed = this.runHandlers(handlers, (h) => h());
			if (consumed) {
				return;
			}
		}
		this.actions.escDispatch(this.intermediates, final);
	}

	/**
	 * Dispatch a DCS sequence on its final byte.
	 *
	 * LIMITATION: the DCS payload (the bytes between the final byte and ST) is
	 * NOT assembled — handlers receive an empty `data` string. Returns `true`
	 * if a handler consumed the sequence. See `Parser.registerDcsHandler`.
	 */
	private dispatchDcs(final: number): boolean {
		const { prefix, intermediates } = splitPrefix(this.intermediates);
		const handlers = this.dcsHandlers.get(
			handlerKey(prefix, intermediates, final),
		);
		if (!handlers || handlers.length === 0) {
			return false;
		}
		const publicParams = toPublicParams(this.params);
		return this.runHandlers(handlers, (h) => h("", publicParams));
	}

	/**
	 * DCS_ENTRY state. Mirrors CSI_ENTRY but for DCS.
	 */
	private handleDcsEntry(byte: number): void {
		// Parameter bytes (30-39, 3B)
		if ((byte >= 0x30 && byte <= 0x39) || byte === 0x3b) {
			this.handleDcsParam(byte);
			this.state = ParserState.DCS_PARAM;
			return;
		}
		// Private-marker prefix (3C-3F)
		if (byte >= 0x3c && byte <= 0x3f) {
			this.intermediates.push(byte);
			this.state = ParserState.DCS_PARAM;
			return;
		}
		// Intermediate bytes (20-2F)
		if (byte >= 0x20 && byte <= 0x2f) {
			this.intermediates.push(byte);
			this.state = ParserState.DCS_INTERMEDIATE;
			return;
		}
		// Colon (3A) - error
		if (byte === 0x3a) {
			this.state = ParserState.DCS_IGNORE;
			return;
		}
		// Final byte (40-7E) - dispatch then passthrough until ST
		if (byte >= 0x40 && byte <= 0x7e) {
			this.dispatchDcs(byte);
			this.state = ParserState.DCS_PASSTHROUGH;
			return;
		}
	}

	/**
	 * DCS_PARAM state.
	 */
	private handleDcsParam(byte: number): void {
		// Parameter digits (30-39)
		if (byte >= 0x30 && byte <= 0x39) {
			const digit = byte - 0x30;
			const current = this.params[this.currentParam];
			if (!current) {
				this.params[this.currentParam] = [digit];
			} else if (current.length === 0) {
				current.push(digit);
			} else {
				current[0] = (current[0] ?? 0) * 10 + digit;
			}
			return;
		}
		// Semicolon (3B) - next parameter
		if (byte === 0x3b) {
			this.currentParam++;
			this.params[this.currentParam] = [];
			return;
		}
		// Colon or invalid (3A, 3C-3F) - error
		if (byte === 0x3a || (byte >= 0x3c && byte <= 0x3f)) {
			this.state = ParserState.DCS_IGNORE;
			return;
		}
		// Intermediate bytes (20-2F)
		if (byte >= 0x20 && byte <= 0x2f) {
			this.intermediates.push(byte);
			this.state = ParserState.DCS_INTERMEDIATE;
			return;
		}
		// Final byte (40-7E)
		if (byte >= 0x40 && byte <= 0x7e) {
			this.dispatchDcs(byte);
			this.state = ParserState.DCS_PASSTHROUGH;
			return;
		}
	}

	/**
	 * DCS_INTERMEDIATE state.
	 */
	private handleDcsIntermediate(byte: number): void {
		// Intermediate bytes (20-2F)
		if (byte >= 0x20 && byte <= 0x2f) {
			this.intermediates.push(byte);
			return;
		}
		// Param bytes after intermediate - error
		if (byte >= 0x30 && byte <= 0x3f) {
			this.state = ParserState.DCS_IGNORE;
			return;
		}
		// Final byte (40-7E)
		if (byte >= 0x40 && byte <= 0x7e) {
			this.dispatchDcs(byte);
			this.state = ParserState.DCS_PASSTHROUGH;
			return;
		}
	}

	/**
	 * Consume a control string (DCS payload, DCS_IGNORE, or SOS/PM/APC) until
	 * its ST terminator. The payload is discarded — sterk does not assemble
	 * DCS data yet (see `dispatchDcs`).
	 */
	private handleStringConsume(byte: number): void {
		// Pending ESC: check for the `\` that completes ST (ESC \).
		if (this.stringPendingEscape) {
			this.stringPendingEscape = false;
			// Either way the string ends here; ESC begins a new sequence so we
			// return to GROUND and let the next byte be processed fresh on the
			// following call.
			this.transitionTo(ParserState.GROUND);
			if (byte !== 0x5c) {
				// Not ST — re-process this byte from GROUND.
				this.processByte(byte);
			}
			return;
		}
		// BEL (07) terminates.
		if (byte === 0x07) {
			this.transitionTo(ParserState.GROUND);
			return;
		}
		// ST as C1 control (9C) terminates.
		if (byte === 0x9c) {
			this.transitionTo(ParserState.GROUND);
			return;
		}
		// ESC - possible start of ST (ESC \).
		if (byte === 0x1b) {
			this.stringPendingEscape = true;
			return;
		}
		// Everything else is payload - discarded.
	}

	/**
	 * Reset the parser to its power-on (GROUND) state.
	 *
	 * Clears any half-parsed escape/CSI/OSC sequence (intermediates,
	 * params, OSC buffer), drops the UTF-8 decoder's pending bytes, and
	 * restores the current SGR attributes to the defaults. Registered OSC
	 * handlers are intentionally preserved — they are consumer-owned
	 * subscriptions, not parser state, and a RIS should not silently
	 * unwire shell-integration handlers. Used by `Terminal.reset()`.
	 */
	reset(): void {
		this.state = ParserState.GROUND;
		this.intermediates = [];
		this.params = [[]];
		this.currentParam = 0;
		this.oscData = "";
		this.oscPendingEscape = false;
		this.stringPendingEscape = false;
		this.utf8Decoder = new Utf8Decoder();
		this.currentAttrs = { ...DEFAULT_CELL_ATTRIBUTES };
	}

	/**
	 * Transition to a new state
	 */
	private transitionTo(newState: ParserState): void {
		// Clear on entry to certain states
		if (
			newState === ParserState.ESCAPE ||
			newState === ParserState.CSI_ENTRY ||
			newState === ParserState.OSC_STRING ||
			newState === ParserState.DCS_ENTRY
		) {
			this.actions.clear();
			this.intermediates = [];
			this.params = [[]];
			this.currentParam = 0;
			this.oscData = "";
			this.oscPendingEscape = false;
			this.stringPendingEscape = false;
		}

		this.state = newState;
	}
}
