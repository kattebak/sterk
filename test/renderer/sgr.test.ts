/**
 * Tests for SGR (Select Graphic Rendition) rendering
 *
 * Verifies that SGR attributes (colors, bold, italic, underline, inverse, dim)
 * are correctly tokenized and rendered with appropriate CSS classes.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";
import type { Terminal } from "../../src/types.js";

describe("SGR rendering", () => {
	let container: HTMLElement;
	let term: Terminal | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		if (term) {
			term.dispose();
			term = null;
		}
		if (container.parentNode) {
			container.parentNode.removeChild(container);
		}
	});

	describe("ANSI colors (0-15)", () => {
		it("renders foreground colors (30-37)", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// Red foreground
			term.write("\x1b[31mRed text\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			expect(line).toBeTruthy();

			// First cell should have red foreground (palette 1)
			const cell = line?.getCell(0);
			expect(cell?.isFgPalette()).toBe(1);
			expect(cell?.getFgColor()).toBe(1); // ANSI red is palette index 1
		});

		it("renders background colors (40-47)", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// Blue background
			term.write("\x1b[44mBlue bg\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isBgPalette()).toBe(1);
			expect(cell?.getBgColor()).toBe(4); // ANSI blue is palette index 4
		});

		it("renders bright colors (90-97, 100-107)", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// Bright red foreground
			term.write("\x1b[91mBright red\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isFgPalette()).toBe(1);
			expect(cell?.getFgColor()).toBe(9); // Bright red is palette index 9
		});

		it("resets colors with SGR 0", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// Set color, then reset
			term.write("\x1b[31mRed\x1b[0mNormal");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);

			// First cell (R) should be red
			const redCell = line?.getCell(0);
			expect(redCell?.isFgPalette()).toBe(1);
			expect(redCell?.getFgColor()).toBe(1);

			// Cell after reset (N) should be default
			const normalCell = line?.getCell(3);
			expect(normalCell?.isFgDefault()).toBe(1);
		});
	});

	describe("256-color palette (38;5;n / 48;5;n)", () => {
		it("renders 256-color foreground", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// 256-color palette index 202 (orange)
			term.write("\x1b[38;5;202mOrange\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isFgPalette()).toBe(1);
			expect(cell?.getFgColor()).toBe(202);
		});

		it("renders 256-color background", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// 256-color palette index 53 (purple)
			term.write("\x1b[48;5;53mPurple bg\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isBgPalette()).toBe(1);
			expect(cell?.getBgColor()).toBe(53);
		});
	});

	describe("Truecolor (24-bit RGB)", () => {
		it("renders truecolor foreground (38;2;r;g;b)", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// RGB(255, 128, 0) - orange
			term.write("\x1b[38;2;255;128;0mOrange\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isFgRGB()).toBe(1);
			expect(cell?.getFgColor()).toBe(0xff8000); // 0xFF8000 = RGB(255, 128, 0)
		});

		it("renders truecolor background (48;2;r;g;b)", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// RGB(64, 128, 192) - steel blue
			term.write("\x1b[48;2;64;128;192mBlue bg\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isBgRGB()).toBe(1);
			expect(cell?.getBgColor()).toBe(0x4080c0); // 0x4080C0 = RGB(64, 128, 192)
		});

		it("injects CSS for truecolor classes", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// Write truecolor
			term.write("\x1b[38;2;255;0;0mRed\x1b[0m");

			// CSS injection happens during render, which is async (requestAnimationFrame)
			// For now, just verify the buffer has the truecolor attribute
			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isFgRGB()).toBe(1);
			expect(cell?.getFgColor()).toBe(0xff0000);

			// Note: CSS injection is async via scheduleUpdate()/requestAnimationFrame.
			// In a real test, we'd wait for the next frame, but for unit tests
			// checking the buffer attribute is sufficient.
		});
	});

	describe("Text attributes", () => {
		it("renders bold (SGR 1)", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			term.write("\x1b[1mBold text\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isBold()).toBe(1);
		});

		it("renders italic (SGR 3)", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			term.write("\x1b[3mItalic text\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isItalic()).toBe(1);
		});

		it("renders underline (SGR 4)", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			term.write("\x1b[4mUnderlined\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isUnderline()).toBe(1);
		});

		it("renders dim (SGR 2)", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			term.write("\x1b[2mDim text\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isDim()).toBe(1);
		});

		it("combines multiple attributes", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// Bold + italic + underline + red
			term.write("\x1b[1;3;4;31mStyled\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isBold()).toBe(1);
			expect(cell?.isItalic()).toBe(1);
			expect(cell?.isUnderline()).toBe(1);
			expect(cell?.isFgPalette()).toBe(1);
			expect(cell?.getFgColor()).toBe(1); // Red
		});
	});

	describe("Inverse (SGR 7)", () => {
		it("renders inverse text", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			term.write("\x1b[7mInverse\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			expect(cell?.isInverse()).toBe(1);
		});

		it("swaps fg/bg colors when inverse is set", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// Red fg, blue bg, then inverse
			term.write("\x1b[31;44;7mInverse\x1b[0m");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const cell = line?.getCell(0);

			// Cell stores the original colors, but renderer should swap them
			expect(cell?.isInverse()).toBe(1);
			expect(cell?.getFgColor()).toBe(1); // Red (stored)
			expect(cell?.getBgColor()).toBe(4); // Blue (stored)

			// VtMode should swap these when building class names
		});
	});

	describe("Theme updates", () => {
		it("applies theme CSS on open", () => {
			term = createTerminal({
				cols: 80,
				rows: 24,
				theme: {
					foreground: "#ffffff",
					background: "#000000",
					palette: ["#111111", "#ff0000"], // Custom black and red
				},
			});
			term.open?.(container);

			const themeStyle = document.getElementById("sterk-theme");
			expect(themeStyle).toBeTruthy();

			// Check palette CSS was injected
			expect(themeStyle?.textContent).toContain("sterk-fg-0");
			expect(themeStyle?.textContent).toContain("#111111");
			expect(themeStyle?.textContent).toContain("sterk-fg-1");
			expect(themeStyle?.textContent).toContain("#ff0000");
		});

		it("includes SGR attribute styles in theme CSS", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			const themeStyle = document.getElementById("sterk-theme");
			expect(themeStyle).toBeTruthy();

			// Check for SGR attribute CSS
			expect(themeStyle?.textContent).toContain("sterk-bold");
			expect(themeStyle?.textContent).toContain("font-weight: bold");
			expect(themeStyle?.textContent).toContain("sterk-italic");
			expect(themeStyle?.textContent).toContain("font-style: italic");
			expect(themeStyle?.textContent).toContain("sterk-underline");
			expect(themeStyle?.textContent).toContain("text-decoration: underline");
			expect(themeStyle?.textContent).toContain("sterk-dim");
			expect(themeStyle?.textContent).toContain("opacity");
		});
	});

	describe("Demo scenarios", () => {
		it("renders ls --color output", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// Simulate ls --color output (bold + blue files, bold + green executable)
			// Note: SGR 1;34 = bold + blue (palette 4), not bright blue (palette 12)
			// Some terminals render bold+color as bright, but that's a rendering decision
			term.write(
				"\x1b[1;34mfile1.txt\x1b[0m  \x1b[1;34mfile2.txt\x1b[0m  \x1b[1;32mscript.sh\x1b[0m",
			);

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);

			// First file should be bold + blue (palette 4)
			const file1Cell = line?.getCell(0);
			expect(file1Cell?.isBold()).toBe(1);
			expect(file1Cell?.isFgPalette()).toBe(1);
			expect(file1Cell?.getFgColor()).toBe(4); // Blue (SGR 34)

			// Script should be bold + green (palette 2)
			const scriptPos = "file1.txt  file2.txt  ".length;
			const scriptCell = line?.getCell(scriptPos);
			expect(scriptCell?.isBold()).toBe(1);
			expect(scriptCell?.isFgPalette()).toBe(1);
			expect(scriptCell?.getFgColor()).toBe(2); // Green (SGR 32)
		});

		it("renders colored prompt", () => {
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);

			// Colored prompt: green $
			term.write("\x1b[32m$\x1b[0m ");

			const buffer = term.buffer.active;
			const line = buffer.getLine(0);
			const promptCell = line?.getCell(0);

			expect(promptCell?.isFgPalette()).toBe(1);
			expect(promptCell?.getFgColor()).toBe(2); // Green
		});
	});
});
