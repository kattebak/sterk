import { expect, test } from "@playwright/test";

/**
 * Font-coverage DOM assertions.
 *
 * Pixel-diff baselines on the font-rendering scenario will catch
 * stylistic regressions, but they happily go green when a glyph
 * silently falls back to the system `monospace`: at 14px with a 1%
 * threshold, a missing `─` rendered in the OS default looks
 * indistinguishable from one rendered in JetBrains Mono. PR #31's
 * `latin`-subset assets shipped exactly that bug and the baseline
 * machinery did not catch it.
 *
 * This spec is the deterministic check that does:
 *
 *  1. After `setFont(id)` and `document.fonts.ready`, the rendered
 *     cell's computed `font-family` MUST contain the requested family
 *     (i.e. the renderer applied the swap end-to-end).
 *  2. `document.fonts.check()` MUST report glyph coverage for every
 *     character in the "Claude TUI minimum" probe string under that
 *     family. This is the spec-defined "would a loaded face serve
 *     this?" question; it returns `false` if any code point would
 *     fall through to the generic `monospace` keyword.
 *  3. Box-drawing AND a heavy dingbat (✱ U+2731, missing from every
 *     vendored primary woff2) must BOTH pass — which only succeeds
 *     when the symbol-fallback `@font-face` declaration with
 *     `unicode-range` covering U+2700-27BF is wired up.
 *
 * If sterk regresses to the latin-only subset, every assertion in
 * this file will fire — instead of a 5-pixel difference no one looks
 * at on a hidden snapshot diff page.
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		setFont: (id: string) => Promise<void>;
		reset: () => Promise<void>;
		probeRenderedFontFamily: () => string | null;
		probeFontHasGlyph: (text: string) => boolean;
	};
};

const FONTS = [
	{ id: "jetbrains-mono", family: "JetBrains Mono" },
	{ id: "ibm-plex-mono", family: "IBM Plex Mono" },
	{ id: "cascadia-mono", family: "Cascadia Mono" },
	{ id: "fira-mono", family: "Fira Mono" },
	{ id: "source-code-pro", family: "Source Code Pro" },
] as const;

// Minimum "Claude TUI" glyph set. Every codepoint here MUST resolve to
// a loaded face (primary or symbol-fallback) under the active family.
// The mix is intentional: box-drawing (always in the primary subset),
// arrows (often in the primary), block elements (always primary), and
// heavy dingbats / geometric (almost never in the primary — these are
// the ones routed through Sterk TUI Symbols).
const TUI_GLYPHS = [
	"─", // U+2500 box drawing — primary
	"┌", // U+250C — primary
	"│", // U+2502 — primary
	"●", // U+25CF geometric — fallback for IBM Plex, primary for others
	"◆", // U+25C6 geometric
	"→", // U+2192 arrows — primary
	"✱", // U+2731 dingbats — fallback (missing from every primary)
	"✓", // U+2713 dingbats — fallback for some
	"✶", // U+2736 dingbats — fallback (missing from every primary)
	"➜", // U+279C dingbats — fallback (missing from every primary)
	"█", // U+2588 block elements — primary
	"▌", // U+258C block elements — primary
] as const;

test.describe("font: TUI glyph coverage DOM assertions", () => {
	for (const { id, family } of FONTS) {
		test(`${id} resolves every Claude TUI glyph to a loaded face`, async ({
			page,
		}) => {
			await page.goto("/test/visual/harness/index.html");
			await page.waitForFunction(
				() =>
					typeof (window as unknown as { __sterkTest?: unknown })
						.__sterkTest === "object",
			);
			await page.evaluate(
				() => (window as unknown as HarnessWindow).__sterkTest.ready,
			);
			await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.reset(),
			);

			await page.evaluate(
				(fontId) =>
					(window as unknown as HarnessWindow).__sterkTest.setFont(fontId),
				id,
			);

			// Feed a row so the Ace text layer has cells to measure.
			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				`probe ${TUI_GLYPHS.join("")}\r\n`,
			);

			// Wait for the font-face descriptors to fully resolve. Without
			// this, `fonts.check()` can race and return false for code
			// points the symbol-fallback face would otherwise serve.
			await page.evaluate(async () => {
				await document.fonts.ready;
			});

			// Assertion 1: computed font-family on the rendered text layer
			// contains the requested family — not bare `monospace`.
			const computed = await page.evaluate(() =>
				(
					window as unknown as HarnessWindow
				).__sterkTest.probeRenderedFontFamily(),
			);
			expect(
				computed,
				`expected rendered font-family to include "${family}", got: ${computed}`,
			).toContain(family);

			// Assertion 2: per-glyph, document.fonts.check() reports the
			// font system has a loaded face for this exact code point
			// under the active family. Tested one glyph at a time so the
			// failure message points at the specific missing range.
			for (const glyph of TUI_GLYPHS) {
				const has = await page.evaluate(
					(g) =>
						(window as unknown as HarnessWindow).__sterkTest.probeFontHasGlyph(
							g,
						),
					glyph,
				);
				expect(
					has,
					`document.fonts.check() reports no loaded face covers "${glyph}" (U+${glyph
						.codePointAt(0)
						?.toString(16)
						.toUpperCase()
						.padStart(
							4,
							"0",
						)}) under family "${family}". This means the glyph would fall back to the system 'monospace' default — exactly the PR #31 latin-subset regression.`,
				).toBe(true);
			}

			// Assertion 3: the entire payload also checks as a single
			// call. Belt-and-braces: if one of the individual asserts
			// flakes, this catches the aggregate failure mode.
			const allCovered = await page.evaluate(
				(g) =>
					(window as unknown as HarnessWindow).__sterkTest.probeFontHasGlyph(g),
				TUI_GLYPHS.join(""),
			);
			expect(allCovered).toBe(true);
		});
	}
});
