/**
 * Solarized Dark — Ethan Schoonover
 *
 * Canonical palette from https://ethanschoonover.com/solarized/
 * (color table: "Solarized accent colors" + "Solarized base"). The 16
 * ANSI slots follow the xterm-color-table convention documented at the
 * same source ("Solarized dark/light terminal mapping").
 *
 * ANSI mapping (Solarized dark spec):
 *   0  base02 (bg highlight, ANSI black)
 *   1  red
 *   2  green
 *   3  yellow
 *   4  blue
 *   5  magenta
 *   6  cyan
 *   7  base2 (body text, ANSI white)
 *   8  base03 (bg, bright black)
 *   9  orange (bright red)
 *   10 base01 (emphasized content, bright green)
 *   11 base00 (primary content, bright yellow)
 *   12 base0  (bright blue)
 *   13 violet (bright magenta)
 *   14 base1  (bright cyan)
 *   15 base3  (bright white)
 *
 * Source palette base values:
 *   base03  #002b36, base02 #073642, base01 #586e75, base00 #657b83,
 *   base0   #839496, base1  #93a1a1, base2  #eee8d5, base3  #fdf6e3,
 *   yellow  #b58900, orange #cb4b16, red    #dc322f, magenta #d33682,
 *   violet  #6c71c4, blue   #268bd2, cyan   #2aa198, green  #859900
 */
import type { BuiltinTheme } from "../types.js";

export const SOLARIZED_DARK: BuiltinTheme = {
	id: "solarized-dark",
	name: "Solarized Dark",
	ansi: [
		"#073642", // 0  base02
		"#dc322f", // 1  red
		"#859900", // 2  green
		"#b58900", // 3  yellow
		"#268bd2", // 4  blue
		"#d33682", // 5  magenta
		"#2aa198", // 6  cyan
		"#eee8d5", // 7  base2
		"#002b36", // 8  base03 (bright black)
		"#cb4b16", // 9  orange (bright red)
		"#586e75", // 10 base01 (bright green)
		"#657b83", // 11 base00 (bright yellow)
		"#839496", // 12 base0  (bright blue)
		"#6c71c4", // 13 violet (bright magenta)
		"#93a1a1", // 14 base1  (bright cyan)
		"#fdf6e3", // 15 base3  (bright white)
	],
	defaultFg: "#839496", // base0  — primary body text on dark bg
	defaultBg: "#002b36", // base03 — background
	cursor: "#93a1a1", // base1
	selectionBg: "rgba(7, 54, 66, 0.7)", // base02 with alpha
};
