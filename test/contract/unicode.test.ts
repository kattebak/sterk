/**
 * Contract tests — Unicode width (wcwidth) + combining marks
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21
 * Gap-matrix row covered: Row 33 in the task brief (= gap-matrix Row 31
 * "wcwidth for CJK / emoji / combining marks").
 * Mobux postmortem reference: https://github.com/mvhenten/mobux/issues/81
 *
 * Aceterm port reference: `web/static/vendor/aceterm/wc.js` (414 lines,
 * Markus Kuhn). Sterk's clean-room counterpart: `src/util/wcwidth.ts`.
 *
 * This file is the per-row contract test for the unicode parity gap.
 * Each block locks one observable behaviour the buffer/parser must keep
 * once wide-char + combining-mark support is wired in.
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";
import { wcswidth, wcwidth } from "../../src/util/wcwidth.js";

describe("contract: wcwidth (Row 33 — unicode parity)", () => {
	// ── wcwidth() table accuracy ─────────────────────────────────────
	describe("wcwidth() per-codepoint widths", () => {
		it("ASCII printable code points are width 1", () => {
			expect(wcwidth(0x20)).toBe(1); // space
			expect(wcwidth(0x41)).toBe(1); // 'A'
			expect(wcwidth(0x7e)).toBe(1); // '~'
		});

		it("C0/C1 control codes are unprintable (-1)", () => {
			expect(wcwidth(0x00)).toBe(-1); // NUL
			expect(wcwidth(0x07)).toBe(-1); // BEL
			expect(wcwidth(0x1b)).toBe(-1); // ESC
			expect(wcwidth(0x7f)).toBe(-1); // DEL
			expect(wcwidth(0x9b)).toBe(-1); // CSI
		});

		it("CJK Unified Ideographs are width 2", () => {
			expect(wcwidth(0x4e2d)).toBe(2); // 中 (Middle)
			expect(wcwidth(0x6587)).toBe(2); // 文 (Text)
			expect(wcwidth(0x4e00)).toBe(2); // 一 (One)
		});

		it("Hangul syllables are width 2", () => {
			expect(wcwidth(0xac00)).toBe(2); // 가
			expect(wcwidth(0xd55c)).toBe(2); // 한
		});

		it("Hiragana / Katakana are width 2", () => {
			expect(wcwidth(0x3042)).toBe(2); // あ
			expect(wcwidth(0x30c6)).toBe(2); // テ
		});

		it("Fullwidth punctuation is width 2", () => {
			expect(wcwidth(0xff01)).toBe(2); // ！
			expect(wcwidth(0xff1f)).toBe(2); // ？
			expect(wcwidth(0x300c)).toBe(2); // 「
		});

		it("Modern emoji (Unicode 9+) are width 2", () => {
			expect(wcwidth(0x1f600)).toBe(2); // 😀 grinning face
			expect(wcwidth(0x1f680)).toBe(2); // 🚀 rocket
			expect(wcwidth(0x1f389)).toBe(2); // 🎉 party popper
		});

		it("Combining marks are width 0", () => {
			expect(wcwidth(0x0301)).toBe(0); // COMBINING ACUTE ACCENT
			expect(wcwidth(0x0303)).toBe(0); // COMBINING TILDE
			expect(wcwidth(0x094d)).toBe(0); // DEVANAGARI SIGN VIRAMA
			expect(wcwidth(0x0e31)).toBe(0); // THAI CHARACTER MAI HAN-AKAT
		});

		it("ZWJ and variation selectors are width 0", () => {
			expect(wcwidth(0x200d)).toBe(0); // ZERO WIDTH JOINER
			expect(wcwidth(0x200c)).toBe(0); // ZERO WIDTH NON-JOINER
			expect(wcwidth(0xfe0f)).toBe(0); // VARIATION SELECTOR-16 (emoji presentation)
			expect(wcwidth(0xfe00)).toBe(0); // VARIATION SELECTOR-1
		});

		it("Box-drawing characters are width 1 (not width 2)", () => {
			// These are not CJK; they live in U+2500..U+257F (Box Drawing)
			// and are explicitly East-Asian-Width Narrow, so they MUST be
			// width 1. The mobux Claude Code TUI broke without this.
			expect(wcwidth(0x2500)).toBe(1); // ─
			expect(wcwidth(0x2502)).toBe(1); // │
			expect(wcwidth(0x250c)).toBe(1); // ┌
			expect(wcwidth(0x256d)).toBe(1); // ╭ (rounded corner used by Claude Code)
			expect(wcwidth(0x2562)).toBe(1); // ╢
			expect(wcwidth(0x25c6)).toBe(1); // ◆ diamond bullet
			expect(wcwidth(0x2728)).toBe(1); // ✨ NB: emoji presentation by default in browsers but Kuhn classifies as Narrow; we follow Kuhn.
		});
	});

	// ── wcswidth() string-level widths ───────────────────────────────
	describe("wcswidth() string totals", () => {
		it("ASCII string sums to its char count", () => {
			expect(wcswidth("Hello, world!")).toBe(13);
		});

		it("CJK string sums to 2 * code-point count", () => {
			expect(wcswidth("中文测试")).toBe(8);
		});

		it("Mixed ASCII + CJK adds widths correctly", () => {
			// "A中B" → 1 + 2 + 1 = 4
			expect(wcswidth("A中B")).toBe(4);
		});

		it("Combining marks contribute 0 (precomposed length differs)", () => {
			// "é" as e + COMBINING ACUTE = 1 column total
			expect(wcswidth("é")).toBe(1);
			// "é" precomposed is just 1 code point of width 1
			expect(wcswidth("é")).toBe(1);
		});

		it("Emoji string with surrogate pair sums correctly", () => {
			// "🚀" is a surrogate pair (2 UTF-16 units, 1 code point) → width 2
			expect(wcswidth("🚀")).toBe(2);
			expect(wcswidth("🚀A")).toBe(3);
		});

		it("ZWJ-fused emoji family glyph: sum of leading 2 + ZWJ 0 + ...", () => {
			// 👨‍👩‍👧‍👦 → 4×width-2 + 3×width-0(ZWJ) = 8
			// In a real font this renders as one ligature, but the cell-grid
			// allocation we lock here is the *sum-of-code-points* model.
			// Real terminals (xterm, iTerm) do the same; the visual fusion
			// is purely a font/shaping feature.
			const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
			expect(wcswidth(family)).toBe(8);
		});
	});

	// ── Buffer state after writes ────────────────────────────────────
	describe("buffer state after writes", () => {
		it('CJK "中文" → 4 cells used (2 leading + 2 placeholders), cursor advances by 4', () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			term.write("中文");
			const buf = term.buffer.active;
			expect(buf.cursorX).toBe(4);

			const line = buf.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("中");
			expect(line?.getCell(0).getCode()).toBe(0x4e2d);
			// Placeholder cell — empty chars, occupies a cell slot.
			expect(line?.getCell(1).getChars()).toBe("");
			expect(line?.getCell(2).getChars()).toBe("文");
			expect(line?.getCell(3).getChars()).toBe("");

			term.dispose();
		});

		it('Combining mark: "é" → cell[0].chars === "é" (2 UTF-16 units), cursor advances by 1', () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			term.write("é");
			const buf = term.buffer.active;
			expect(buf.cursorX).toBe(1);

			const cell = buf.getLine(0)?.getCell(0);
			expect(cell?.getChars()).toBe("é");
			// Length-in-UTF16-units is 2 even though it's 1 cell wide.
			expect(cell?.getChars().length).toBe(2);

			term.dispose();
		});

		it("Combining mark with no anchor (cursor at col 0) is dropped", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			// Write only a combining mark — Kuhn's contract says drop it.
			term.write("́");
			const buf = term.buffer.active;
			expect(buf.cursorX).toBe(0);

			term.dispose();
		});

		it("Wide char then combining mark glues onto the wide char (not the placeholder)", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			// Some scripts (e.g. tone marks on CJK pinyin) use this pattern.
			// 中 (width 2) + combining acute → "中́" rendered as one wide glyph.
			term.write("中́");
			const buf = term.buffer.active;
			expect(buf.cursorX).toBe(2);

			const line = buf.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("中́");
			expect(line?.getCell(1).getChars()).toBe(""); // placeholder unchanged

			term.dispose();
		});

		it('Emoji "🚀A" → cursor advances by 3 columns, not 2 (Row 33 banner case)', () => {
			// This is the exact assertion the gap-matrix asks for.
			const term = createTerminal({ cols: 10, rows: 2 });
			term.write("🚀A");
			const buf = term.buffer.active;
			expect(buf.cursorX).toBe(3);

			const line = buf.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("🚀");
			expect(line?.getCell(1).getChars()).toBe(""); // emoji placeholder
			expect(line?.getCell(2).getChars()).toBe("A");

			term.dispose();
		});

		it("ZWJ-emoji-family advances cursor by 8 cells (sum-of-code-points model)", () => {
			const term = createTerminal({ cols: 20, rows: 2 });
			const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
			term.write(family);
			const buf = term.buffer.active;
			// Each emoji is width 2 (4×2 = 8), each ZWJ is width 0 (3×0 = 0).
			expect(buf.cursorX).toBe(8);

			term.dispose();
		});

		it("Box-drawing chars (width 1) leave no placeholder cells", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			term.write("┌─┐");
			const buf = term.buffer.active;
			expect(buf.cursorX).toBe(3);

			const line = buf.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("┌");
			expect(line?.getCell(1).getChars()).toBe("─");
			expect(line?.getCell(2).getChars()).toBe("┐");
			// No placeholder slots — these are width-1.
			expect(line?.getCell(3).getChars()).toBe(" "); // blank

			term.dispose();
		});

		it("Full-width punctuation: ！ → 1 leading cell + 1 placeholder, cursor +2", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			term.write("！？");
			const buf = term.buffer.active;
			expect(buf.cursorX).toBe(4);

			const line = buf.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("！");
			expect(line?.getCell(1).getChars()).toBe("");
			expect(line?.getCell(2).getChars()).toBe("？");
			expect(line?.getCell(3).getChars()).toBe("");

			term.dispose();
		});

		it("translateToString returns the visible glyph stream, placeholders drop out", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			term.write("中A");
			const line = term.buffer.active.getLine(0);
			const s = line?.translateToString(true);
			// "中A" — the placeholder did not introduce a second character.
			expect(s).toBe("中A");
			term.dispose();
		});

		it("Wide char at last column wraps to next row (xterm behaviour)", () => {
			// 4-col terminal, write "AAA中" → "AAA" fills cols 0..2, the wide
			// char cannot fit at col 3 (only one cell free), so it wraps to
			// row 1 col 0..1.
			const term = createTerminal({ cols: 4, rows: 2 });
			term.write("AAA中");
			const buf = term.buffer.active;
			expect(buf.cursorY).toBe(1);
			expect(buf.cursorX).toBe(2);
			expect(buf.getLine(1)?.getCell(0).getChars()).toBe("中");
			expect(buf.getLine(1)?.getCell(1).getChars()).toBe("");
			term.dispose();
		});
	});
});
