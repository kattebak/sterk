/**
 * A3 — luminance-contrast fallback for default fg on explicit bg.
 *
 * Background: aceterm shipped `Aceterm.contrastFg(hex)` that picked a
 * readable default fg from the bg's relative luminance. Sterk inherited
 * neither the helper nor the behaviour, so any theme whose default fg
 * matches an explicit SGR bg (e.g. dark default fg + `\x1b[40m`) rendered
 * black-on-black. Mobux already hit this on real users — see PR #55 in
 * `mvhenten/mobux` and Row 21 of the sterk parity audit
 * (kattebak/sterk#21).
 *
 * The fix lives in two layers:
 *   1. `vt_mode.ts` tags every cell whose fg is "default" AND bg is
 *      "explicit" (SGR-set) with the marker class `sterk-fg-default`.
 *   2. `theme.ts` emits one CSS rule per palette-bg colour AND
 *      `injectTruecolorCss` emits one per truecolor-bg colour that
 *      overrides `color:` to the luminance-contrast pick. Selector
 *      specificity guarantees the rule wins over the editor-level
 *      `color: var(--sterk-fg)` default.
 *
 * These tests live in `test/integration/` (not in `test/`) because they
 * exercise the cross-module wiring (parser → buffer → renderer →
 * generated CSS), not any single function in isolation.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";
import { relativeLuminance } from "../../src/util/colors.js";

// ── DOM helpers ──────────────────────────────────────────────────────

/**
 * Resolve the live CSS `color` value that the browser would apply to
 * an element with `classes` inside `.ace_editor`. We construct a real
 * (off-screen) element, attach it to the document under `.ace_editor`,
 * then read `getComputedStyle`. happy-dom evaluates the rules sterk
 * injected via `applyTheme()`.
 *
 * The classes argument is the space-separated string that `vt_mode.ts`
 * emits for a cell — `sterk-bg-0 sterk-fg-default` for our default-fg
 * + explicit-bg case.
 */
function computedColorForCellClasses(
	container: HTMLElement,
	classes: string,
): string {
	const aceEditor = container.querySelector(".ace_editor");
	if (!aceEditor) throw new Error("renderer is not attached");
	const span = document.createElement("span");
	if (classes) span.className = classes;
	span.textContent = "x";
	aceEditor.appendChild(span);
	const colour = getComputedStyle(span).color;
	span.remove();
	return colour;
}

/**
 * Parse a CSS colour string (either `rgb(r, g, b)` or `#rrggbb`) into
 * a hex string the luminance helper accepts. Tolerant of `rgba(...)`
 * with an alpha component too (alpha ignored — the contrast question
 * is about the painted colour, which the renderer always emits opaque).
 *
 * happy-dom emits `rgb(r, g, b)` for hex inputs.
 */
