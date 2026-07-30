import { beforeEach, describe, expect, it } from "vitest";
import {
	type CellAttributes,
	DEFAULT_CELL_ATTRIBUTES,
	ScrollBuffer,
} from "../src/buffer/scroll_buffer.js";

describe("ScrollBuffer", () => {
	let buffer: ScrollBuffer;

	beforeEach(() => {
		// Create a 80x24 buffer with 1000 lines of scrollback
		buffer = new ScrollBuffer(80, 24, 1000);
	});

	describe("initialization", () => {
		it("creates a buffer with the specified dimensions", () => {
			expect(buffer.length).toBe(24); // Initial rows only, no scrollback yet
			expect(buffer.cursorX).toBe(0);
			expect(buffer.cursorY).toBe(0);
			expect(buffer.baseY).toBe(0);
			expect(buffer.viewportY).toBe(0);
		});

		it("initializes with blank lines", () => {
			for (let y = 0; y < 24; y++) {
				const line = buffer.getLine(y);
				expect(line).not.toBeUndefined();
				expect(line?.translateToString()).toBe(" ".repeat(80));
			}
		});
	});

	describe("cursor positioning", () => {
		it("sets cursor position", () => {
			buffer.setCursor(10, 5);
			expect(buffer.cursorX).toBe(10);
			expect(buffer.cursorY).toBe(5);
		});

		it("clamps cursor to buffer bounds", () => {
			buffer.setCursor(100, 50);
			expect(buffer.cursorX).toBe(79); // cols - 1
			expect(buffer.cursorY).toBe(23); // rows - 1
		});

		it("handles negative cursor positions", () => {
			buffer.setCursor(-5, -10);
			expect(buffer.cursorX).toBe(0);
			expect(buffer.cursorY).toBe(0);
		});
	});

	describe("cell writing", () => {
		it("writes a character at cursor position", () => {
			buffer.setCursor(0, 0);
			buffer.writeCell("A", 65, DEFAULT_CELL_ATTRIBUTES);
			const line = buffer.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("A");
			expect(line?.getCell(0).getCode()).toBe(65);
		});

		it("advances cursor after writing", () => {
			buffer.setCursor(0, 0);
			buffer.writeCell("A", 65, DEFAULT_CELL_ATTRIBUTES);
			expect(buffer.cursorX).toBe(1);
			expect(buffer.cursorY).toBe(0);
		});

		it("wraps to next line at right margin", () => {
			buffer.setCursor(79, 0);
			buffer.writeCell("A", 65, DEFAULT_CELL_ATTRIBUTES);
			expect(buffer.cursorX).toBe(0);
			expect(buffer.cursorY).toBe(1);
		});

		it("stores cell attributes correctly", () => {
			const attrs: CellAttributes = {
				fgMode: 1,
				fgColor: 196, // Red
				bgMode: 1,
				bgColor: 21, // Blue
				bold: true,
				italic: true,
				underline: true,
				inverse: false,
				dim: false,
			};

			buffer.setCursor(0, 0);
			buffer.writeCell("X", 88, attrs);
			const cell = buffer.getLine(0)?.getCell(0);

			expect(cell?.getChars()).toBe("X");
			expect(cell?.isFgPalette()).toBe(1);
			expect(cell?.getFgColor()).toBe(196);
			expect(cell?.isBgPalette()).toBe(1);
			expect(cell?.getBgColor()).toBe(21);
			expect(cell?.isBold()).toBe(1);
			expect(cell?.isItalic()).toBe(1);
			expect(cell?.isUnderline()).toBe(1);
			expect(cell?.isInverse()).toBe(0);
			expect(cell?.isDim()).toBe(0);
		});

		it("handles RGB colors", () => {
			const attrs: CellAttributes = {
				fgMode: 2,
				fgColor: 0xff5500, // Orange
				bgMode: 2,
				bgColor: 0x1e1e1e, // Dark gray
				bold: false,
				italic: false,
				underline: false,
				inverse: false,
				dim: false,
			};

			buffer.setCursor(0, 0);
			buffer.writeCell("Y", 89, attrs);
			const cell = buffer.getLine(0)?.getCell(0);

			expect(cell?.isFgRGB()).toBe(1);
			expect(cell?.getFgColor()).toBe(0xff5500);
			expect(cell?.isBgRGB()).toBe(1);
			expect(cell?.getBgColor()).toBe(0x1e1e1e);
		});

		it("handles default colors", () => {
			buffer.setCursor(0, 0);
			buffer.writeCell("Z", 90, DEFAULT_CELL_ATTRIBUTES);
			const cell = buffer.getLine(0)?.getCell(0);

			expect(cell?.isFgDefault()).toBe(1);
			expect(cell?.getFgColor()).toBe(-1);
			expect(cell?.isBgDefault()).toBe(1);
			expect(cell?.getBgColor()).toBe(-1);
		});
	});

	describe("line operations", () => {
		it("inserts a new line", () => {
			buffer.setCursor(0, 0);
			const initialLength = buffer.length;
			buffer.insertLine();
			expect(buffer.length).toBe(initialLength + 1);
		});

		it("marks wrapped lines", () => {
			buffer.setCursor(0, 0);
			buffer.insertLine(true);
			// insertLine appends to bottom, so check the last line
			const line = buffer.getLine(buffer.length - 1);
			expect(line?.isWrapped).toBe(true);
		});

		it("does not advance cursor on insert", () => {
			buffer.setCursor(0, 5);
			const initialCursorY = buffer.cursorY;
			buffer.insertLine();
			// insertLine appends to bottom, doesn't move cursor
			expect(buffer.cursorY).toBe(initialCursorY);
		});
	});

	describe("scrollback", () => {
		it("accumulates scrollback lines", () => {
			buffer.setCursor(0, 0);
			// Add 100 lines
			for (let i = 0; i < 100; i++) {
				buffer.insertLine();
			}
			expect(buffer.length).toBeGreaterThan(24);
		});

		it("evicts oldest lines when at capacity", () => {
			const maxLines = 24 + 1000; // rows + scrollback
			buffer.setCursor(0, 0);

			// Fill beyond capacity
			for (let i = 0; i < maxLines + 10; i++) {
				buffer.insertLine();
			}

			expect(buffer.length).toBe(maxLines);
			expect(buffer.baseY).toBeGreaterThan(0);
		});

		it("allows reading scrollback lines", () => {
			buffer.setCursor(0, 0);
			// Write marker in first line
			buffer.writeCell("M", 77, DEFAULT_CELL_ATTRIBUTES);

			// Add more lines to push it into scrollback
			for (let i = 0; i < 50; i++) {
				buffer.insertLine();
			}

			// Original line should still be readable
			const line = buffer.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("M");
		});
	});

	describe("viewport scrolling", () => {
		beforeEach(() => {
			// Fill buffer with scrollback
			buffer.setCursor(0, 0);
			for (let i = 0; i < 100; i++) {
				buffer.insertLine();
			}
		});

		it("sets viewport position", () => {
			buffer.setViewportY(10);
			expect(buffer.viewportY).toBe(10);
		});

		it("clamps viewport to valid range", () => {
			const maxViewport = buffer.length - 24;
			buffer.setViewportY(9999);
			expect(buffer.viewportY).toBeLessThanOrEqual(maxViewport);
		});

		it("scrolls viewport by delta", () => {
			buffer.setViewportY(20);
			buffer.scrollViewport(10);
			expect(buffer.viewportY).toBe(30);

			buffer.scrollViewport(-5);
			expect(buffer.viewportY).toBe(25);
		});

		it("scrolls to bottom", () => {
			buffer.setViewportY(10);
			buffer.scrollToBottom();
			// Should show the last 'rows' lines (most recent content)
			const expectedViewportY = Math.max(0, buffer.length - 24);
			expect(buffer.viewportY).toBe(expectedViewportY);
		});
	});

	describe("buffer clear", () => {
		it("removes all lines and resets state", () => {
			// Fill with data
			buffer.setCursor(0, 0);
			for (let i = 0; i < 50; i++) {
				buffer.writeCell("X", 88, DEFAULT_CELL_ATTRIBUTES);
			}

			buffer.clear();

			expect(buffer.length).toBe(24);
			expect(buffer.cursorX).toBe(0);
			expect(buffer.cursorY).toBe(0);
			expect(buffer.baseY).toBe(0);
			expect(buffer.viewportY).toBe(0);

			// All lines should be blank
			for (let y = 0; y < 24; y++) {
				const line = buffer.getLine(y);
				expect(line?.translateToString()).toBe(" ".repeat(80));
			}
		});
	});

	describe("buffer resize", () => {
		it("resizes to new dimensions", () => {
			buffer.resize(120, 30);

			// Lines should be padded to new width
			for (let y = 0; y < buffer.length; y++) {
				const line = buffer.getLine(y);
				expect(line?.translateToString().length).toBe(120);
			}
		});

		it("truncates lines when shrinking width", () => {
			buffer.setCursor(0, 0);
			for (let x = 0; x < 80; x++) {
				buffer.writeCell("X", 88, DEFAULT_CELL_ATTRIBUTES);
			}

			buffer.resize(40, 24);
			const line = buffer.getLine(0);
			expect(line?.translateToString().length).toBe(40);
		});

		it("clamps cursor to new dimensions", () => {
			buffer.setCursor(70, 20);
			buffer.resize(40, 15);
			expect(buffer.cursorX).toBeLessThan(40);
			expect(buffer.cursorY).toBeLessThan(15);
		});

		it("preserves existing content when growing", () => {
			buffer.setCursor(0, 0);
			buffer.writeCell("A", 65, DEFAULT_CELL_ATTRIBUTES);
			buffer.writeCell("B", 66, DEFAULT_CELL_ATTRIBUTES);

			buffer.resize(120, 30);

			const line = buffer.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("A");
			expect(line?.getCell(1).getChars()).toBe("B");
		});
	});

	describe("BufferLine interface", () => {
		it("translateToString returns full line text", () => {
			buffer.setCursor(0, 0);
			buffer.writeCell("H", 72, DEFAULT_CELL_ATTRIBUTES);
			buffer.writeCell("e", 101, DEFAULT_CELL_ATTRIBUTES);
			buffer.writeCell("l", 108, DEFAULT_CELL_ATTRIBUTES);
			buffer.writeCell("l", 108, DEFAULT_CELL_ATTRIBUTES);
			buffer.writeCell("o", 111, DEFAULT_CELL_ATTRIBUTES);

			const line = buffer.getLine(0);
			const text = line?.translateToString();
			expect(text?.substring(0, 5)).toBe("Hello");
		});

		it("translateToString with trimRight removes trailing spaces", () => {
			buffer.setCursor(0, 0);
			buffer.writeCell("X", 88, DEFAULT_CELL_ATTRIBUTES);
			buffer.writeCell("Y", 89, DEFAULT_CELL_ATTRIBUTES);

			const line = buffer.getLine(0);
			const trimmed = line?.translateToString(true);
			expect(trimmed).toBe("XY");
			expect(trimmed?.length).toBe(2);
		});

		it("getCell returns blank cell for out-of-bounds index", () => {
			const line = buffer.getLine(0);
			const cell = line?.getCell(999);
			expect(cell?.getChars()).toBe(" ");
			expect(cell?.getCode()).toBe(32);
		});
	});

	describe("BufferCell interface", () => {
		it("provides color mode accessors", () => {
			const attrs: CellAttributes = {
				fgMode: 1,
				fgColor: 10,
				bgMode: 2,
				bgColor: 0xaabbcc,
				bold: false,
				italic: false,
				underline: false,
				inverse: false,
				dim: false,
			};

			buffer.setCursor(0, 0);
			buffer.writeCell("T", 84, attrs);
			const cell = buffer.getLine(0)?.getCell(0);

			expect(cell?.getFgColorMode()).toBe(0x100); // palette mode
			expect(cell?.getBgColorMode()).toBe(0x200); // RGB mode
		});

		it("handles all text style flags", () => {
			const attrs: CellAttributes = {
				fgMode: 0,
				fgColor: -1,
				bgMode: 0,
				bgColor: -1,
				bold: true,
				italic: true,
				underline: true,
				inverse: true,
				dim: true,
			};

			buffer.setCursor(0, 0);
			buffer.writeCell("S", 83, attrs);
			const cell = buffer.getLine(0)?.getCell(0);

			expect(cell?.isBold()).toBe(1);
			expect(cell?.isItalic()).toBe(1);
			expect(cell?.isUnderline()).toBe(1);
			expect(cell?.isInverse()).toBe(1);
			expect(cell?.isDim()).toBe(1);
		});
	});

	describe("edge cases", () => {
		it("handles writing to last column", () => {
			buffer.setCursor(79, 0);
			buffer.writeCell("Z", 90, DEFAULT_CELL_ATTRIBUTES);
			const line = buffer.getLine(0);
			expect(line?.getCell(79).getChars()).toBe("Z");
		});

		it("handles multiple writes to same cell", () => {
			buffer.setCursor(0, 0);
			buffer.writeCell("A", 65, DEFAULT_CELL_ATTRIBUTES);
			buffer.setCursor(0, 0);
			buffer.writeCell("B", 66, DEFAULT_CELL_ATTRIBUTES);
			const line = buffer.getLine(0);
			expect(line?.getCell(0).getChars()).toBe("B");
		});

		it("handles reading line beyond buffer length", () => {
			const line = buffer.getLine(9999);
			expect(line).toBeUndefined();
		});

		it("handles negative line index", () => {
			const line = buffer.getLine(-1);
			expect(line).toBeUndefined();
		});

		it("maintains baseY correctly during scrollback accumulation", () => {
			buffer.setCursor(0, 0);
			const initialBaseY = buffer.baseY;

			// Add lines without exceeding capacity
			for (let i = 0; i < 50; i++) {
				buffer.insertLine();
			}

			// baseY should still be 0 (not evicting yet)
			expect(buffer.baseY).toBe(initialBaseY);
		});
	});
});
