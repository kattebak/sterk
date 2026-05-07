/**
 * SGR (Select Graphic Rendition) attribute parser
 *
 * Implements CSI SGR sequences (CSI ... m) for text styling and colors.
 *
 * Supported attributes:
 * - 0: Reset all attributes
 * - 1: Bold
 * - 2: Dim
 * - 3: Italic
 * - 4: Underline
 * - 5: Blink (treated as bold for rendering)
 * - 7: Inverse/reverse video
 * - 8: Hidden (treated as dim)
 * - 9: Strikethrough (not yet supported, treated as underline)
 * - 22: Normal intensity (clear bold + dim)
 * - 23: Not italic
 * - 24: Not underline
 * - 27: Not inverse
 * - 28: Not hidden
 * - 30-37: Foreground ANSI colors (0-7)
 * - 38: Extended foreground color (256-color or truecolor)
 * - 39: Default foreground color
 * - 40-47: Background ANSI colors (0-7)
 * - 48: Extended background color (256-color or truecolor)
 * - 49: Default background color
 * - 90-97: Bright foreground colors (8-15)
 * - 100-107: Bright background colors (8-15)
 *
 * References:
 * - https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h3-Functions-using-CSI-_-ordered-by-the-final-character_s_
 * - ECMA-48 SGR specification
 */

import type { CellAttributes } from "../buffer/scroll_buffer.js";
import { DEFAULT_CELL_ATTRIBUTES } from "../buffer/scroll_buffer.js";

/**
 * Apply SGR parameters to current attributes
 *
 * @param params - Array of SGR parameter values
 * @param attrs - Current cell attributes to modify
 */
export function applySgr(params: number[][], attrs: CellAttributes): void {
	// Default to SGR 0 (reset) if no params
	if (params.length === 0 || params[0]?.length === 0) {
		resetAttrs(attrs);
		return;
	}

	let i = 0;
	while (i < params.length) {
		const paramGroup = params[i];
		if (!paramGroup || paramGroup.length === 0) {
			i++;
			continue;
		}

		const code = paramGroup[0] ?? 0;

		switch (code) {
			case 0: // Reset
				resetAttrs(attrs);
				break;

			case 1: // Bold
				attrs.bold = true;
				break;

			case 2: // Dim
				attrs.dim = true;
				break;

			case 3: // Italic
				attrs.italic = true;
				break;

			case 4: // Underline
				attrs.underline = true;
				break;

			case 5: // Blink (treat as bold for now)
				attrs.bold = true;
				break;

			case 7: // Inverse
				attrs.inverse = true;
				break;

			case 8: // Hidden (treat as dim)
				attrs.dim = true;
				break;

			case 9: // Strikethrough (treat as underline for now)
				attrs.underline = true;
				break;

			case 22: // Normal intensity (clear bold + dim)
				attrs.bold = false;
				attrs.dim = false;
				break;

			case 23: // Not italic
				attrs.italic = false;
				break;

			case 24: // Not underline
				attrs.underline = false;
				break;

			case 27: // Not inverse
				attrs.inverse = false;
				break;

			case 28: // Not hidden
				attrs.dim = false;
				break;

			// Foreground colors (30-37)
			case 30:
			case 31:
			case 32:
			case 33:
			case 34:
			case 35:
			case 36:
			case 37:
				attrs.fgMode = 1; // palette
				attrs.fgColor = code - 30;
				break;

			// Extended foreground color (38)
			case 38:
				i += applyExtendedColor(params, i, attrs, "fg");
				break;

			// Default foreground color (39)
			case 39:
				attrs.fgMode = 0;
				attrs.fgColor = -1;
				break;

			// Background colors (40-47)
			case 40:
			case 41:
			case 42:
			case 43:
			case 44:
			case 45:
			case 46:
			case 47:
				attrs.bgMode = 1; // palette
				attrs.bgColor = code - 40;
				break;

			// Extended background color (48)
			case 48:
				i += applyExtendedColor(params, i, attrs, "bg");
				break;

			// Default background color (49)
			case 49:
				attrs.bgMode = 0;
				attrs.bgColor = -1;
				break;

			// Bright foreground colors (90-97)
			case 90:
			case 91:
			case 92:
			case 93:
			case 94:
			case 95:
			case 96:
			case 97:
				attrs.fgMode = 1; // palette
				attrs.fgColor = code - 90 + 8; // Map to palette 8-15
				break;

			// Bright background colors (100-107)
			case 100:
			case 101:
			case 102:
			case 103:
			case 104:
			case 105:
			case 106:
			case 107:
				attrs.bgMode = 1; // palette
				attrs.bgColor = code - 100 + 8; // Map to palette 8-15
				break;

			// Unknown codes - ignore
			default:
				break;
		}

		i++;
	}
}

