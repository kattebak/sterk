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

/**
 * Compute the relative luminance of an sRGB color per WCAG 2 / Rec. 709.
 *
 * Accepts CSS-style hex strings (`#rrggbb` or `rrggbb`); returns a value in
 * `[0, 1]` where `0` is pure black and `1` is pure white.
 *
 * Reference: https://www.w3.org/TR/WCAG20-TECHS/G18.html
 *
 * @param hex - CSS hex color string (e.g. `"#1e1e1e"`)
 * @returns Relative luminance in `[0, 1]`
 */
export function relativeLuminance(hex: string): number {
	const cleaned = hex.replace(/^#/, "");
	if (cleaned.length < 6) return 0;

	const parse = (i: number): number =>
		Number.parseInt(cleaned.slice(i, i + 2), 16) / 255;

	// Linearize each sRGB component (gamma-correct -> linear)
	const lin = (c: number): number =>
		c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

	const r = lin(parse(0));
	const g = lin(parse(2));
	const b = lin(parse(4));

	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Threshold for picking a light vs dark default fg against an explicit bg.
 *
 * Tuned to match the original aceterm value (PR #55 era). A bg with
 * `relativeLuminance >= LUMINANCE_THRESHOLD` is considered "light" — we
 * render dark default fg over it; below that gets a light default fg.
 *
 * The textbook midpoint is `0.5`; aceterm shipped `0.4` so that the
 * base16-tomorrow bright bgs (green/cyan at ~0.46-0.47) sit on the
 * "dark fg" side rather than the "light fg" side, which matched human
 * judgement on those palettes.
 */
export const LUMINANCE_THRESHOLD = 0.4;

/**
 * Pick a readable default foreground color for an explicit background.
 *
 * Returns `"#000000"` if the background's luminance is at or above the
 * threshold (light bg → dark fg), otherwise `"#ffffff"` (dark bg →
 * light fg). This is the sterk equivalent of aceterm's `contrastFg`
 * helper and exists to prevent black-on-black / white-on-white renders
 * when an explicit SGR bg is paired with the theme's default fg.
 *
 * @param hex - CSS hex color string of the explicit background
 * @returns `"#000000"` or `"#ffffff"`
 */
export function contrastFg(hex: string): string {
	return relativeLuminance(hex) >= LUMINANCE_THRESHOLD ? "#000000" : "#ffffff";
}
