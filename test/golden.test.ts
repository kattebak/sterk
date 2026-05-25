/**
 * Golden tests - feed common sequences and assert buffer contents
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../src/index.js";

/**
 * Helper to serialize buffer contents for easy diffing
 */
function serializeBuffer(term: ReturnType<typeof createTerminal>): string {
	const lines: string[] = [];
	const buffer = term.buffer.active;

	for (let y = 0; y < term.rows; y++) {
		const line = buffer.getLine(y);
		if (line) {
			lines.push(line.translateToString(true));
		}
	}

	return lines.join("\n");
}

/**
 * Helper to get cell attributes at a position
 */
function getCellAttrs(
	term: ReturnType<typeof createTerminal>,
	x: number,
	y: number,
) {
	const line = term.buffer.active.getLine(y);
	if (!line) return null;
	const cell = line.getCell(x);
	return {
		char: cell.getChars(),
		fgDefault: cell.isFgDefault(),
		bgDefault: cell.isBgDefault(),
		bold: cell.isBold(),
		italic: cell.isItalic(),
		underline: cell.isUnderline(),
		inverse: cell.isInverse(),
		dim: cell.isDim(),
		fgColor: cell.getFgColor(),
		bgColor: cell.getBgColor(),
	};
}

describe("Golden tests", () => {
	describe("Plain text", () => {
		it("prints simple text", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Hello, world!");

			expect(serializeBuffer(term)).toContain("Hello, world!");
			term.dispose();
		});

		it("handles newlines", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Line 1\nLine 2\nLine 3");

			const output = serializeBuffer(term);
			expect(output).toContain("Line 1");
			expect(output).toContain("Line 2");
			expect(output).toContain("Line 3");
			term.dispose();
		});

		it("handles CR/LF", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("First\r\nSecond\r\nThird");

			const output = serializeBuffer(term);
			expect(output).toContain("First");
			expect(output).toContain("Second");
			expect(output).toContain("Third");
			term.dispose();
		});
	});

	describe("C0 controls", () => {
		it("handles backspace (BS)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("ABCD\b\bXY");

			const line = term.buffer.active.getLine(0);
			const text = line?.translateToString(true);
			expect(text).toBe("ABXY");
			term.dispose();
		});

		it("handles tab (HT)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("A\tB");

			const line = term.buffer.active.getLine(0);
			const text = line?.translateToString();
			// Tab to next 8-column boundary: A at 0, tab to 8, B at 8
			expect(text?.[0]).toBe("A");
			expect(text?.[8]).toBe("B");
			term.dispose();
		});

		it("handles carriage return (CR)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("ABCD\rXY");

			const line = term.buffer.active.getLine(0);
			const text = line?.translateToString(true);
			expect(text).toBe("XYCD"); // CR overwrites from start
			term.dispose();
		});
	});

	describe("SGR color/style sequences", () => {
		it("applies bold text", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[1mBOLD\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.char).toBe("B");
			expect(attrs?.bold).toBe(1);

			// After reset
			const afterReset = getCellAttrs(term, 4, 0);
			expect(afterReset?.bold).toBe(0);
			term.dispose();
		});

		it("applies italic text", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[3mITALIC\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.italic).toBe(1);
			term.dispose();
		});

		it("applies underline", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[4mUNDERLINE\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.underline).toBe(1);
			term.dispose();
		});

		it("applies inverse", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[7mINVERSE\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.inverse).toBe(1);
			term.dispose();
		});

		it("applies ANSI foreground colors", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[31mRED\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.fgDefault).toBe(0);
			expect(attrs?.fgColor).toBe(1); // ANSI red
			term.dispose();
		});

		it("applies ANSI background colors", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[42mGREEN_BG\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.bgDefault).toBe(0);
			expect(attrs?.bgColor).toBe(2); // ANSI green
			term.dispose();
		});

		it("applies bright foreground colors", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[91mBRIGHT_RED\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.fgColor).toBe(9); // Bright red (palette 9)
			term.dispose();
		});

		it("applies 256-color palette", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[38;5;196mPALETTE\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.fgColor).toBe(196); // 256-color red
			term.dispose();
		});

		it("applies truecolor RGB", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[38;2;255;128;0mORANGE\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.fgColor).toBe(0xff8000); // RGB orange
			term.dispose();
		});

		it("combines multiple attributes", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[1;3;4;31mCOMBO\x1b[0m");

			const attrs = getCellAttrs(term, 0, 0);
			expect(attrs?.bold).toBe(1);
			expect(attrs?.italic).toBe(1);
			expect(attrs?.underline).toBe(1);
			expect(attrs?.fgColor).toBe(1); // red
			term.dispose();
		});

		it("resets individual attributes", () => {
			const term = createTerminal({ cols: 30, rows: 5 });
			term.write(
				"\x1b[1;3;4mSTART\x1b[22mNOBOLD\x1b[23mNOITALIC\x1b[24mNOUNDER",
			);

			const start = getCellAttrs(term, 0, 0);
			expect(start?.bold).toBe(1);
			expect(start?.italic).toBe(1);
			expect(start?.underline).toBe(1);

			const noBold = getCellAttrs(term, 5, 0);
			expect(noBold?.bold).toBe(0);
			expect(noBold?.italic).toBe(1);

			const noItalic = getCellAttrs(term, 11, 0);
			expect(noItalic?.italic).toBe(0);

			const noUnder = getCellAttrs(term, 19, 0);
			expect(noUnder?.underline).toBe(0);
			term.dispose();
		});
	});

	describe("Cursor movement", () => {
		it("handles CUU (cursor up)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Line 1\nLine 2\nLine 3");
			term.write("\x1b[2A"); // Up 2 lines

			const cursorY = term.buffer.active.cursorY;
			expect(cursorY).toBe(0); // Started at row 2, moved up 2
			term.dispose();
		});

		it("handles CUD (cursor down)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Start");
			term.write("\x1b[2B"); // Down 2 lines

			const cursorY = term.buffer.active.cursorY;
			expect(cursorY).toBe(2);
			term.dispose();
		});

		it("handles CUF (cursor forward)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Start");
			term.write("\x1b[3C"); // Forward 3 columns

			const cursorX = term.buffer.active.cursorX;
			expect(cursorX).toBe(8); // 5 chars + 3 forward
			term.dispose();
		});

		it("handles CUB (cursor back)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("ABCDEFGH");
			term.write("\x1b[3D"); // Back 3 columns

			const cursorX = term.buffer.active.cursorX;
			expect(cursorX).toBe(5); // 8 chars - 3 back
			term.dispose();
		});

		it("handles CUP (cursor position)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[3;5H"); // Row 3, column 5 (1-based)

			const cursor = term.buffer.active;
			expect(cursor.cursorY).toBe(2); // 0-based
			expect(cursor.cursorX).toBe(4); // 0-based
			term.dispose();
		});
	});

	describe("Erase sequences", () => {
		it("handles ED 0 (erase below cursor)", () => {
			const term = createTerminal({ cols: 10, rows: 5 });
			term.write("AAAA\nBBBB\nCCCC\nDDDD");
			term.write("\x1b[2;2H"); // Move to row 2, col 2
			term.write("\x1b[0J"); // Erase below

			const line1 = term.buffer.active.getLine(0)?.translateToString(true);
			const line2 = term.buffer.active.getLine(1)?.translateToString(true);
			const line3 = term.buffer.active.getLine(2)?.translateToString(true);

			expect(line1).toBe("AAAA");
			expect(line2).toBe("B"); // First char preserved, rest erased
			expect(line3).toBe(""); // Fully erased
			term.dispose();
		});

		it("handles ED 2 (erase entire screen)", () => {
			const term = createTerminal({ cols: 10, rows: 5 });
			term.write("AAAA\nBBBB\nCCCC");
			term.write("\x1b[2J"); // Clear screen

			const output = serializeBuffer(term);
			expect(output.trim()).toBe("");
			term.dispose();
		});

		it("handles EL 0 (erase to end of line)", () => {
			const term = createTerminal({ cols: 10, rows: 5 });
			term.write("ABCDEFGH");
			term.write("\x1b[4D"); // Back 4 chars
			term.write("\x1b[0K"); // Erase to end

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toBe("ABCD");
			term.dispose();
		});

		it("handles EL 1 (erase to start of line)", () => {
			const term = createTerminal({ cols: 10, rows: 5 });
			term.write("ABCDEFGH");
			term.write("\x1b[4D"); // Back 4 chars (cursor at E)
			term.write("\x1b[1K"); // Erase to start

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toBe("FGH"); // E and before erased
			term.dispose();
		});

		it("handles EL 2 (erase entire line)", () => {
			const term = createTerminal({ cols: 10, rows: 5 });
			term.write("ABCDEFGH");
			term.write("\x1b[2K"); // Erase line

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toBe("");
			term.dispose();
		});
	});

	describe("Line wrapping", () => {
		it("wraps at right margin", () => {
			const term = createTerminal({ cols: 10, rows: 5 });
			term.write("ABCDEFGHIJKLMNOP");

			const line1 = term.buffer.active.getLine(0)?.translateToString(true);
			const line2 = term.buffer.active.getLine(1)?.translateToString(true);

			expect(line1).toBe("ABCDEFGHIJ");
			expect(line2).toBe("KLMNOP");
			term.dispose();
		});

		it("scrolls when at bottom", () => {
			const term = createTerminal({ cols: 10, rows: 3 });
			term.write("Line 1\nLine 2\nLine 3\nLine 4");

			const buffer = term.buffer.active;
			expect(buffer.length).toBeGreaterThan(3); // Scrollback accumulated

			// Last visible lines should be 2, 3, 4
			const line1 = buffer
				.getLine(buffer.viewportY + 0)
				?.translateToString(true);
			const line2 = buffer
				.getLine(buffer.viewportY + 1)
				?.translateToString(true);
			const line3 = buffer
				.getLine(buffer.viewportY + 2)
				?.translateToString(true);

			expect(line1).toBe("Line 2");
			expect(line2).toBe("Line 3");
			expect(line3).toBe("Line 4");
			term.dispose();
		});
	});

	describe("UTF-8 multi-byte characters", () => {
		it("handles 2-byte UTF-8", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Café");

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toBe("Café");
			term.dispose();
		});

		it("handles 3-byte UTF-8 (emoji)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Hello 😊");

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toBe("Hello 😊");
			term.dispose();
		});

		it("handles CJK characters", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("日本語");

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toBe("日本語");
			term.dispose();
		});

		it("handles mixed ASCII and CJK", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Hello 日本 World");

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toBe("Hello 日本 World");
			term.dispose();
		});

		it("handles 4-byte emoji sequences", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Test 🚀🎉 done");

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toBe("Test 🚀🎉 done");
			term.dispose();
		});

		it("handles invalid UTF-8 sequences gracefully", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			// Send invalid UTF-8: continuation byte without lead byte
			const invalidUtf8 = new Uint8Array([0x48, 0x69, 0x80, 0x21]); // Hi[invalid]!
			term.write(invalidUtf8);

			// Should not crash - decoder should handle gracefully
			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toBeTruthy(); // Just verify it doesn't crash
			term.dispose();
		});
	});

	describe("CSI parameter edge cases", () => {
		it("handles omitted parameters (default to 1)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("ABCDEFGH");
			term.write("\x1b[D"); // CUB with no param, should default to 1

			expect(term.buffer.active.cursorX).toBe(7); // Moved back 1 from 8
			term.dispose();
		});

		it("handles empty parameters between semicolons", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[;5H"); // CUP with empty row param, col=5

			// Empty param should default to 1, so position (1,5) -> 0-indexed (0,4)
			expect(term.buffer.active.cursorY).toBe(0);
			expect(term.buffer.active.cursorX).toBe(4);
			term.dispose();
		});

		it("handles very large parameters (clamped to buffer)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("\x1b[9999;9999H"); // CUP to ridiculously large position

			// Should clamp to max valid position
			expect(term.buffer.active.cursorY).toBeLessThan(5);
			expect(term.buffer.active.cursorX).toBeLessThan(20);
			term.dispose();
		});

		it("handles zero parameters (treated as 1)", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("ABCDEFGH");
			term.write("\x1b[0D"); // CUB with param=0, should move back 1

			// param=0 typically defaults to 1 in most sequences
			expect(term.buffer.active.cursorX).toBeLessThan(8);
			term.dispose();
		});
	});

	describe("Malformed sequences", () => {
		it("ignores incomplete CSI sequences", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Before\x1b[After"); // No final byte

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			// Should print "Before" then ignore the incomplete sequence
			expect(line).toContain("Before");
			term.dispose();
		});

		it("recovers from invalid parameters", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("A\x1b[999;999HB"); // Out of bounds CUP

			const line = term.buffer.active.getLine(0)?.translateToString(true);
			expect(line).toContain("A");
			// Should clamp to valid position
			term.dispose();
		});

		it("handles split escape sequences across writes", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("A\x1b["); // CSI prefix
			term.write("31mRED"); // Complete with SGR

			const attrs = getCellAttrs(term, 1, 0);
			expect(attrs?.fgColor).toBe(1); // Red
			term.dispose();
		});
	});
});
