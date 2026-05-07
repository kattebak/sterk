/**
 * XTerm 256-color palette utilities
 *
 * Implements the standard XTerm 256-color palette:
 * - Colors 0-15: Standard ANSI colors (8 base + 8 bright)
 * - Colors 16-231: 6×6×6 RGB color cube
 * - Colors 232-255: 24-step grayscale ramp
 *
 * Color cube formula and grayscale ramp values are derived from the XTerm
 * specification (public domain algorithm).
 *
 * References:
 * - https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
 * - https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit
 */

/**
 * Standard ANSI base colors (0-7) and bright variants (8-15).
 * These are the default XTerm palette values.
 */
export const ANSI_COLORS: readonly string[] = [
	// Base colors (0-7)
	"#000000", // black
	"#cd0000", // red
	"#00cd00", // green
	"#cdcd00", // yellow
	"#0000ee", // blue
	"#cd00cd", // magenta
	"#00cdcd", // cyan
	"#e5e5e5", // white

	// Bright colors (8-15)
	"#7f7f7f", // bright black (gray)
	"#ff0000", // bright red
	"#00ff00", // bright green
	"#ffff00", // bright yellow
	"#5c5cff", // bright blue
	"#ff00ff", // bright magenta
	"#00ffff", // bright cyan
	"#ffffff", // bright white
];

/**
 * RGB color value (0xRRGGBB format).
 */
export type RGB = number;

/**
 * XTerm palette index (0-255).
 */
export type PaletteIndex = number;

/**
 * Convert an RGB value to a CSS hex color string.
 *
 * @param rgb - RGB value in 0xRRGGBB format
 * @returns CSS hex color string (e.g., "#ff0000")
 */
export function rgbToHex(rgb: RGB): string {
	return `#${rgb.toString(16).padStart(6, "0")}`;
}

/**
 * Convert a CSS hex color string to an RGB value.
 *
 * @param hex - CSS hex color string (e.g., "#ff0000" or "ff0000")
 * @returns RGB value in 0xRRGGBB format
 */
export function hexToRgb(hex: string): RGB {
	const cleaned = hex.replace(/^#/, "");
	return Number.parseInt(cleaned, 16);
}

/**
 * Convert an XTerm palette index to an RGB value.
 *
 * Formula from XTerm specification:
 * - 0-15: ANSI colors (see ANSI_COLORS)
 * - 16-231: 6×6×6 RGB cube where each component maps [0-5] → [0, 95, 135, 175, 215, 255]
 * - 232-255: 24-step grayscale ramp from 0x08 to 0xEE
 *
 * @param index - Palette index (0-255)
 * @returns RGB value in 0xRRGGBB format
 */
export function paletteToRgb(index: PaletteIndex): RGB {
	// ANSI colors (0-15)
	if (index < 16) {
		return hexToRgb(ANSI_COLORS[index] ?? "#000000");
	}

	// 6×6×6 RGB cube (16-231)
	if (index < 232) {
		const cubeIndex = index - 16;
		const r = Math.floor(cubeIndex / 36);
		const g = Math.floor((cubeIndex % 36) / 6);
		const b = cubeIndex % 6;

		// Map [0-5] → [0, 95, 135, 175, 215, 255]
		const toRgbComponent = (v: number): number => {
			if (v === 0) return 0;
			return 55 + v * 40;
		};

		const red = toRgbComponent(r);
		const green = toRgbComponent(g);
		const blue = toRgbComponent(b);

		return (red << 16) | (green << 8) | blue;
	}

	// 24-step grayscale ramp (232-255)
	// Maps to 0x08, 0x12, 0x1c, ..., 0xee (step size 10)
	const gray = 8 + (index - 232) * 10;
	return (gray << 16) | (gray << 8) | gray;
}

/**
 * Convert an RGB value to the nearest XTerm palette index.
 *
 * This finds the palette color with the minimum Euclidean distance
 * in RGB color space.
 *
 * @param rgb - RGB value in 0xRRGGBB format
 * @returns Palette index (0-255)
 */
export function rgbToPalette(rgb: RGB): PaletteIndex {
	const r = (rgb >> 16) & 0xff;
	const g = (rgb >> 8) & 0xff;
	const b = rgb & 0xff;

	let bestIndex = 0;
	let bestDistance = Number.POSITIVE_INFINITY;

	for (let i = 0; i < 256; i++) {
		const paletteRgb = paletteToRgb(i);
		const pr = (paletteRgb >> 16) & 0xff;
		const pg = (paletteRgb >> 8) & 0xff;
		const pb = paletteRgb & 0xff;

		// Euclidean distance in RGB space
		const distance =
			(r - pr) * (r - pr) + (g - pg) * (g - pg) + (b - pb) * (b - pb);

		if (distance < bestDistance) {
			bestDistance = distance;
			bestIndex = i;
		}

		// Early exit if exact match
		if (distance === 0) break;
	}

	return bestIndex;
}

/**
 * Convert an XTerm palette index to a CSS hex color string.
 *
 * @param index - Palette index (0-255)
 * @returns CSS hex color string (e.g., "#ff0000")
 */
export function paletteToHex(index: PaletteIndex): string {
	return rgbToHex(paletteToRgb(index));
}

/**
 * Convert a CSS hex color string to the nearest XTerm palette index.
 *
 * @param hex - CSS hex color string (e.g., "#ff0000" or "ff0000")
 * @returns Palette index (0-255)
 */
export function hexToPalette(hex: string): PaletteIndex {
	return rgbToPalette(hexToRgb(hex));
}

/**
 * Build a full 256-color palette as an array of CSS hex strings.
 * Index i contains the hex color for palette color i.
 *
 * @returns Array of 256 CSS hex color strings
 */
export function buildPalette(): string[] {
	const palette: string[] = [];
	for (let i = 0; i < 256; i++) {
		palette.push(paletteToHex(i));
	}
	return palette;
}
