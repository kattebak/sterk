/**
 * Gruvbox Dark (soft contrast) — Pavel Pertsev (morhetz)
 *
 * Canonical palette from https://github.com/morhetz/gruvbox
 * (color table in the README, "Gruvbox palette" section). The soft
 * contrast variant uses `bg0_s` (#32302f) as the background — between
 * the hard (#1d2021) and medium (#282828) bgs.
 *
 * Source palette (Gruvbox dark, foregrounds + accents):
 *   bg0_h #1d2021  bg0   #282828  bg0_s #32302f  bg1 #3c3836
 *   bg2   #504945  bg3   #665c54  bg4   #7c6f64
 *   fg0   #fbf1c7  fg1   #ebdbb2  fg2   #d5c4a1  fg3 #bdae93  fg4 #a89984
 *   red    #cc241d  bright_red    #fb4934
 *   green  #98971a  bright_green  #b8bb26
 *   yellow #d79921  bright_yellow #fabd2f
 *   blue   #458588  bright_blue   #83a598
 *   purple #b16286  bright_purple #d3869b
 *   aqua   #689d6a  bright_aqua   #8ec07c
 *   orange #d65d0e  bright_orange #fe8019
 *   gray   #928374
 *
 * ANSI mapping follows the official Gruvbox port for iTerm/xresources
 * (https://github.com/morhetz/gruvbox-contrib).
 */
import type { BuiltinTheme } from "../types.js";

export const GRUVBOX_DARK_SOFT: BuiltinTheme = {
	id: "gruvbox-dark-soft",
	name: "Gruvbox Dark Soft",
	ansi: [
		"#32302f", // 0  bg0_s    (ANSI black — soft dark bg)
		"#cc241d", // 1  red
		"#98971a", // 2  green
		"#d79921", // 3  yellow
		"#458588", // 4  blue
		"#b16286", // 5  magenta (purple)
		"#689d6a", // 6  cyan (aqua)
		"#a89984", // 7  fg4   (light gray foreground tone, ANSI white)
		"#928374", // 8  gray  (bright black)
		"#fb4934", // 9  bright red
		"#b8bb26", // 10 bright green
		"#fabd2f", // 11 bright yellow
		"#83a598", // 12 bright blue
		"#d3869b", // 13 bright magenta
		"#8ec07c", // 14 bright cyan
		"#ebdbb2", // 15 fg1  (bright white)
	],
	defaultFg: "#ebdbb2", // fg1   — primary text on dark gruvbox bgs
	defaultBg: "#32302f", // bg0_s — soft contrast background
	cursor: "#ebdbb2",
	selectionBg: "rgba(80, 73, 69, 0.7)", // bg2 with alpha
};
