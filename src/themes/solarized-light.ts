/**
 * Solarized Light — Ethan Schoonover
 *
 * Canonical palette from https://ethanschoonover.com/solarized/
 * In the light variant, the role of base03/base02 (background tones) and
 * base2/base3 (foreground tones) is swapped vs. Solarized Dark, but the
 * accent colors (yellow, orange, red, magenta, violet, blue, cyan, green)
 * are identical hex values.
 *
 * ANSI mapping (Solarized light spec):
 *   0  base2 (bg highlight, ANSI black)
 *   1  red
 *   2  green
 *   3  yellow
 *   4  blue
 *   5  magenta
 *   6  cyan
 *   7  base02 (body text, ANSI white)
 *   8  base3  (bg, bright black)
 *   9  orange (bright red)
 *   10 base1  (emphasized content, bright green)
 *   11 base0  (primary content, bright yellow)
 *   12 base00 (bright blue)
 *   13 violet (bright magenta)
 *   14 base01 (bright cyan)
 *   15 base03 (bright white)
 */
import type { BuiltinTheme } from "../types.js";

export const SOLARIZED_LIGHT: BuiltinTheme = {
	id: "solarized-light",
	name: "Solarized Light",
	ansi: [
		"#eee8d5", // 0  base2
		"#dc322f", // 1  red
		"#859900", // 2  green
		"#b58900", // 3  yellow
		"#268bd2", // 4  blue
		"#d33682", // 5  magenta
		"#2aa198", // 6  cyan
		"#073642", // 7  base02
		"#fdf6e3", // 8  base3  (bright black)
		"#cb4b16", // 9  orange (bright red)
		"#93a1a1", // 10 base1  (bright green)
		"#839496", // 11 base0  (bright yellow)
		"#657b83", // 12 base00 (bright blue)
		"#6c71c4", // 13 violet (bright magenta)
		"#586e75", // 14 base01 (bright cyan)
		"#002b36", // 15 base03 (bright white)
	],
	defaultFg: "#657b83", // base00 — primary body text on light bg
	defaultBg: "#fdf6e3", // base3  — background
	cursor: "#586e75", // base01
	selectionBg: "rgba(238, 232, 213, 0.7)", // base2 with alpha
};
