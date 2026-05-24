/**
 * Nord — Arctic, north-bluish color palette by Sven Greb / Arctic Ice Studio
 *
 * Canonical palette from https://www.nordtheme.com/docs/colors-and-palettes
 * (the four palette groups: Polar Night, Snow Storm, Frost, Aurora).
 *
 * Polar Night:  nord0  #2e3440  nord1  #3b4252  nord2  #434c5e  nord3  #4c566a
 * Snow Storm:   nord4  #d8dee9  nord5  #e5e9f0  nord6  #eceff4
 * Frost:        nord7  #8fbcbb  nord8  #88c0d0  nord9  #81a1c1  nord10 #5e81ac
 * Aurora:       nord11 #bf616a (red)    nord12 #d08770 (orange)
 *               nord13 #ebcb8b (yellow) nord14 #a3be8c (green)
 *               nord15 #b48ead (purple)
 *
 * ANSI mapping follows the official Nord port for xresources/iterm/etc.:
 *   https://github.com/arcticicestudio/nord-iterm2 — Nord.itermcolors
 */
import type { BuiltinTheme } from "../types.js";

export const NORD: BuiltinTheme = {
	id: "nord",
	name: "Nord",
	ansi: [
		"#3b4252", // 0  nord1  (ANSI black)
		"#bf616a", // 1  nord11 (red)
		"#a3be8c", // 2  nord14 (green)
		"#ebcb8b", // 3  nord13 (yellow)
		"#81a1c1", // 4  nord9  (blue)
		"#b48ead", // 5  nord15 (magenta / purple)
		"#88c0d0", // 6  nord8  (cyan)
		"#e5e9f0", // 7  nord5  (white)
		"#4c566a", // 8  nord3  (bright black)
		"#bf616a", // 9  nord11 (bright red)
		"#a3be8c", // 10 nord14 (bright green)
		"#ebcb8b", // 11 nord13 (bright yellow)
		"#81a1c1", // 12 nord9  (bright blue)
		"#b48ead", // 13 nord15 (bright magenta)
		"#8fbcbb", // 14 nord7  (bright cyan)
		"#eceff4", // 15 nord6  (bright white)
	],
	defaultFg: "#d8dee9", // nord4
	defaultBg: "#2e3440", // nord0
	cursor: "#d8dee9", // nord4
	selectionBg: "rgba(67, 76, 94, 0.7)", // nord2 with alpha
};
