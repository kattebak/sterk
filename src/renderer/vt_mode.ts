/**
 * Custom Ace mode for VT terminal styling
 *
 * This mode tokenizes terminal lines based on SGR attributes (colors, bold, etc.)
 * instead of syntax highlighting rules. Each run of cells with identical attributes
 * becomes a single token with appropriate CSS class names.
 *
 * Design:
 * - Token classNames: "sterk-fg-N", "sterk-bg-N", "sterk-bold", "sterk-underline", etc.
 * - Palette colors (0-255): CSS classes injected by theme.ts
 * - Truecolor (24-bit RGB): CSS classes generated per color (cached)
 * - Inverse: swap fg/bg classes
 * - Dim: add "sterk-dim" class (rendered via opacity in CSS)
 *
 * IMPORTANT — Ace token-type wire format:
 * Ace's Text layer turns the token `type` field into a span className via
 *   `"ace_" + type.replace(/\./g, " ace_")`
 * (see ace-builds `src-noconflict/ace.js` ~L17554). That contract means:
 *   - A single `.` separates segments (each segment gets the `ace_` prefix).
 *   - Spaces are NOT treated as separators — they pass through literally,
 *     leaving everything after the first space without the `ace_` prefix.
 *
 * Sterk's CSS therefore targets the prefixed selectors (`.ace_sterk-fg-N`,
 * `.ace_sterk-bold`, …) and `buildCellClassName` joins segments with `.`,
 * not with a space. The bug shape this guards against: a space-joined
 * `"sterk-fg-1 sterk-bold"` would land in the DOM as
 * `class="ace_sterk-fg-1 sterk-bold"` — `sterk-bold` (no prefix) does not
 * match `.ace_sterk-bold` and SGR styling silently drops off the page
 * (mobux issue: colours + bolding missing on :5151).
 */

import type { Ace } from "ace-builds";
import type { BufferNamespaceImpl } from "../buffer/scroll_buffer.js";
import type { ScreenAttrs, ScreenColorMode } from "../view/screen_source.js";

/**
 * Token representing a run of cells with identical attributes
 */
export interface VtToken {
	type: string; // CSS class names (`.`-joined, see Ace wire-format note above)
	value: string; // Text content
}

/**
 * Custom Ace mode for VT terminal rendering
 */
export class VtMode {
	constructor(private bufferNamespace: BufferNamespaceImpl) {}

	/**
	 * Get Ace mode object
	 */
	getMode(): Ace.SyntaxMode {
		const bufferNamespace = this.bufferNamespace;
		// We walk the **cell grid** (not the line-text character stream) so
		// that wide-char placeholders contribute their empty `chars` and
		// combining-mark anchors contribute their multi-codepoint `chars`
		// ("é" = e + combining acute) in the right token. The line text Ace
		// holds is exactly the concatenation of `cell.chars` for all cells,
		// so joining `cell.chars` reproduces it byte-for-byte, with each char
		// attributed to the cell it came from.
		return createTokenMode((row) => {
			const buffer = bufferNamespace._getScrollBuffer();
			const line = buffer.getLine(row);
			if (!line) return [];
			const tokens: VtToken[] = [];
			let currentToken: VtToken | null = null;
			for (let col = 0; col < buffer.cols; col++) {
				const cell = line.getCell(col);
				const char = cell.getChars();
				// Placeholder cells (trailing half of a wide glyph) have
				// chars=""; the leading cell already wrote the glyph.
				if (char.length === 0) continue;
				const className = buildCellClassName(cell);
				if (currentToken && currentToken.type === className) {
					currentToken.value += char;
					continue;
				}
				currentToken = { type: className, value: char };
				tokens.push(currentToken);
			}
			return tokens;
		});
	}
}

/**
 * A minimal Ace mode whose tokenizer asks `lineTokens` for each row. Ace
 * handles the partial mode object fine at runtime, hence the cast.
 */
export function createTokenMode(
	lineTokens: (row: number) => VtToken[],
): Ace.SyntaxMode {
	return {
		createWorker: () => null,
		getTokenizer: () => ({
			getLineTokens: (lineText: string, _state: string, row: number) => {
				const tokens = lineTokens(row);
				return {
					tokens: tokens.length > 0 ? tokens : [{ type: "", value: lineText }],
					state: "start",
				};
			},
		}),
	} as unknown as Ace.SyntaxMode;
}

