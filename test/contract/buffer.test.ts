/**
 * Contract tests — Buffer & Scrollback
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21
 * Gap-matrix rows covered: 29, 30, 31, 34
 *
 * One test per gap-matrix row. Parity / Improved rows assert real
 * behavior and must pass. Missing rows are listed as `it.todo()` so
 * the future Phase A/B/C PR that fills them flips todo → it.
 *
 * Per-row breakdown (this file):
 * - Row 29 (M): `discardOldScrollback` event when oldest line evicted.
 * - Row 30 (M): viewport pin to live screen as buffer grows past rows
 *               (PR #13 in flight).
 * - Row 31 (M): wcwidth for CJK / emoji / combining marks.
 * - Row 34 (+): debuggable `{chars, code, attrs}` cell encoding.
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";

describe("contract: buffer & scrollback", () => {
	// ── Row 34 (+) — Cell encoding: object-shaped, debuggable ────────
	describe("row 34 [+] cell encoding: BufferCell exposes `chars`, `code`, attrs", () => {
		it("BufferCell.getChars / getCode return character + codepoint", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			term.write("A");
			const cell = term.buffer.active.getLine(0)?.getCell(0);
			expect(cell?.getChars()).toBe("A");
			expect(cell?.getCode()).toBe("A".charCodeAt(0));
			term.dispose();
		});

		it("BufferCell exposes typed predicates for fg/bg/attrs (no bit-fiddling)", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			term.write("\x1b[1;31;42mX");
			const cell = term.buffer.active.getLine(0)?.getCell(0);
			// All predicates are method calls — no `attrInt >> 9 & 0x1ff` math.
			expect(typeof cell?.isBold).toBe("function");
			expect(typeof cell?.isFgPalette).toBe("function");
			expect(typeof cell?.getBgColor).toBe("function");
			expect(cell?.isBold()).toBe(true);
			expect(cell?.getFgColor()).toBe(1);
			expect(cell?.getBgColor()).toBe(2);
			term.dispose();
		});
	});

	// ── Row 29 (M) — Scrollback eviction event ───────────────────────
	it.todo(
		"row 29 [M] emits a `discardOldScrollback` event when oldest line evicted (aceterm libterm.js:302; sterk: no event today)",
	);

	// ── Row 30 (M) — Viewport pin to live screen ─────────────────────
	it.todo(
		"row 30 [M] pins viewport to the live screen when buffer grows past `rows` (PR #13 in flight; biting today on Pixel 7)",
	);

	// ── Row 31 (M) — wcwidth (CJK / emoji / combining marks) ─────────
	it.todo(
		'row 31 [M] wcwidth: writing "🚀A" advances the cursor by 3 columns, not 2 (aceterm wc.js port; sterk treats every cell as 1 col)',
	);
});