function cssColorToHex(css: string): string {
	const m = css.match(/rgba?\((\d+)\D+(\d+)\D+(\d+)/);
	if (m && m[1] && m[2] && m[3]) {
		const r = Number(m[1]).toString(16).padStart(2, "0");
		const g = Number(m[2]).toString(16).padStart(2, "0");
		const b = Number(m[3]).toString(16).padStart(2, "0");
		return `#${r}${g}${b}`;
	}
	if (/^#[0-9a-f]{6}$/i.test(css)) return css.toLowerCase();
	throw new Error(`unrecognised CSS colour: ${css}`);
}

/**
 * WCAG contrast ratio between two relative luminances (already-resolved).
 * Result is in `[1, 21]` where `1` means identical colour, `21` means
 * `#000` vs `#fff`. The W3C readability floor is 3:1 for large text;
 * we assert >= 3 (which expressed as a luminance gap of (Lhi+0.05)/
 * (Llo+0.05) >= 3 maps to a luminance difference of at least ~0.3 in
 * the range where it matters for these tests — black-on-black would
 * give a ratio of 1 (instant failure), white-on-white the same).
 */
function contrastRatio(lumA: number, lumB: number): number {
	const hi = Math.max(lumA, lumB);
	const lo = Math.min(lumA, lumB);
	return (hi + 0.05) / (lo + 0.05);
}

// ── Tests ────────────────────────────────────────────────────────────

describe("A3 — luminance-contrast fallback for default fg on explicit bg", () => {
	let container: HTMLElement;

	beforeEach(() => {
		container = document.createElement("div");
		// Plausible viewport — values don't matter for CSS resolution
		// but the AceRenderer reads them on construction.
		container.style.width = "800px";
		container.style.height = "600px";
		document.body.appendChild(container);
	});

	afterEach(() => {
		container.remove();
		// Remove any theme/scrollbar/truecolor style nodes sterk injected
		// so each test starts clean. We match by id prefix to be robust
		// against new style nodes added by future renderer changes.
		for (const node of Array.from(
			document.head.querySelectorAll(
				"style#sterk-theme, style#sterk-scrollbar-hide, style#sterk-truecolor",
			),
		)) {
			node.remove();
		}
	});

	/**
	 * Theme whose default fg is dark (`#222`) over a deliberately dark
	 * theme background (`#1e1e1e`). With `\x1b[40m` (palette black) bg,
	 * the *theme's* default fg colour (`#222`) is near-invisible —
	 * exactly the mobux PR #55 case. The fallback rule must promote the
	 * fg to a light colour so the cell is readable.
	 */
	it("dark default fg over explicit dark bg (\\x1b[40m) -> readable contrast", () => {
		const term = createTerminal({
			cols: 20,
			rows: 5,
			theme: {
				foreground: "#222222", // dark default fg — the bug shape
				background: "#1e1e1e",
			},
		});
		term.open?.(container);

		// Sanity: the cell-class encoding produces `sterk-bg-0` for
		// `\x1b[40m`. We don't need to write anything to the buffer
		// because the resolution is purely CSS-driven from the classes
		// `vt_mode.ts` would emit for such a cell.
		const colour = computedColorForCellClasses(
			container,
			"sterk-bg-0 sterk-fg-default",
		);
		const fgHex = cssColorToHex(colour);
		const fgLum = relativeLuminance(fgHex);
		const bgLum = relativeLuminance("#000000"); // palette 0 = ANSI black

		expect(contrastRatio(fgLum, bgLum)).toBeGreaterThan(3);
		// The contrast pick for a dark bg is `#ffffff` per
		// `contrastFg` — defensive check that we actually got the
		// light side of the fallback.
		expect(fgHex).toBe("#ffffff");

		term.dispose();
	});

	/**
	 * Theme whose default fg is light (`#eeeeee`) over a deliberately
	 * light theme background. With `\x1b[47m` (palette white, `#e5e5e5`)
	 * bg, the *theme's* default fg is near-invisible. The fallback rule
	 * must promote the fg to a dark colour.
	 */
	it("light default fg over explicit light bg (\\x1b[47m) -> readable contrast", () => {
		const term = createTerminal({
			cols: 20,
			rows: 5,
			theme: {
				foreground: "#eeeeee", // light default fg — the inverse bug shape
				background: "#f5f5f5",
			},
		});
		term.open?.(container);

		const colour = computedColorForCellClasses(
			container,
			"sterk-bg-7 sterk-fg-default",
		);
		const fgHex = cssColorToHex(colour);
		const fgLum = relativeLuminance(fgHex);
		const bgLum = relativeLuminance("#e5e5e5"); // palette 7 = ANSI white

		expect(contrastRatio(fgLum, bgLum)).toBeGreaterThan(3);
		// The contrast pick for a light bg is `#000000`.
		expect(fgHex).toBe("#000000");

		term.dispose();
	});

	/**
	 * Default fg + default bg — no SGR bg was set. The fallback must
	 * NOT fire here; the cell must keep the theme's default fg. This
	 * guards against an over-eager rule that promotes fg colour for
	 * *every* default-fg cell (which would clobber the whole theme).
	 */
	it("default fg + default bg -> no fallback, theme fg preserved", () => {
		const term = createTerminal({
			cols: 20,
			rows: 5,
			theme: {
				foreground: "#d4d4d4",
				background: "#1e1e1e",
			},
		});
		term.open?.(container);

		// No bg class, no `sterk-fg-default` marker — a plain default
		// cell. `getComputedStyle` should report the theme default fg
		// (inherited via `.ace_editor { color: var(--sterk-fg) }`).
		const colour = computedColorForCellClasses(container, "");
		const fgHex = cssColorToHex(colour);
		expect(fgHex).toBe("#d4d4d4");

		term.dispose();
	});

	/**
	 * Explicit fg on explicit bg — fallback must NOT fire. If the user
	 * specifies both colours via SGR, we honour their pick verbatim
	 * even if the result has poor contrast. (Aceterm did the same;
	 * apps that care about contrast set both colours.)
	 */
	it("explicit fg + explicit bg -> fallback does not override the user's pick", () => {
		const term = createTerminal({
			cols: 20,
			rows: 5,
			theme: { foreground: "#d4d4d4", background: "#1e1e1e" },
		});
		term.open?.(container);

		// `sterk-fg-1 sterk-bg-0` = ANSI red on ANSI black. No
		// `sterk-fg-default` because the fg is SGR-set, so the rule
		// must not engage. The painted fg should be the palette red
		// (`#cd0000`).
		const colour = computedColorForCellClasses(
			container,
			"sterk-fg-1 sterk-bg-0",
		);
		const fgHex = cssColorToHex(colour);
		expect(fgHex).toBe("#cd0000");

		term.dispose();
	});

	/**
	 * Truecolor bg path: `\x1b[48;2;30;30;30m` (very dark RGB bg) plus
	 * default fg should still pick a light contrast colour. This
	 * exercises `injectTruecolorCss`, which is a *runtime* injection
	 * path distinct from the palette-bg rules generated by
	 * `generateAceThemeCss`.
	 */
	it("truecolor dark bg + default fg -> light contrast pick", () => {
		const term = createTerminal({
			cols: 20,
			rows: 5,
			theme: { foreground: "#202020", background: "#1e1e1e" },
		});
		term.open?.(container);

		// Drive the truecolor bg through the real parser so the
		// renderer's `injectTruecolorStyles()` runs and registers the
		// per-RGB CSS class (including the contrast rule). We need a
		// printed character so the buffer has a cell to scan.
		term.write("\x1b[48;2;30;30;30mX\x1b[m");

		// The truecolor injection runs lazily inside `scheduleUpdate`'s
		// rAF; flush by waiting one frame.
		return new Promise<void>((resolve) => {
			requestAnimationFrame(() => {
				const colour = computedColorForCellClasses(
					container,
					"sterk-bg-rgb-1e1e1e sterk-fg-default",
				);
				const fgHex = cssColorToHex(colour);
				expect(fgHex).toBe("#ffffff");
				expect(
					contrastRatio(relativeLuminance(fgHex), relativeLuminance("#1e1e1e")),
				).toBeGreaterThan(3);
				term.dispose();
				resolve();
			});
		});
	});
});
