/**
 * Theme mapping utilities
 *
 * Maps sterk Theme interface to Ace theme configuration and CSS variables.
 * Supports live theme swapping without reloading the editor.
 */

import type { Theme } from "../types.js";
import { buildPalette, contrastFg } from "../util/colors.js";

/**
 * Default theme colors if not specified
 */
export const DEFAULT_THEME: Required<
	Pick<
		Theme,
		| "foreground"
		| "background"
		| "cursor"
		| "cursorAccent"
		| "selectionBackground"
	>
> = {
	foreground: "#f0f0f0",
	background: "#1e1e1e",
	cursor: "#f0f0f0",
	cursorAccent: "#1e1e1e",
	selectionBackground: "rgba(58, 117, 175, 0.3)",
};

/**
 * Generate Ace theme CSS from a sterk Theme
 *
 * @param theme - Sterk theme configuration
 * @returns CSS string for Ace theme
 */
export function generateAceThemeCss(theme: Theme = {}): string {
	const fg = theme.foreground ?? DEFAULT_THEME.foreground;
	const bg = theme.background ?? DEFAULT_THEME.background;
	const cursor = theme.cursor ?? DEFAULT_THEME.cursor;
	const cursorAccent = theme.cursorAccent ?? DEFAULT_THEME.cursorAccent;
	const selection =
		theme.selectionBackground ?? DEFAULT_THEME.selectionBackground;

	// Build the 256-color palette, merging theme palette if provided
	const fullPalette = buildPalette();
	if (theme.palette) {
		for (let i = 0; i < Math.min(theme.palette.length, 16); i++) {
			const color = theme.palette[i];
			if (color) {
				fullPalette[i] = color;
			}
		}
	}

	// Handle individual ANSI color overrides from theme
	const ansiOverrides: Record<number, string> = {};
	if (theme.black) ansiOverrides[0] = theme.black;
	if (theme.red) ansiOverrides[1] = theme.red;
	if (theme.green) ansiOverrides[2] = theme.green;
	if (theme.yellow) ansiOverrides[3] = theme.yellow;
	if (theme.blue) ansiOverrides[4] = theme.blue;
	if (theme.magenta) ansiOverrides[5] = theme.magenta;
	if (theme.cyan) ansiOverrides[6] = theme.cyan;
	if (theme.white) ansiOverrides[7] = theme.white;
	if (theme.brightBlack) ansiOverrides[8] = theme.brightBlack;
	if (theme.brightRed) ansiOverrides[9] = theme.brightRed;
	if (theme.brightGreen) ansiOverrides[10] = theme.brightGreen;
	if (theme.brightYellow) ansiOverrides[11] = theme.brightYellow;
	if (theme.brightBlue) ansiOverrides[12] = theme.brightBlue;
	if (theme.brightMagenta) ansiOverrides[13] = theme.brightMagenta;
	if (theme.brightCyan) ansiOverrides[14] = theme.brightCyan;
	if (theme.brightWhite) ansiOverrides[15] = theme.brightWhite;

	for (const [index, color] of Object.entries(ansiOverrides)) {
		fullPalette[Number(index)] = color;
	}

	// Generate CSS custom properties for palette colors
	const paletteVars = fullPalette
		.map((color, index) => `  --sterk-palette-${index}: ${color};`)
		.join("\n");

	// Generate SGR styling rules for palette colors
	const fgPaletteRules = fullPalette
		.map(
			(color, index) =>
				`.ace_editor .sterk-fg-${index} { color: ${color} !important; }`,
		)
		.join("\n");

	const bgPaletteRules = fullPalette
		.map(
			(color, index) =>
				`.ace_editor .sterk-bg-${index} { background-color: ${color} !important; }`,
		)
		.join("\n");

	// Luminance-contrast fallback for default fg over explicit palette bg.
	// For each palette bg colour, emit a rule that overrides the colour
	// to the contrast pick (black or white) WHEN the cell has the
	// `sterk-fg-default` marker (i.e. no SGR fg + an explicit SGR bg).
	// Selector specificity: `.ace_editor .sterk-bg-N.sterk-fg-default`
	// beats the default colour rule `.ace_editor { color: var(--sterk-fg) }`
	// — same root `.ace_editor` with one extra class chain.
	const contrastPaletteRules = fullPalette
		.map(
			(color, index) =>
				`.ace_editor .sterk-bg-${index}.sterk-fg-default { color: ${contrastFg(color)} !important; }`,
		)
		.join("\n");

	return `
.sterk {
  --sterk-fg: ${fg};
  --sterk-bg: ${bg};
  --sterk-cursor: ${cursor};
  --sterk-cursor-accent: ${cursorAccent};
  --sterk-selection: ${selection};
${paletteVars}
}

.ace_editor {
  background-color: var(--sterk-bg);
  color: var(--sterk-fg);
}

.ace_cursor {
  border-left-color: var(--sterk-cursor);
  background-color: var(--sterk-cursor);
  color: var(--sterk-cursor-accent);
}

.ace_selection {
  background-color: var(--sterk-selection);
}

.ace_marker-layer .ace_selection {
  background-color: var(--sterk-selection);
}

/* SGR foreground palette colors (0-255) */
${fgPaletteRules}

/* SGR background palette colors (0-255) */
${bgPaletteRules}

/* Luminance-contrast fallback: default fg on explicit palette bg (A3) */
${contrastPaletteRules}

/* SGR text attributes */
.ace_editor .sterk-bold {
  font-weight: bold !important;
}

.ace_editor .sterk-italic {
  font-style: italic !important;
}

.ace_editor .sterk-underline {
  text-decoration: underline !important;
}

.ace_editor .sterk-dim {
  opacity: 0.5 !important;
}

/* Truecolor support: classes are injected dynamically per color */
`.trim();
}

