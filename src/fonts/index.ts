/**
 * Built-in monospace fonts registry.
 *
 * Sterk vendors 5 open-source monospace fonts as `.woff2` assets under
 * `assets/fonts/` so consumers get good rendering out of the box without
 * having to wire `@font-face` themselves. The default (JetBrains Mono) is
 * applied automatically by the `Terminal` constructor; callers can swap
 * via `Terminal.setFont(id)` at runtime.
 *
 * Asset URLs are resolved through `new URL('../../assets/...', import.meta.url)`.
 * Both esbuild (used by Vite) and Rollup recognise this pattern at consumer
 * build time and inline the asset into the output bundle — sterk's own
 * `tsc` build leaves the URL constructor in place because it ships ESM and
 * the consumer's bundler does the asset-graph walk. This mirrors the
 * pattern documented in the Vite docs ("Static Asset Handling") and works
 * unmodified in Next.js / Astro / Rspack / Bun.
 *
 * Licenses (all SIL Open Font License 1.1): see `assets/fonts/LICENSES.txt`
 * for per-font attribution.
 */

/**
 * A vendored, bundled monospace font.
 *
 * `id` is the kebab-case key used for `Terminal.setFont(id)`. `family` is
 * the CSS `font-family` name the renderer applies (also the name of the
 * single `@font-face` rule sterk injects). `url` points at the woff2 asset;
 * the consumer's bundler resolves it at build time.
 */
export interface BuiltinFont {
	id: string;
	family: string;
	url: string;
}

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
 * monospace design for code), has a small woff2 (~12 KB latin subset), and
 * is OFL-1.1 — same compatibility envelope as the other four.
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
 * document head that contains one `@font-face` rule per font that has been
 * requested so far. Subsequent calls for the same family are a no-op; the
 * element is shared across every `Terminal` instance on the page.
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

	const rule = `${marker}
@font-face {
	font-family: '${font.family}';
	font-style: normal;
	font-weight: 400;
	font-display: swap;
	src: url('${font.url}') format('woff2');
}
`;
	style.textContent = `${style.textContent ?? ""}${rule}`;
}
