/**
 * Contract tests — ED / EL default parameters
 *
 * Per ECMA-48 §8.3.39 (ED — Erase in Display) and §8.3.41 (EL — Erase
 * in Line) the default selective-erase parameter is **0** (erase from
 * cursor to end of display/line). Sterk pre-fix used a shared
 * fallback of `1` for all CSI parameters because that's the right
 * default for cursor-movement commands (CUU/CUD/CUF/CUB/CUP/HVP).
 * Routing `\x1b[J` and `\x1b[K` with that wrong default meant the
 * textbook "clear from cursor onward" sequence ended up erasing
 * everything BEFORE the cursor instead of after.
 *
 * Regression context: the mobux Pixel-7 "status bar duplicates" had
 * two compounding bugs:
 *   1. CUP/HVP treated `p1 - 1` as an absolute buffer row (covered
 *      by test/contract/cursor_position.test.ts).
 *   2. `\x1b[K` (EL with no parameter) routed as EL-mode-1 (erase
 *      LEFT of cursor) instead of EL-mode-0 (erase RIGHT). A status-
 *      bar redraw that emitted "move + write + EL" left stale chars
 *      at the right end of the row, painting fragments of the
 *      previous status next to the new one.
 *
 * What this test pins:
 *   - `\x1b[K`  ≡  `\x1b[0K`  (erase from cursor to end of line)
 *   - `\x1b[1K` still erases to the left of cursor
 *   - `\x1b[2K` still erases the entire line
 *   - `\x1b[J`  ≡  `\x1b[0J`  (erase from cursor to end of display)
 *   - The audit's `AAAA\rCC` repro renders correctly (CR-overwrite
 *     semantics: VT spec — CR doesn't erase; subsequent writes
 *     overwrite cells one-by-one).
 *   - A status-bar-style "move + write + EL-to-end" produces a clean
 *     row with no stale chars from the previous render.
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";

type AnyTerm = ReturnType<typeof createTerminal>;

function row(term: AnyTerm, y: number): string {
	return term.buffer.active.getLine(y)?.translateToString(false) ?? "";
}

describe("contract: CR overwrites cell-by-cell, EL/ED defaults match ECMA-48", () => {
	it("write 'AAAAAAAA', CR, write 'CC' → 'CCAAAAAA  ' (CR does not erase per VT spec)", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		term.write("AAAAAAAA");
		term.write("\r");
		term.write("CC");
		expect(row(term, 0)).toBe("CCAAAAAA  ");
		term.dispose();
	});

	it("'\\x1b[K' is EL mode 0: erase from cursor to end of line", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		term.write("AAAAAAAA");
		term.write("\r");
		term.write("CC");
		term.write("\x1b[K"); // No param — must default to 0
		expect(row(term, 0)).toBe("CC        ");
		term.dispose();
	});

	it("'\\x1b[0K' (explicit 0) matches '\\x1b[K' — erase to end of line", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		term.write("XYZXYZXY"); // 8 chars, cursor at col 8 row 0
		term.write("\r"); // cursor (0, 0)
		term.write("AB"); // overwrite cols 0,1 — cursor (2, 0)
		term.write("\x1b[0K");
		expect(row(term, 0)).toBe("AB        ");
		term.dispose();
	});

	it("'\\x1b[1K' (erase to left of cursor, inclusive) still works", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		term.write("XYZXYZXY"); // cursor at col 8 row 0
		term.write("\r"); // cursor (0, 0)
		term.write("AB"); // overwrite cols 0,1 — cursor (2, 0), line: "ABZXYZXY  "
		term.write("\x1b[1K"); // erase cols 0..2 inclusive
		// Cols 0..2 blank, cols 3..7 unchanged (XYZXY), cols 8..9 blanks.
		expect(row(term, 0)).toBe("   XYZXY  ");
		term.dispose();
	});

	it("'\\x1b[2K' (erase entire line) still works", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		term.write("XYZXYZXY");
		term.write("\x1b[2K");
		expect(row(term, 0)).toBe("          ");
		term.dispose();
	});

	it("'\\x1b[J' is ED mode 0: erase from cursor to end of display", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		term.write("AAAAAAAAAA"); // row 0 full, cursor wraps to (0,1)
		term.write("BBBBBBBBBB"); // row 1 full, cursor wraps to (0,2)
		term.write("CCCCC"); // row 2 partial, cursor at (5,2)
		// ED mode 0 should erase from cursor onward: row 2 cols 5..9.
		// Rows 0 and 1 stay intact (they're above cursor).
		term.write("\x1b[J"); // No param — must default to 0
		expect(row(term, 0)).toBe("AAAAAAAAAA");
		expect(row(term, 1)).toBe("BBBBBBBBBB");
		expect(row(term, 2)).toBe("CCCCC     ");
		term.dispose();
	});

	it("status-bar redraw produces a clean row (CUP + write + '\\x1b[K')", () => {
		// Reconstruct a realistic tmux/zsh status redraw: long previous
		// status, then a fresh shorter one with EL-to-end.
		const cols = 30;
		const term = createTerminal({ cols, rows: 3 });
		const longStatus = "[mobux] long-status-22:48 ABC"; // 29 chars
		const shortStatus = "[mobux] short"; // 13 chars
		const pad = (s: string) => s + " ".repeat(cols - s.length);

		// Write long status on row 1 (1-based; absolute row 0).
		term.write(`\x1b[1;1H${longStatus}`);
		expect(row(term, 0)).toBe(pad(longStatus));

		// Next redraw: move to row 1 col 1, write shorter, EL to clear tail.
		term.write(`\x1b[1;1H${shortStatus}\x1b[K`);
		expect(row(term, 0)).toBe(pad(shortStatus));

		term.dispose();
	});
});
