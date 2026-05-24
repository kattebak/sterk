import { describe, expect, it } from "vitest";
import {
	ANSI_COLORS,
	buildPalette,
	contrastFg,
	hexToPalette,
	hexToRgb,
	LUMINANCE_THRESHOLD,
	paletteToHex,
	paletteToRgb,
	relativeLuminance,
	rgbToHex,
	rgbToPalette,
} from "../src/util/colors.js";

describe("colors", () => {
	describe("ANSI_COLORS", () => {
		it("exports 16 ANSI colors", () => {
			expect(ANSI_COLORS).toHaveLength(16);
		});

		it("contains valid hex color strings", () => {
			for (const color of ANSI_COLORS) {
				expect(color).toMatch(/^#[0-9a-f]{6}$/i);
			}
		});

		it("has standard ANSI base colors", () => {
			expect(ANSI_COLORS[0]).toBe("#000000"); // black
			expect(ANSI_COLORS[1]).toBe("#cd0000"); // red
			expect(ANSI_COLORS[2]).toBe("#00cd00"); // green
			expect(ANSI_COLORS[7]).toBe("#e5e5e5"); // white
		});

		it("has bright variants", () => {
			expect(ANSI_COLORS[8]).toBe("#7f7f7f"); // bright black (gray)
			expect(ANSI_COLORS[9]).toBe("#ff0000"); // bright red
			expect(ANSI_COLORS[15]).toBe("#ffffff"); // bright white
		});
	});

	describe("rgbToHex", () => {
		it("converts RGB to hex", () => {
			expect(rgbToHex(0xff0000)).toBe("#ff0000");
			expect(rgbToHex(0x00ff00)).toBe("#00ff00");
			expect(rgbToHex(0x0000ff)).toBe("#0000ff");
		});

		it("pads with leading zeros", () => {
			expect(rgbToHex(0x000000)).toBe("#000000");
			expect(rgbToHex(0x000001)).toBe("#000001");
			expect(rgbToHex(0x000100)).toBe("#000100");
		});
	});

	describe("hexToRgb", () => {
		it("converts hex to RGB", () => {
			expect(hexToRgb("#ff0000")).toBe(0xff0000);
			expect(hexToRgb("#00ff00")).toBe(0x00ff00);
			expect(hexToRgb("#0000ff")).toBe(0x0000ff);
		});

		it("handles hex without # prefix", () => {
			expect(hexToRgb("ff0000")).toBe(0xff0000);
			expect(hexToRgb("abc123")).toBe(0xabc123);
		});

		it("round-trips with rgbToHex", () => {
			const rgb = 0x8b4513;
			expect(hexToRgb(rgbToHex(rgb))).toBe(rgb);
		});
	});

	describe("paletteToRgb", () => {
		it("returns ANSI colors for indexes 0-15", () => {
			expect(paletteToRgb(0)).toBe(0x000000); // black
			expect(paletteToRgb(1)).toBe(0xcd0000); // red
			expect(paletteToRgb(9)).toBe(0xff0000); // bright red
			expect(paletteToRgb(15)).toBe(0xffffff); // bright white
		});

		it("generates correct RGB cube values (16-231)", () => {
			// First cube color (0,0,0 in cube space) → RGB (0,0,0)
			expect(paletteToRgb(16)).toBe(0x000000);

			// Cube color (1,0,0) → RGB (95,0,0)
			expect(paletteToRgb(16 + 36)).toBe(0x5f0000);

			// Cube color (0,1,0) → RGB (0,95,0)
			expect(paletteToRgb(16 + 6)).toBe(0x005f00);

			// Cube color (0,0,1) → RGB (0,0,95)
			expect(paletteToRgb(16 + 1)).toBe(0x00005f);

			// Cube color (5,5,5) → RGB (255,255,255)
			expect(paletteToRgb(231)).toBe(0xffffff);
		});

		it("generates correct grayscale ramp (232-255)", () => {
			// First gray: 232 → 0x080808
			expect(paletteToRgb(232)).toBe(0x080808);

			// Mid gray: 244 → 0x808080
			expect(paletteToRgb(244)).toBe(0x808080);

			// Last gray: 255 → 0xeeeeee
			expect(paletteToRgb(255)).toBe(0xeeeeee);
		});
	});

	describe("rgbToPalette", () => {
		it("finds exact ANSI color matches", () => {
			expect(rgbToPalette(0x000000)).toBe(0); // black
			expect(rgbToPalette(0xcd0000)).toBe(1); // red
			expect(rgbToPalette(0xffffff)).toBeOneOf([15, 231]); // white (exists in both ANSI and cube)
		});

		it("finds exact cube color matches", () => {
			expect(rgbToPalette(0x5f0000)).toBe(52); // cube (1,0,0)
			expect(rgbToPalette(0x005f00)).toBe(22); // cube (0,1,0)
			expect(rgbToPalette(0x00005f)).toBe(17); // cube (0,0,1)
		});

		it("finds exact grayscale matches", () => {
			expect(rgbToPalette(0x080808)).toBe(232);
			expect(rgbToPalette(0x808080)).toBe(244);
			expect(rgbToPalette(0xeeeeee)).toBe(255);
		});

		it("approximates arbitrary RGB values", () => {
			// Orange-ish color should map to a cube color
			const orangeIndex = rgbToPalette(0xff8800);
			expect(orangeIndex).toBeGreaterThanOrEqual(16);
			expect(orangeIndex).toBeLessThan(232);

			// Very dark color should map to black or dark gray
			const darkIndex = rgbToPalette(0x0a0a0a);
			expect(darkIndex).toBeOneOf([0, 232, 233]);
		});

		it("round-trips with paletteToRgb for all palette colors", () => {
			for (let i = 0; i < 256; i++) {
				const rgb = paletteToRgb(i);
				const roundTrip = rgbToPalette(rgb);
				expect(paletteToRgb(roundTrip)).toBe(rgb);
			}
		});
	});

	describe("paletteToHex", () => {
		it("converts palette index to hex", () => {
			expect(paletteToHex(0)).toBe("#000000");
			expect(paletteToHex(1)).toBe("#cd0000");
			expect(paletteToHex(15)).toBe("#ffffff");
		});

		it("works for cube colors", () => {
			expect(paletteToHex(52)).toBe("#5f0000"); // cube (1,0,0)
		});

		it("works for grayscale colors", () => {
			expect(paletteToHex(232)).toBe("#080808");
			expect(paletteToHex(255)).toBe("#eeeeee");
		});
	});

	describe("hexToPalette", () => {
		it("converts hex to palette index", () => {
			expect(hexToPalette("#000000")).toBe(0);
			expect(hexToPalette("#cd0000")).toBe(1);
		});

		it("handles hex without # prefix", () => {
			expect(hexToPalette("000000")).toBe(0);
			expect(hexToPalette("ff0000")).toBeOneOf([9, 196]); // bright red or cube red
		});

		it("round-trips with paletteToHex", () => {
			for (let i = 0; i < 256; i++) {
				const hex = paletteToHex(i);
				const roundTrip = hexToPalette(hex);
				expect(paletteToHex(roundTrip)).toBe(hex);
			}
		});
	});

	describe("relativeLuminance", () => {
		it("returns 0 for pure black", () => {
			expect(relativeLuminance("#000000")).toBe(0);
		});

		it("returns 1 for pure white", () => {
			expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
		});

		it("orders primary saturated colors per Rec. 709 coefficients", () => {
			// Green is weighted highest (0.7152), red next (0.2126), blue lowest (0.0722)
			const r = relativeLuminance("#ff0000");
			const g = relativeLuminance("#00ff00");
			const b = relativeLuminance("#0000ff");
			expect(g).toBeGreaterThan(r);
			expect(r).toBeGreaterThan(b);
			expect(r).toBeCloseTo(0.2126, 3);
			expect(g).toBeCloseTo(0.7152, 3);
			expect(b).toBeCloseTo(0.0722, 3);
		});

		it("accepts hex without leading '#'", () => {
			expect(relativeLuminance("ffffff")).toBeCloseTo(1, 5);
			expect(relativeLuminance("000000")).toBe(0);
		});

		it("returns 0 for malformed input rather than NaN", () => {
			expect(relativeLuminance("#abc")).toBe(0);
			expect(relativeLuminance("")).toBe(0);
		});
	});

	describe("contrastFg", () => {
		it("picks dark fg over light backgrounds", () => {
			expect(contrastFg("#ffffff")).toBe("#000000"); // white
			expect(contrastFg("#e5e5e5")).toBe("#000000"); // ANSI white (7)
			expect(contrastFg("#cdcd00")).toBe("#000000"); // ANSI yellow
		});

		it("picks light fg over dark backgrounds", () => {
			expect(contrastFg("#000000")).toBe("#ffffff"); // black (ANSI 0)
			expect(contrastFg("#0000ee")).toBe("#ffffff"); // ANSI blue
			expect(contrastFg("#cd00cd")).toBe("#ffffff"); // ANSI magenta
		});

		it("threshold is exactly LUMINANCE_THRESHOLD (boundary defined)", () => {
			expect(LUMINANCE_THRESHOLD).toBeGreaterThan(0);
			expect(LUMINANCE_THRESHOLD).toBeLessThan(1);
		});
	});

	describe("buildPalette", () => {
		it("returns 256 colors", () => {
			const palette = buildPalette();
			expect(palette).toHaveLength(256);
		});

		it("contains valid hex strings", () => {
			const palette = buildPalette();
			for (const color of palette) {
				expect(color).toMatch(/^#[0-9a-f]{6}$/i);
			}
		});

		it("matches ANSI_COLORS for first 16 entries", () => {
			const palette = buildPalette();
			for (let i = 0; i < 16; i++) {
				expect(palette[i]).toBe(ANSI_COLORS[i]);
			}
		});

		it("returns consistent results", () => {
			const palette1 = buildPalette();
			const palette2 = buildPalette();
			expect(palette1).toEqual(palette2);
		});
	});
});
