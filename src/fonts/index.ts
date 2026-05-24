/**
 * Built-in monospace fonts registry.
 *
 * Sterk vendors 5 open-source monospace fonts as `.woff2` assets under
 * `assets/fonts/` so consumers get good rendering out of the box without
 * having to wire `@font-face` themselves. The default (JetBrains Mono) is
 * applied automatically by the `Terminal` constructor; callers can swap
 * via `Terminal.setFont(id)` at runtime.
 *
 * The vendored woff2s are TUI-coverage subsets built from each upstream's
 * regular weight (Basic Latin + Latin-1/Ext-A, plus Box Drawing, Block
 * Elements, Geometric Shapes, Arrows, Dingbats, General Punctuation, and
 * Math Operators where the source has them). Sterk pairs every primary
 * family with a shared symbol-fallback face — `Sterk TUI Symbols`, a
 * renamed subset of DejaVu Sans Mono — declared at the same family name
 * but constrained via `unicode-range` to the symbol blocks. The browser
 * downloads it lazily and only consults it for code points the primary
 * font's cmap lacks (e.g. heavy dingbats like U+2731 ✱, U+2736 ✶, U+279C
 * ➜ — present in essentially no general-purpose monospace family).
 *
 * Asset URLs are resolved through `new URL('../../assets/...', import.meta.url)`.
 * Both esbuild (used by Vite) and Rollup recognise this pattern at consumer
 * build time and inline the asset into the output bundle — sterk's own
 * `tsc` build leaves the URL constructor in place because it ships ESM and
 * the consumer's bundler does the asset-graph walk. This mirrors the
 * pattern documented in the Vite docs ("Static Asset Handling") and works
 * unmodified in Next.js / Astro / Rspack / Bun.
 *
 * Licenses (primary fonts: SIL Open Font License 1.1; Sterk TUI Symbols:
 * Bitstream Vera license — see `assets/fonts/LICENSES.txt` for full
 * per-font attribution).
 */

/**
 * A vendored, bundled monospace font.
 *
 * `id` is the kebab-case key used for `Terminal.setFont(id)`. `family` is
 * the CSS `font-family` name the renderer applies (also the name of the
 * primary `@font-face` rule sterk injects). `url` points at the primary
 * woff2 asset; the consumer's bundler resolves it at build time.
 *
 * Backward-compat: `url` remains a single string so existing consumers
 * that read `BUILTIN_FONTS[id].url` keep working. The symbol-fallback
 * face is injected alongside by `injectFontFace()` and does not appear
 * here because it is shared across every primary family.
 */
export interface BuiltinFont {
	id: string;
	family: string;
	url: string;
}

/**
 * Shared symbol-fallback face. A subset of DejaVu Sans Mono (renamed per
 * the Bitstream Vera license; see `assets/fonts/LICENSES.txt`) covering
 * Arrows, Box Drawing, Block Elements, Geometric Shapes, and Dingbats.
 *
 * `injectFontFace()` emits one `@font-face` per primary family that
 * aliases this asset under the primary family name, restricted to the
 * symbol unicode-ranges. The browser then transparently sources symbol
 * glyphs from this file when the primary family lacks them — without
 * falling all the way back to the system monospace (which is exactly
 * what made PR #31's `latin`-only subsets render boxes as the OS
 * default).
 *
 * The same asset is shared across all 5 primary families, so the browser
 * downloads it at most once per page even if the user cycles every font.
 */
const SYMBOL_FALLBACK_URL = new URL(
	"../../assets/fonts/SterkTUISymbols.woff2",
	import.meta.url,
).href;

/**
 * Unicode ranges covered by the symbol-fallback face. Composed into one
 * CSS `unicode-range` declaration. We intentionally leave U+2200-22FF
 * (Math Operators) and U+2600-26FF (Misc Symbols) off this list so the
 * primary family wins for those when it has them — only the four blocks
 * that are routinely missing from monospace fonts (and that Claude Code
 * leans on) are routed through the fallback.
 */
const SYMBOL_UNICODE_RANGE =
	"U+2190-21FF, U+2500-257F, U+2580-259F, U+25A0-25FF, U+2700-27BF";

/**
 * Default font applied by the `Terminal` constructor when no `font` option
 * is supplied. JetBrains Mono is picked for its excellent on-screen
 * readability at small sizes and its familiarity to most developers.
 */
export const DEFAULT_FONT_ID = "jetbrains-mono";

