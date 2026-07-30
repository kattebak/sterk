/**
 * Contract tests — Parser (VT500 DEC state machine + SGR)
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21
 * Gap-matrix rows covered: 19
 *
 * One test per gap-matrix row. Parity / Improved rows assert real
 * behavior and must pass. Missing rows are listed as `it.todo()` so
 * the future Phase A/B/C PR that fills them flips todo → it.
 *
 * Per-row breakdown (this file):
 * - Row 19 (+): SGR — ANSI 0-15, palette 256, truecolor RGB,
 *               bold/italic/underline/dim/inverse. Sterk has the full set;
 *               aceterm had palette-only with bold/underline/inverse.
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";

describe("contract: parser", () => {
	// ── Row 19 (+) — SGR full set (improved over aceterm) ────────────
	describe("row 19 [+] SGR: full set (truecolor + italic + dim beyond aceterm)", () => {
		it("parses ANSI 30-37 palette foreground", () => {
			const term = createTerminal({ cols: 20, rows: 2 });
			term.write("\x1b[31mR\x1b[32mG\x1b[34mB");
			const line = term.buffer.active.getLine(0);
			expect(line?.getCell(0).isFgPalette()).toBe(1);
			expect(line?.getCell(0).getFgColor()).toBe(1); // red
			expect(line?.getCell(1).getFgColor()).toBe(2); // green
			expect(line?.getCell(2).getFgColor()).toBe(4); // blue
			term.dispose();
		});

		it("parses bright palette 90-97 (indices 8-15)", () => {
			const term = createTerminal({ cols: 20, rows: 2 });
			term.write("\x1b[91mX");
			const cell = term.buffer.active.getLine(0)?.getCell(0);
			expect(cell?.isFgPalette()).toBe(1);
			expect(cell?.getFgColor()).toBe(9); // bright red
			term.dispose();
		});

		it("parses 256-palette `\\x1b[38;5;n`", () => {
			const term = createTerminal({ cols: 20, rows: 2 });
			term.write("\x1b[38;5;202mO");
			const cell = term.buffer.active.getLine(0)?.getCell(0);
			expect(cell?.isFgPalette()).toBe(1);
			expect(cell?.getFgColor()).toBe(202);
			term.dispose();
		});

		it("parses truecolor `\\x1b[38;2;r;g;b` — beyond aceterm", () => {
			const term = createTerminal({ cols: 20, rows: 2 });
			term.write("\x1b[38;2;255;128;0mO");
			const cell = term.buffer.active.getLine(0)?.getCell(0);
			expect(cell?.isFgRGB()).toBe(1);
			expect(cell?.getFgColor()).toBe(0xff8000);
			term.dispose();
		});

		it("parses italic (SGR 3) — beyond aceterm", () => {
			const term = createTerminal({ cols: 20, rows: 2 });
			term.write("\x1b[3mI");
			expect(term.buffer.active.getLine(0)?.getCell(0).isItalic()).toBe(1);
			term.dispose();
		});

		it("parses dim (SGR 2) — beyond aceterm", () => {
			const term = createTerminal({ cols: 20, rows: 2 });
			term.write("\x1b[2mD");
			expect(term.buffer.active.getLine(0)?.getCell(0).isDim()).toBe(1);
			term.dispose();
		});

		it("parses bold + underline + inverse (parity with aceterm)", () => {
			const term = createTerminal({ cols: 20, rows: 2 });
			term.write("\x1b[1;4;7mX");
			const cell = term.buffer.active.getLine(0)?.getCell(0);
			expect(cell?.isBold()).toBe(1);
			expect(cell?.isUnderline()).toBe(1);
			expect(cell?.isInverse()).toBe(1);
			term.dispose();
		});

		it("resets all attrs with SGR 0", () => {
			const term = createTerminal({ cols: 20, rows: 2 });
			term.write("\x1b[1;31mA\x1b[0mB");
			const after = term.buffer.active.getLine(0)?.getCell(1);
			expect(after?.isBold()).toBe(0);
			expect(after?.isFgDefault()).toBe(1);
			term.dispose();
		});
	});
});