/**
 * Build CSS class name for a cell based on its attributes.
 *
 * Exported so the renderer can derive a per-row attribute *signature* from the
 * exact same logic that produces the rendered token classes. Computing the
 * signature any other way risks drift (a class change the signature misses →
 * stale DOM); reusing this function makes the signature correct by
 * construction — if the rendered class changes, the signature changes.
 */
export function buildCellClassName(
	cell: import("../types.js").BufferCell,
): string {
	return buildAttrsClassName({
		fgMode: cell.isFgDefault()
			? "Default"
			: cell.isFgPalette()
				? "Palette"
				: "Rgb",
		fg: cell.getFgColor(),
		bgMode: cell.isBgDefault()
			? "Default"
			: cell.isBgPalette()
				? "Palette"
				: "Rgb",
		bg: cell.getBgColor(),
		bold: cell.isBold(),
		italic: cell.isItalic(),
		underline: cell.isUnderline(),
		dim: cell.isDim(),
		inverse: cell.isInverse(),
		invisible: false,
		strikethrough: false,
		blink: false,
	});
}

const COLOR_MODE: Record<ScreenColorMode, number> = {
	Default: 0,
	Palette: 1,
	Rgb: 2,
};

/**
 * Build the token class name for a run's attributes. The single source of
 * the class names both the terminal renderer and the buffer view emit.
 */
export function buildAttrsClassName(attrs: ScreenAttrs): string {
	const classes: string[] = [];
	const fgColor = attrs.inverse ? attrs.bg : attrs.fg;
	const fgMode = COLOR_MODE[attrs.inverse ? attrs.bgMode : attrs.fgMode];
	const bgColor = attrs.inverse ? attrs.fg : attrs.bg;
	const bgMode = COLOR_MODE[attrs.inverse ? attrs.fgMode : attrs.bgMode];

	// Foreground color
	if (fgMode === 1) {
		// Palette color
		classes.push(`sterk-fg-${fgColor}`);
	} else if (fgMode === 2) {
		// Truecolor RGB
		classes.push(`sterk-fg-rgb-${fgColor.toString(16).padStart(6, "0")}`);
	}

	// Background color
	if (bgMode === 1) {
		// Palette color
		classes.push(`sterk-bg-${bgColor}`);
	} else if (bgMode === 2) {
		// Truecolor RGB
		classes.push(`sterk-bg-rgb-${bgColor.toString(16).padStart(6, "0")}`);
	}

	// Luminance-contrast fallback for the default fg over an explicit bg
	// (sterk parity item A3, referencing aceterm's `Aceterm.contrastFg`).
	//
	// When a cell has no SGR-assigned fg (fgMode === 0) but does have an
	// SGR-assigned bg (bgMode !== 0), the theme's default fg colour may
	// not be readable on that bg — e.g. theme fg `#000` over `\x1b[40m`
	// (black bg) renders black-on-black. Tagging the cell with
	// `sterk-fg-default` lets the theme's contrast-fallback CSS rules
	// override the colour when paired with an explicit bg class. The
	// bg-painting CSS rule wins on specificity for `background-color`
	// because it is unique; the contrast rule wins on `color` because it
	// is `.ace_sterk-bg-N.ace_sterk-fg-default { color: ... }` (two-class
	// selector beats the single-class default `.ace_editor { color: ... }`).
	if (fgMode === 0 && bgMode !== 0) {
		classes.push("sterk-fg-default");
	}

	// Text attributes
	if (attrs.bold) {
		classes.push("sterk-bold");
	}
	if (attrs.italic) {
		classes.push("sterk-italic");
	}
	if (attrs.underline) {
		classes.push("sterk-underline");
	}
	if (attrs.dim) {
		classes.push("sterk-dim");
	}
	if (attrs.strikethrough) {
		classes.push("sterk-strikethrough");
	}
	if (attrs.blink) {
		classes.push("sterk-blink");
	}
	if (attrs.invisible) {
		classes.push("sterk-invisible");
	}

	// Join with `.` (NOT space): Ace's text layer turns the token type into a
	// className via `"ace_" + type.replace(/\./g, " ace_")`, so each `.`
	// becomes the boundary between two `ace_`-prefixed classes. See the
	// "Ace token-type wire format" note in this file's header.
	return classes.join(".");
}