/**
 * Registry of all bundled monospace fonts, keyed by id. Iteration order is
 * insertion order; consumers building a picker UI can `Object.values(BUILTIN_FONTS)`.
 *
 * Substitution note: there is no `@fontsource` package for Iosevka Term
 * (the canonical narrow-cell terminal font), so we substitute
 * **Source Code Pro** in the "narrow / phone-screen" slot. Source Code Pro
 * is one of the most condensed widely-available monospace fonts (Adobe's
 * monospace design for code) and is OFL-1.1 — same compatibility envelope
 * as the other four.
 */
export const BUILTIN_FONTS: Readonly<Record<string, BuiltinFont>> =
	Object.freeze({
		"jetbrains-mono": {
			id: "jetbrains-mono",
			family: "JetBrains Mono",
			url: new URL(
				"../../assets/fonts/JetBrainsMono-Regular.woff2",
				import.meta.url,
			).href,
		},
		"ibm-plex-mono": {
			id: "ibm-plex-mono",
			family: "IBM Plex Mono",
			url: new URL(
				"../../assets/fonts/IBMPlexMono-Regular.woff2",
				import.meta.url,
			).href,
		},
		"cascadia-mono": {
			id: "cascadia-mono",
			family: "Cascadia Mono",
			url: new URL(
				"../../assets/fonts/CascadiaMono-Regular.woff2",
				import.meta.url,
			).href,
		},
		"fira-mono": {
			id: "fira-mono",
			family: "Fira Mono",
			url: new URL("../../assets/fonts/FiraMono-Regular.woff2", import.meta.url)
				.href,
		},
		"source-code-pro": {
			id: "source-code-pro",
			family: "Source Code Pro",
			url: new URL(
				"../../assets/fonts/SourceCodePro-Regular.woff2",
				import.meta.url,
			).href,
		},
	});

/**
 * Look up a built-in font by id. Throws on unknown id with a message that
 * lists the registered ids — same shape as `getBuiltinTheme()` so typos
 * surface immediately.
 */
export function getBuiltinFont(id: string): BuiltinFont {
	const f = BUILTIN_FONTS[id];
	if (!f) {
		const known = Object.keys(BUILTIN_FONTS).join(", ");
		throw new Error(`Unknown built-in font id: "${id}". Known ids: ${known}.`);
	}
	return f;
}

/**
 * Lazily inject a single `<style id="sterk-fonts">` element into the
 * document head that contains the `@font-face` rules for every font that
 * has been requested so far. Subsequent calls for the same family are a
 * no-op; the element is shared across every `Terminal` instance on the
 * page.
 *
 * Two rules are emitted per primary family:
 *  1. The primary face — covers Latin + the TUI ranges the upstream
 *     monospace ships natively.
 *  2. A symbol-fallback face aliased under the same family name but
 *     restricted via `unicode-range` to Arrows / Box Drawing / Block
 *     Elements / Geometric Shapes / Dingbats. Backed by the shared
 *     `Sterk TUI Symbols` woff2 (DejaVu-derived). The browser only
 *     downloads this once per page and only consults it for the
 *     unicode-ranges declared.
 *
 * We inject lazily (per family, on first `setFont(id)` use) rather than
 * eagerly registering all five at construct time so a consumer that only
 * ever uses the default doesn't pay the cost of four extra `@font-face`
 * declarations the browser would otherwise consider for fallback.
 *
 * Headless-safe: a no-op if `document` is undefined.
 */
export function injectFontFace(font: BuiltinFont): void {
	if (typeof document === "undefined") return;

	const styleId = "sterk-fonts";
	let style = document.getElementById(styleId) as HTMLStyleElement | null;
	if (!style) {
		style = document.createElement("style");
		style.id = styleId;
		document.head.appendChild(style);
	}

	// Idempotent: if we already injected a rule for this family, skip.
	// We tag each rule with a comment marker so we can grep for it.
	const marker = `/* sterk-font:${font.id} */`;
	if (style.textContent?.includes(marker)) return;

	// Two faces per family: primary glyphs, then symbol fallback aliased
	// under the same family name. CSS resolves per-glyph: when the
	// browser needs a code point in `SYMBOL_UNICODE_RANGE` and the
	// primary woff2's cmap lacks it, it transparently uses the fallback
	// face. The marker covers both rules so re-injection stays
	// idempotent for the whole family.
	const rule = `${marker}
@font-face {
	font-family: '${font.family}';
	font-style: normal;
	font-weight: 400;
	font-display: swap;
	src: url('${font.url}') format('woff2');
}
@font-face {
	font-family: '${font.family}';
	font-style: normal;
	font-weight: 400;
	font-display: swap;
	src: url('${SYMBOL_FALLBACK_URL}') format('woff2');
	unicode-range: ${SYMBOL_UNICODE_RANGE};
}
`;
	style.textContent = `${style.textContent ?? ""}${rule}`;
}
