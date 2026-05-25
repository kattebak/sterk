/**
 * Parser handler-registration parity with xterm.js `IParser`.
 *
 * Tracking: https://github.com/kattebak/sterk/issues/36
 *
 * Covers the additive, non-breaking handler API:
 * - registerCsiHandler / registerEscHandler / registerDcsHandler
 * - xterm fall-through semantics (returning false defers to default processing)
 * - Disposable stops delivery
 * - async (Promise) returns are accepted without blocking the parser
 * - existing OSC 133 path is unaffected
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../src/index.js";

describe("Parser handler registration (xterm IParser parity)", () => {
	let term: ReturnType<typeof createTerminal>;

	beforeEach(() => {
		term = createTerminal({ cols: 80, rows: 24 });
	});

	// ── registerCsiHandler ──────────────────────────────────────────────

	describe("registerCsiHandler", () => {
		it("returns a Disposable", () => {
			const d = term.parser.registerCsiHandler({ final: "m" }, () => true);
			expect(d).toBeDefined();
			expect(d.dispose).toBeTypeOf("function");
			d.dispose();
			term.dispose();
		});

		it("fires on the matching final byte with parsed params", () => {
			const handler = vi.fn(() => true);
			term.parser.registerCsiHandler({ final: "m" }, handler);

			// CSI 1 ; 31 m
			term.write("\x1b[1;31m");

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith([1, 31]);
			term.dispose();
		});

		it("delivers a missing/default param as 0", () => {
			const handler = vi.fn(() => true);
			term.parser.registerCsiHandler({ final: "m" }, handler);

			term.write("\x1b[m");

			expect(handler).toHaveBeenCalledWith([0]);
			term.dispose();
		});

		it("returning false falls through to default processing", () => {
			// SGR bold (CSI 1 m) still applies when the handler defers.
			const handler = vi.fn(() => false);
			term.parser.registerCsiHandler({ final: "m" }, handler);

			term.write("\x1b[1mA");

			expect(handler).toHaveBeenCalledTimes(1);
			expect(term.buffer.active.getLine(0)?.getCell(0).isBold()).toBe(true);
			term.dispose();
		});

		it("returning true suppresses default processing", () => {
			const handler = vi.fn(() => true);
			term.parser.registerCsiHandler({ final: "m" }, handler);

			term.write("\x1b[1mA");

			// Handler consumed the SGR, so bold was never applied.
			expect(term.buffer.active.getLine(0)?.getCell(0).isBold()).toBe(false);
			term.dispose();
		});

		it("matches on a private-marker prefix", () => {
			const handler = vi.fn(() => true);
			term.parser.registerCsiHandler({ prefix: "?", final: "h" }, handler);

			// CSI ? 1049 h (alt screen enable) — carries the '?' prefix
			term.write("\x1b[?1049h");

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith([1049]);
			term.dispose();
		});

		it("does not fire a prefixed handler for the un-prefixed sequence", () => {
			const handler = vi.fn(() => true);
			term.parser.registerCsiHandler({ prefix: "?", final: "h" }, handler);

			term.write("\x1b[4h"); // no '?' prefix

			expect(handler).not.toHaveBeenCalled();
			term.dispose();
		});

		it("invokes multiple handlers in reverse registration order until one consumes", () => {
			const order: string[] = [];
			term.parser.registerCsiHandler({ final: "m" }, () => {
				order.push("first");
				return false;
			});
			term.parser.registerCsiHandler({ final: "m" }, () => {
				order.push("second");
				return true; // consumes, so "first" never runs
			});

			term.write("\x1b[m");

			expect(order).toEqual(["second"]);
			term.dispose();
		});

		it("Disposable stops delivery", () => {
			const handler = vi.fn(() => true);
			const d = term.parser.registerCsiHandler({ final: "m" }, handler);

			term.write("\x1b[m");
			expect(handler).toHaveBeenCalledTimes(1);

			d.dispose();
			term.write("\x1b[m");
			expect(handler).toHaveBeenCalledTimes(1); // not called again
			term.dispose();
		});

		it("accepts an async (Promise) return without blocking; treated as fall-through", () => {
			// Async handler resolves true, but the parser is synchronous so the
			// current dispatch falls through to default processing.
			const handler = vi.fn(async () => true);
			term.parser.registerCsiHandler({ final: "m" }, handler);

			term.write("\x1b[1mA");

			expect(handler).toHaveBeenCalledTimes(1);
			// Default SGR still applied this dispatch (promise not awaited inline).
			expect(term.buffer.active.getLine(0)?.getCell(0).isBold()).toBe(true);
			term.dispose();
		});
	});

	// ── registerEscHandler ──────────────────────────────────────────────

	describe("registerEscHandler", () => {
		it("fires on the matching final byte", () => {
			const handler = vi.fn(() => true);
			// ESC 7 (DECSC, save cursor)
			term.parser.registerEscHandler({ final: "7" }, handler);

			term.write("\x1b7");

			expect(handler).toHaveBeenCalledTimes(1);
			term.dispose();
		});

		it("fires on an ESC sequence with an intermediate byte", () => {
			const handler = vi.fn(() => true);
			// ESC ( B  — designate ASCII into G0
			term.parser.registerEscHandler(
				{ intermediates: "(", final: "B" },
				handler,
			);

			term.write("\x1b(B");

			expect(handler).toHaveBeenCalledTimes(1);
			term.dispose();
		});

		it("returning false falls through to default processing (DECSC saves cursor)", () => {
			const handler = vi.fn(() => false);
			term.parser.registerEscHandler({ final: "7" }, handler);

			// Move cursor, save (ESC 7), move again, restore (ESC 8).
			term.write("\x1b[5;10H"); // row 5, col 10
			term.write("\x1b7"); // save — handler defers, default save runs
			term.write("\x1b[1;1H"); // move to home
			term.write("\x1b8"); // restore

			expect(handler).toHaveBeenCalledTimes(1);
			// Cursor restored to the saved position (col 9, 0-based).
			expect(term.buffer.active.cursorX).toBe(9);
			term.dispose();
		});

		it("Disposable stops delivery", () => {
			const handler = vi.fn(() => true);
			const d = term.parser.registerEscHandler({ final: "7" }, handler);

			term.write("\x1b7");
			expect(handler).toHaveBeenCalledTimes(1);

			d.dispose();
			term.write("\x1b7");
			expect(handler).toHaveBeenCalledTimes(1);
			term.dispose();
		});
	});

	// ── registerDcsHandler ──────────────────────────────────────────────

	describe("registerDcsHandler", () => {
		it("fires on the DCS final byte with parsed params", () => {
			const handler = vi.fn(() => true);
			// DCS 1 ; 2 | data ST
			term.parser.registerDcsHandler({ final: "|" }, handler);

			term.write("\x1bP1;2|payload\x1b\\");

			expect(handler).toHaveBeenCalledTimes(1);
			// Payload assembly is not implemented yet — data is empty.
			expect(handler).toHaveBeenCalledWith("", [1, 2]);
			term.dispose();
		});

		it("does not break out of the DCS string — following text prints normally", () => {
			term.parser.registerDcsHandler({ final: "|" }, () => true);

			// DCS payload (discarded) terminated by ST, then real text.
			term.write("\x1bP|abc\x1b\\hello");

			const line = term.buffer.active.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("h");
			expect(line?.getCell(4).getChars()).toBe("o");
			term.dispose();
		});

		it("Disposable stops delivery", () => {
			const handler = vi.fn(() => true);
			const d = term.parser.registerDcsHandler({ final: "|" }, handler);

			term.write("\x1bP|x\x1b\\");
			expect(handler).toHaveBeenCalledTimes(1);

			d.dispose();
			term.write("\x1bP|x\x1b\\");
			expect(handler).toHaveBeenCalledTimes(1);
			term.dispose();
		});
	});

	// ── Existing OSC 133 path unaffected ────────────────────────────────

	describe("existing OSC 133 path is unaffected", () => {
		it("still delivers OSC 133 to its registered handler", () => {
			const handler = vi.fn();
			term.parser.registerOscHandler(133, handler);

			term.write("\x1b]133;A\x07");

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith("A");
			term.dispose();
		});

		it("OSC and CSI handlers coexist without interfering", () => {
			const osc = vi.fn();
			const csi = vi.fn(() => true);
			term.parser.registerOscHandler(133, osc);
			term.parser.registerCsiHandler({ final: "m" }, csi);

			term.write("\x1b]133;B\x07\x1b[m");

			expect(osc).toHaveBeenCalledWith("B");
			expect(csi).toHaveBeenCalledTimes(1);
			term.dispose();
		});
	});
});
