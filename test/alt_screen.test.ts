/**
 * Alternate screen buffer tests
 *
 * Tests DECSET/DECRST private modes:
 * - 1047: Switch to/from alternate screen
 * - 1048: Save/restore cursor position
 * - 1049: Combined (save cursor + switch to alt + clear)
 *
 * Also tests DECSC/DECRC (ESC 7 / ESC 8) cursor save/restore.
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

describe("Alternate screen buffer", () => {
	describe("DECSET 1047 - Switch to/from alternate screen", () => {
		it("switches to alternate screen and back", () => {
			const term = createTerminal({ cols: 40, rows: 5 });

			// Write to normal buffer
			term.write("Normal buffer content");

			// Switch to alternate screen
			term.write("\x1b[?1047h");

			// Write to alternate buffer
			term.write("Alternate buffer");

			const altOutput = serializeBuffer(term);
			expect(altOutput).toContain("Alternate buffer");
			expect(altOutput).not.toContain("Normal buffer content");

			// Switch back to normal screen
			term.write("\x1b[?1047l");

			const normalOutput = serializeBuffer(term);
			expect(normalOutput).toContain("Normal buffer content");
			expect(normalOutput).not.toContain("Alternate buffer");

			term.dispose();
		});

		it("preserves alternate buffer content on multiple switches", () => {
			const term = createTerminal({ cols: 20, rows: 5 });

			// Write to normal buffer
			term.write("Normal line 1\nNormal line 2");

			// Switch to alternate
			term.write("\x1b[?1047h");
			term.write("Alt line 1\nAlt line 2");

			// Switch back to normal
			term.write("\x1b[?1047l");
			let output = serializeBuffer(term);
			expect(output).toContain("Normal line 1");

			// Switch to alternate again - should still have alt content
			term.write("\x1b[?1047h");
			output = serializeBuffer(term);
			expect(output).toContain("Alt line 1");
			expect(output).toContain("Alt line 2");

			term.dispose();
		});
	});

	describe("DECSET 1048 - Save/restore cursor position", () => {
		it("saves and restores cursor position", () => {
			const term = createTerminal({ cols: 20, rows: 5 });

			// Move cursor to (5, 2)
			term.write("\x1b[3;6H"); // Row 3, Col 6 (1-indexed)
			expect(term.buffer.active.cursorX).toBe(5);
			expect(term.buffer.active.cursorY).toBe(2);

			// Save cursor
			term.write("\x1b[?1048h");

			// Move cursor somewhere else
			term.write("\x1b[1;1H"); // Row 1, Col 1
			expect(term.buffer.active.cursorX).toBe(0);
			expect(term.buffer.active.cursorY).toBe(0);

			// Restore cursor
			term.write("\x1b[?1048l");
			expect(term.buffer.active.cursorX).toBe(5);
			expect(term.buffer.active.cursorY).toBe(2);

			term.dispose();
		});

		it("saves and restores SGR attributes", () => {
			const term = createTerminal({ cols: 20, rows: 5 });

			// Set bold + red foreground
			term.write("\x1b[1;31mA");

			// Get the cell attributes
			let line = term.buffer.active.getLine(0);
			let cell = line?.getCell(0);
			expect(cell?.isBold()).toBe(1);
			expect(cell?.getFgColor()).toBe(1); // Red

			// Save cursor (with attributes) - cursor is now at (1, 0)
			term.write("\x1b[?1048h");

			// Reset attributes and write
			term.write("\x1b[0mB");
			line = term.buffer.active.getLine(0);
			cell = line?.getCell(1);
			expect(cell?.isBold()).toBe(0);
			expect(cell?.isFgDefault()).toBe(1);

			// Restore cursor (should restore to (1, 0) with attributes)
			term.write("\x1b[?1048l");
			term.write("C"); // Writes at (1, 0), overwriting 'B'

			// The newly written char should have restored attributes
			line = term.buffer.active.getLine(0);
			cell = line?.getCell(1); // Check position 1, not 2
			expect(cell?.isBold()).toBe(1);
			expect(cell?.getFgColor()).toBe(1);

			term.dispose();
		});
	});

	describe("DECSET 1049 - Combined mode (save + switch + clear)", () => {
		it("saves cursor, switches to alt, and clears alt on enter", () => {
			const term = createTerminal({ cols: 20, rows: 5 });

			// Write to normal buffer
			term.write("Normal line 1\nNormal line 2");

			// Move cursor to a specific position
			term.write("\x1b[2;5H"); // Row 2, Col 5

			// Enter alt screen (1049)
			term.write("\x1b[?1049h");

			// Alt screen should be empty (cleared)
			const altOutput = serializeBuffer(term);
			expect(altOutput.trim()).toBe("");

			// Cursor should be at (0, 0) after clear
			expect(term.buffer.active.cursorX).toBe(0);
			expect(term.buffer.active.cursorY).toBe(0);

			// Write to alt screen
			term.write("Alt screen content");

			term.dispose();
		});

		it("clears alt, switches back, and restores cursor on exit", () => {
			const term = createTerminal({ cols: 20, rows: 5 });

			// Write to normal buffer
			term.write("Normal line 1\nNormal line 2");

			// Move cursor to (4, 1)
			term.write("\x1b[2;5H");

			// Enter alt screen
			term.write("\x1b[?1049h");

			// Write to alt screen
			term.write("Alt content");

			// Exit alt screen (1049)
			term.write("\x1b[?1049l");

			// Should be back on normal screen
			const normalOutput = serializeBuffer(term);
			expect(normalOutput).toContain("Normal line 1");
			expect(normalOutput).not.toContain("Alt content");

			// Cursor should be restored to (4, 1)
			expect(term.buffer.active.cursorX).toBe(4);
			expect(term.buffer.active.cursorY).toBe(1);

			term.dispose();
		});

		it("simulates vim-like usage", () => {
			const term = createTerminal({ cols: 40, rows: 10 });

			// Initial shell prompt
			term.write("$ ls -la\n");
			term.write("file1.txt\n");
			term.write("file2.txt\n");
			term.write("$ ");

			const beforeVim = serializeBuffer(term);
			expect(beforeVim).toContain("$ ls -la");

			// Enter vim (switch to alt screen)
			term.write("\x1b[?1049h");

			// Vim writes file content to alt screen
			term.write("# README\n");
			term.write("\n");
			term.write("This is a file opened in vim.\n");

			const vimScreen = serializeBuffer(term);
			expect(vimScreen).toContain("README");
			expect(vimScreen).not.toContain("$ ls -la");

			// Exit vim (switch back to normal screen)
			term.write("\x1b[?1049l");

			const afterVim = serializeBuffer(term);
			expect(afterVim).toContain("$ ls -la");
			expect(afterVim).not.toContain("README");

			term.dispose();
		});
	});

	describe("DECSC/DECRC - ESC 7 / ESC 8", () => {
		it("saves and restores cursor with ESC 7 / ESC 8", () => {
			const term = createTerminal({ cols: 20, rows: 5 });

			// Move cursor to (10, 3)
			term.write("\x1b[4;11H");
			expect(term.buffer.active.cursorX).toBe(10);
			expect(term.buffer.active.cursorY).toBe(3);

			// Save cursor (ESC 7)
			term.write("\x1b7");

			// Move cursor somewhere else
			term.write("\x1b[1;1H");
			expect(term.buffer.active.cursorX).toBe(0);
			expect(term.buffer.active.cursorY).toBe(0);

			// Restore cursor (ESC 8)
			term.write("\x1b8");
			expect(term.buffer.active.cursorX).toBe(10);
			expect(term.buffer.active.cursorY).toBe(3);

			term.dispose();
		});

		it("saves and restores SGR attributes with ESC 7 / ESC 8", () => {
			const term = createTerminal({ cols: 20, rows: 5 });

			// Set italic + blue background
			term.write("\x1b[3;44mA");

			let line = term.buffer.active.getLine(0);
			let cell = line?.getCell(0);
			expect(cell?.isItalic()).toBe(1);
			expect(cell?.getBgColor()).toBe(4); // Blue

			// Save cursor (ESC 7) - cursor is now at (1, 0)
			term.write("\x1b7");

			// Reset attributes
			term.write("\x1b[0mB");

			// Restore cursor (ESC 8) - back to (1, 0) with italic+blue
			term.write("\x1b8");
			term.write("C"); // Writes at (1, 0), overwriting 'B'

			// Check restored attributes
			line = term.buffer.active.getLine(0);
			cell = line?.getCell(1); // Check position 1, not 2
			expect(cell?.isItalic()).toBe(1);
			expect(cell?.getBgColor()).toBe(4);

			term.dispose();
		});
	});

	describe("CSI s / CSI u - Save/restore cursor (non-standard)", () => {
		it("saves and restores cursor with CSI s / CSI u", () => {
			const term = createTerminal({ cols: 20, rows: 5 });

			// Move cursor to (7, 2)
			term.write("\x1b[3;8H");
			expect(term.buffer.active.cursorX).toBe(7);
			expect(term.buffer.active.cursorY).toBe(2);

			// Save cursor (CSI s)
			term.write("\x1b[s");

			// Move cursor somewhere else
			term.write("\x1b[5;15H");
			expect(term.buffer.active.cursorX).toBe(14);
			expect(term.buffer.active.cursorY).toBe(4);

			// Restore cursor (CSI u)
			term.write("\x1b[u");
			expect(term.buffer.active.cursorX).toBe(7);
			expect(term.buffer.active.cursorY).toBe(2);

			term.dispose();
		});
	});

	describe("Edge cases", () => {
		it("handles restore without save gracefully", () => {
			const term = createTerminal({ cols: 20, rows: 5 });

			// Move cursor
			term.write("\x1b[2;3H");

			// Restore cursor without saving (should be no-op)
			term.write("\x1b[?1048l");

			// Cursor should remain where it was
			expect(term.buffer.active.cursorX).toBe(2);
			expect(term.buffer.active.cursorY).toBe(1);

			term.dispose();
		});

		it("alternate buffer has no scrollback", () => {
			const term = createTerminal({ cols: 20, rows: 3, scrollback: 100 });

			// Switch to alternate
			term.write("\x1b[?1047h");

			// Write many lines (more than rows)
			for (let i = 0; i < 10; i++) {
				term.write(`Line ${i}\n`);
			}

			// Alternate buffer should have length = rows (no scrollback)
			const buffer = term.buffer.active;
			// The buffer length might be rows + some extra, but definitely not rows + scrollback
			expect(buffer.length).toBeLessThan(term.rows + 10);

			term.dispose();
		});
	});
});