/**
 * Reset all attributes to defaults
 */
function resetAttrs(attrs: CellAttributes): void {
	attrs.fgMode = DEFAULT_CELL_ATTRIBUTES.fgMode;
	attrs.fgColor = DEFAULT_CELL_ATTRIBUTES.fgColor;
	attrs.bgMode = DEFAULT_CELL_ATTRIBUTES.bgMode;
	attrs.bgColor = DEFAULT_CELL_ATTRIBUTES.bgColor;
	attrs.bold = DEFAULT_CELL_ATTRIBUTES.bold;
	attrs.italic = DEFAULT_CELL_ATTRIBUTES.italic;
	attrs.underline = DEFAULT_CELL_ATTRIBUTES.underline;
	attrs.inverse = DEFAULT_CELL_ATTRIBUTES.inverse;
	attrs.dim = DEFAULT_CELL_ATTRIBUTES.dim;
}

/**
 * Apply extended color (256-color or truecolor)
 *
 * Extended color format:
 * - 38;5;n or 48;5;n: 256-color palette (n = 0-255)
 * - 38;2;r;g;b or 48;2;r;g;b: truecolor RGB (r, g, b = 0-255)
 *
 * @param params - All SGR params
 * @param index - Current index (pointing to 38 or 48)
 * @param attrs - Attributes to modify
 * @param target - "fg" or "bg"
 * @returns Number of additional params consumed
 */
function applyExtendedColor(
	params: number[][],
	index: number,
	attrs: CellAttributes,
	target: "fg" | "bg",
): number {
	// Need at least 2 more params: type (5 or 2) and value(s)
	if (index + 1 >= params.length) {
		return 0;
	}

	const typeParam = params[index + 1];
	if (!typeParam || typeParam.length === 0) {
		return 0;
	}

	const type = typeParam[0];

	// 256-color palette (38;5;n or 48;5;n)
	if (type === 5) {
		if (index + 2 >= params.length) {
			return 1;
		}

		const colorParam = params[index + 2];
		if (!colorParam || colorParam.length === 0) {
			return 2;
		}

		const color = colorParam[0] ?? 0;
		if (color < 0 || color > 255) {
			return 2;
		}

		if (target === "fg") {
			attrs.fgMode = 1; // palette
			attrs.fgColor = color;
		} else {
			attrs.bgMode = 1; // palette
			attrs.bgColor = color;
		}

		return 2;
	}

	// Truecolor RGB (38;2;r;g;b or 48;2;r;g;b)
	if (type === 2) {
		if (index + 4 >= params.length) {
			return 1;
		}

		const rParam = params[index + 2];
		const gParam = params[index + 3];
		const bParam = params[index + 4];

		if (
			!rParam ||
			rParam.length === 0 ||
			!gParam ||
			gParam.length === 0 ||
			!bParam ||
			bParam.length === 0
		) {
			return 4;
		}

		const r = Math.max(0, Math.min(255, rParam[0] ?? 0));
		const g = Math.max(0, Math.min(255, gParam[0] ?? 0));
		const b = Math.max(0, Math.min(255, bParam[0] ?? 0));

		const rgb = (r << 16) | (g << 8) | b;

		if (target === "fg") {
			attrs.fgMode = 2; // RGB
			attrs.fgColor = rgb;
		} else {
			attrs.bgMode = 2; // RGB
			attrs.bgColor = rgb;
		}

		return 4;
	}

	// Unknown extended color type - ignore
	return 1;
}
