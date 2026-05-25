/**
 * xterm.js read-API parity for buffer / line / cell.
 *
 * Tracking: https://github.com/kattebak/sterk/issues/36
 *
 * Additive, non-breaking accessors:
 * - BufferCell.getWidth(): 0 (wide placeholder / zero-width) | 2 (wide
 *   leading) | 1 (default).
 * - BufferNamespace.normal / .alternate: the two screen buffers, plus
 *   Buffer.type ("normal" | "alternate") so `buffer.active.type` tracks
 *   alt-screen switches.
 * - Buffer.getNullCell(): a blank default cell.
 * - BufferLine.length: number of cells in the line.
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../src/index.js";

describe("buffer read-API parity (xterm.js)", () => {
	describe("BufferCell.getWidth()", () => {
		it("ASCII glyph is width 1", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			term.write("A");
			const cell = term.buffer.active.getLine(0)?.getCell(0);
			expect(cell?.getWidth()).toBe(1);
			term.dispose();
		});

		it("CJK leading cell is width 2, its trailing placeholder is width 0", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			// U+4E2D (中) is East-Asian-Wide → occupies two columns.
			term.write("中");
			const line = term.buffer.active.getLine(0);
			expect(line?.getCell(0).getWidth()).toBe(2);
			expect(line?.getCell(1).getWidth()).toBe(0);
			term.dispose();
		});

		it("a combining-base cell stays width 1", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			// "e" + combining acute (U+0301): the base cell carries both,
			// the cursor advances by 1, and the cell width is 1.
			term.write("é");
			const line = term.buffer.active.getLine(0);
			expect(line?.getCell(0).getWidth()).toBe(1);
			expect(term.buffer.active.cursorX).toBe(1);
			term.dispose();
		});

		it("a blank cell is width 1", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			const cell = term.buffer.active.getNullCell();
			expect(cell.getWidth()).toBe(1);
			term.dispose();
		});
	});

	describe("BufferNamespace.normal / .alternate + Buffer.type", () => {
		it("exposes normal and alternate as distinct buffers with correct type", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			const { normal, alternate } = term.buffer;
			expect(normal).not.toBe(alternate);
			expect(normal.type).toBe("normal");
			expect(alternate.type).toBe("alternate");
			term.dispose();
		});

		it("active points at the normal buffer before any alt-screen switch", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			expect(term.buffer.active).toBe(term.buffer.normal);
			expect(term.buffer.active.type).toBe("normal");
			term.dispose();
		});

		it("active.type tracks alt-screen enter / leave", () => {
			const term = createTerminal({ cols: 10, rows: 2 });

			// Enter alternate screen (DECSET 1049).
			term.write("\x1b[?1049h");
			expect(term.buffer.active).toBe(term.buffer.alternate);
			expect(term.buffer.active.type).toBe("alternate");

			// Leave alternate screen (DECRST 1049).
			term.write("\x1b[?1049l");
			expect(term.buffer.active).toBe(term.buffer.normal);
			expect(term.buffer.active.type).toBe("normal");

			term.dispose();
		});
	});

	describe("Buffer.getNullCell()", () => {
		it("returns a blank default cell (space, default colors, no styles)", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			const cell = term.buffer.active.getNullCell();
			expect(cell.getChars()).toBe(" ");
			expect(cell.getCode()).toBe(32);
			expect(cell.isFgDefault()).toBe(1);
			expect(cell.isBgDefault()).toBe(1);
			expect(cell.isBold()).toBe(0);
			expect(cell.isItalic()).toBe(0);
			expect(cell.isUnderline()).toBe(0);
			expect(cell.isInverse()).toBe(0);
			expect(cell.isDim()).toBe(0);
			term.dispose();
		});

		it("returns a fresh cell each call (no shared mutable state)", () => {
			const term = createTerminal({ cols: 10, rows: 2 });
			expect(term.buffer.active.getNullCell()).not.toBe(
				term.buffer.active.getNullCell(),
			);
			term.dispose();
		});
	});

	describe("BufferLine.length", () => {
		it("equals the column count", () => {
			const cols = 17;
			const term = createTerminal({ cols, rows: 3 });
			const line = term.buffer.active.getLine(0);
			expect(line?.length).toBe(cols);
			term.dispose();
		});
	});
});
