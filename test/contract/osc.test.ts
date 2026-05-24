/**
 * Contract tests — OSC (Operating System Commands)
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21
 * Gap-matrix rows covered: 22, 23, 24, 25
 *
 * One test per gap-matrix row. Parity / Improved rows assert real
 * behavior and must pass. Missing rows are listed as `it.todo()` so
 * the future Phase A/B/C PR that fills them flips todo → it.
 *
 * Per-row breakdown (this file):
 * - Row 22 (M): OSC 0/1/2 (window title) auto-handled. Aceterm set
 *               `term.title` automatically; sterk only fires if the
 *               consumer registers a handler.
 * - Row 23 (P): OSC 8 hyperlinks. Neither aceterm nor sterk implement it
 *               today — parity at "not implemented". The contract is that
 *               an unhandled OSC 8 doesn't throw.
 * - Row 24 (+): OSC 133 first-class via `parser.registerOscHandler(133)`.
 * - Row 25 (P): OSC 4 / 52 / 104 palette/selection. Both equivalent (stubs).
 */

import { describe, expect, it, vi } from "vitest";
import { createTerminal } from "../../src/index.js";

describe("contract: OSC", () => {
	// ── Row 23 (P) — OSC 8 hyperlinks: parity at "no-op, no throw" ───
	describe("row 23 [P] OSC 8 hyperlinks (parity: not implemented, must not throw)", () => {
		it("ignoring an OSC 8 sequence without a registered handler is a no-op", () => {
			const term = createTerminal({ cols: 80, rows: 24 });
			expect(() =>
				term.write("\x1b]8;;https://example.com\x07link\x1b]8;;\x07"),
			).not.toThrow();
			term.dispose();
		});
	});

	// ── Row 24 (+) — OSC 133 first-class handler API ─────────────────
	describe("row 24 [+] OSC 133 first-class via parser.registerOscHandler(133)", () => {
		it("invokes a registered OSC 133 handler with the payload (no monkey-patch needed)", () => {
			const term = createTerminal({ cols: 80, rows: 24 });
			const handler = vi.fn();
			term.parser.registerOscHandler(133, handler);
			term.write("\x1b]133;A\x07");
			expect(handler).toHaveBeenCalledWith("A");
			term.dispose();
		});

		it("supports the full A/B/C/D prompt-state alphabet", () => {
			const term = createTerminal({ cols: 80, rows: 24 });
			const handler = vi.fn();
			term.parser.registerOscHandler(133, handler);
			term.write("\x1b]133;A\x07");
			term.write("\x1b]133;B\x07");
			term.write("\x1b]133;C\x07");
			term.write("\x1b]133;D;0\x07");
			expect(handler).toHaveBeenCalledTimes(4);
			expect(handler).toHaveBeenNthCalledWith(1, "A");
			expect(handler).toHaveBeenNthCalledWith(4, "D;0");
			term.dispose();
		});

		it("chains multiple handlers with propagation control (return true stops)", () => {
			const term = createTerminal({ cols: 80, rows: 24 });
			const first = vi.fn(() => true);
			const second = vi.fn();
			term.parser.registerOscHandler(133, first);
			term.parser.registerOscHandler(133, second);
			term.write("\x1b]133;A\x07");
			expect(first).toHaveBeenCalledTimes(1);
			expect(second).not.toHaveBeenCalled();
			term.dispose();
		});
	});

	// ── Row 25 (P) — OSC 4 / 52 / 104 (palette / selection / reset) ─
	describe("row 25 [P] OSC 4 / 52 / 104 — both implementations are stubs", () => {
		it("OSC 4 (color set) without a handler does not throw", () => {
			const term = createTerminal({ cols: 80, rows: 24 });
			expect(() => term.write("\x1b]4;1;rgb:cc/00/00\x07")).not.toThrow();
			term.dispose();
		});

		it("OSC 52 (clipboard) without a handler does not throw", () => {
			const term = createTerminal({ cols: 80, rows: 24 });
			expect(() => term.write("\x1b]52;c;aGVsbG8=\x07")).not.toThrow();
			term.dispose();
		});
	});

	// ── Row 22 (M) — OSC 0/1/2 auto title ────────────────────────────
	it.todo(
		"row 22 [M] OSC 0/1/2 auto-sets `term.title` so consumers don't have to register a handler manually (aceterm libterm.js:680-685; sterk: handleOscDispatch is a stub — tmux pane titles broken unless consumer wires it)",
	);
});