/**
 * Inject theme CSS into the document
 *
 * @param css - Theme CSS string
 * @param id - Style element ID for reuse
 */
export function injectThemeCss(css: string, id = "sterk-theme"): void {
	// Remove existing theme style if present
	const existing = document.getElementById(id);
	if (existing) {
		existing.remove();
	}

	// Inject new theme
	const style = document.createElement("style");
	style.id = id;
	style.textContent = css;
	document.head.appendChild(style);
}

/**
 * Apply a theme to the terminal
 *
 * @param theme - Sterk theme configuration
 */
export function applyTheme(theme: Theme): void {
	const css = generateAceThemeCss(theme);
	injectThemeCss(css);
}

/**
 * Cache of injected truecolor CSS classes
 */
const truecolorCache = new Set<string>();

/**
 * Reset the truecolor CSS cache and tear down the injected stylesheet.
 *
 * Used by `setTheme()` so that a runtime swap doesn't leave behind
 * truecolor rules computed against the previous palette's contrast
 * fallback. The renderer re-injects truecolor rules lazily on the next
 * `scheduleUpdate()` flush as cells are scanned.
 */
export function clearTruecolorCache(): void {
	truecolorCache.clear();
	if (typeof document === "undefined") return;
	const existing = document.getElementById("sterk-truecolor");
	if (existing) existing.remove();
}

/**
 * Inject CSS for a truecolor RGB value (24-bit)
 *
 * @param rgb - RGB value (0xRRGGBB)
 * @param target - "fg" or "bg"
 */
export function injectTruecolorCss(rgb: number, target: "fg" | "bg"): void {
	const hex = rgb.toString(16).padStart(6, "0");
	const className = `sterk-${target}-rgb-${hex}`;

	// Skip if already injected
	if (truecolorCache.has(className)) {
		return;
	}

	truecolorCache.add(className);

	// Convert RGB to CSS hex color
	const color = `#${hex}`;

	// Inject CSS rule. For bg classes we additionally emit the
	// default-fg luminance-contrast fallback (A3): when a cell has no
	// SGR fg and this RGB bg, force fg to the contrast pick. Matches
	// the palette-bg path in `generateAceThemeCss`.
	const baseCss =
		target === "fg"
			? `.ace_editor .${className} { color: ${color} !important; }`
			: `.ace_editor .${className} { background-color: ${color} !important; }`;
	const css =
		target === "bg"
			? `${baseCss}\n.ace_editor .${className}.sterk-fg-default { color: ${contrastFg(color)} !important; }`
			: baseCss;

	// Find or create truecolor style element
	let styleEl = document.getElementById(
		"sterk-truecolor",
	) as HTMLStyleElement | null;
	if (!styleEl) {
		styleEl = document.createElement("style");
		styleEl.id = "sterk-truecolor";
		document.head.appendChild(styleEl);
	}

	// Append rule
	styleEl.textContent += `\n${css}`;
}
