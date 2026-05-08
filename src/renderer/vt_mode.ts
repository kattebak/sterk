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
 */

import type { Ace } from "ace-builds";
import type { ScrollBuffer } from "../buffer/scroll_buffer.js";

/**
 * Token representing a run of cells with identical attributes
 */
interface VtToken {
	type: string; // CSS class names (space-separated)
	value: string; // Text content
}

/**
 * Custom Ace mode for VT terminal rendering
 */
export class VtMode {
	private buffer: ScrollBuffer;

	constructor(buffer: ScrollBuffer, _cols: number) {
		this.buffer = buffer;
	}

	/**
	 * Get Ace mode object
	 */
	getMode(): Ace.SyntaxMode {
		const buffer = this.buffer;

		// Return a minimal mode object. TypeScript doesn't like partial modes,
		// but Ace handles them fine at runtime. Cast through unknown to bypass.
		return {
			// Suppress Ace worker creation (VT mode doesn't need background processing)
			createWorker: () => null,

			getTokenizer: () => {
				return {
					// Ace calls getLineTokens for each visible line
					getLineTokens: (lineText: string, _state: string, row: number) => {
						const tokens: VtToken[] = [];
						const line = buffer.getLine(row);

						if (!line) {
							// Empty line
							return {
								tokens: [{ type: "", value: lineText }],
								state: "start",
							};
						}

						// Group cells by attributes
						let currentToken: VtToken | null = null;
						const cols = lineText.length;

						for (let col = 0; col < cols; col++) {
							const cell = line.getCell(col);
							const char = cell.getChars();
							const className = buildCellClassName(cell);

							if (
								currentToken &&
								currentToken.type === className &&
								currentToken.value.length < lineText.length
							) {
								// Extend current token
								currentToken.value += char;
							} else {
								// Start new token
								if (currentToken) {
									tokens.push(currentToken);
								}
								currentToken = {
									type: className,
									value: char,
								};
							}
						}

						if (currentToken) {
							tokens.push(currentToken);
						}

						return {
							tokens:
								tokens.length > 0 ? tokens : [{ type: "", value: lineText }],
							state: "start",
						};
					},
				};
			},
		} as unknown as Ace.SyntaxMode;
	}
}

/**
 * Build CSS class name for a cell based on its attributes
 */
function buildCellClassName(cell: import("../types.js").BufferCell): string {
	const classes: string[] = [];

	// Determine fg/bg colors (handle inverse)
	let fgColor = -1;
	let fgMode = 0;
	let bgColor = -1;
	let bgMode = 0;

	if (cell.isInverse()) {
		// Swap fg and bg
		fgColor = cell.getBgColor();
		fgMode = cell.isBgDefault() ? 0 : cell.isBgPalette() ? 1 : 2;
		bgColor = cell.getFgColor();
		bgMode = cell.isFgDefault() ? 0 : cell.isFgPalette() ? 1 : 2;
	} else {
		fgColor = cell.getFgColor();
		fgMode = cell.isFgDefault() ? 0 : cell.isFgPalette() ? 1 : 2;
		bgColor = cell.getBgColor();
		bgMode = cell.isBgDefault() ? 0 : cell.isBgPalette() ? 1 : 2;
	}

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

	// Text attributes
	if (cell.isBold()) {
		classes.push("sterk-bold");
	}
	if (cell.isItalic()) {
		classes.push("sterk-italic");
	}
	if (cell.isUnderline()) {
		classes.push("sterk-underline");
	}
	if (cell.isDim()) {
		classes.push("sterk-dim");
	}

	return classes.join(" ");
}
