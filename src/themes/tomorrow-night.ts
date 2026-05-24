/**
 * Tomorrow Night — Chris Kempson
 *
 * Canonical palette from the Tomorrow Theme repository:
 * https://github.com/chriskempson/tomorrow-theme  (Tomorrow Night variant,
 * `Tomorrow Night.itermcolors` and `vim/colors/Tomorrow-Night.vim`).
 *
 * This is the base16-compatible ANSI mapping (base16 "Tomorrow Night"
 * scheme by Chris Kempson). The 8 base colours are the "normal" set and
 * the bright variants reuse the same accent hexes with the foreground
 * tones swapped in for 8-15 positions (per the base16 convention).
 *
 * Base palette:
 *   background  #1d1f21
 *   current line #282a2e
 *   selection   #373b41
 *   foreground  #c5c8c6
 *   comment     #969896
 *   red         #cc6666
 *   orange      #de935f
 *   yellow      #f0c674
 *   green       #b5bd68
 *   aqua/cyan   #8abeb7
 *   blue        #81a2be
 *   purple      #b294bb
 *   brown       #a3685a
 */
import type { BuiltinTheme } from "../types.js";

export const TOMORROW_NIGHT: BuiltinTheme = {
	id: "tomorrow-night",
	name: "Tomorrow Night",
	ansi: [
		"#1d1f21", // 0  background    (ANSI black)
		"#cc6666", // 1  red
		"#b5bd68", // 2  green
		"#f0c674", // 3  yellow
		"#81a2be", // 4  blue
		"#b294bb", // 5  magenta (purple)
		"#8abeb7", // 6  cyan (aqua)
		"#c5c8c6", // 7  foreground    (ANSI white)
		"#969896", // 8  comment       (bright black)
		"#cc6666", // 9  bright red
		"#b5bd68", // 10 bright green
		"#f0c674", // 11 bright yellow
		"#81a2be", // 12 bright blue
		"#b294bb", // 13 bright magenta
		"#8abeb7", // 14 bright cyan
		"#ffffff", // 15 bright white
	],
	defaultFg: "#c5c8c6",
	defaultBg: "#1d1f21",
	cursor: "#c5c8c6",
	selectionBg: "rgba(55, 59, 65, 0.99)", // #373b41 — Tomorrow Night selection
};
