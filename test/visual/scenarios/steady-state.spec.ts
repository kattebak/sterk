import { expect, test } from "@playwright/test";

/**
 * D4 — Steady-state scenario, cycled across the 5 built-in themes.
 *
 * Boots the harness, feeds a fixed multi-line payload that exercises a
 * representative slice of the rendering surface (prompt-ish line, output
 * lines with colour, a wide CJK glyph for the cell-width edge case), and
 * captures a screenshot. This is the "nothing happening, all colour
 * landed, cursor parked" frame — the regression-anchor baseline for the
 * other scenarios to diverge from.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (D4).
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		setTheme: (id: string) => Promise<void>;
		dumpState: () => { lines: string[] };
	};
};

const THEMES = [
	"solarized-dark",
	"solarized-light",
	"tomorrow-night",
	"nord",
	"gruvbox-dark-soft",
] as const;

// One screen of mixed output. CJK ideograph (U+4E2D, "中") covers the
// width-2 cell path; `\r\n` between rows keeps each line on its own row.
//
// Extended SGR coverage (see sgr-colors-and-bold scenario for the
// dedicated regression baseline): includes red/green/yellow/blue palette
// fgs, bold + underline, AND a combined SGR (`1;33` = bold + yellow)
// because the original mobux ":5151 no colours, no bold" regression
// dropped specifically on multi-attribute cells where the renderer's
// class-joiner produced un-prefixed trailing classes. D4 missed it
// because the original payload only exercised single-attribute SGRs and
// the per-test 2% pixel-diff allowance absorbed the small "no-colour
// muted-theme palette" delta. Adding combined SGR + a bg cell raises
// the pixel surface enough that any future regression breaks the diff.
const PAYLOAD = [
	"\x1b[1muser@host\x1b[m:\x1b[34m~/work\x1b[m$ ls",
	"\x1b[32mREADME.md\x1b[m  \x1b[34msrc\x1b[m  \x1b[34mtest\x1b[m",
	"\x1b[33mwarn:\x1b[m something looks off",
	"\x1b[31m err\x1b[m \x1b[32m ok\x1b[m \x1b[1;33m bold-yellow\x1b[m \x1b[4mul\x1b[m \x1b[42m bg \x1b[m",
	"plain output line",
	"wide: 中 ideograph + ascii",
	"",
].join("\r\n");

test.describe("D4 steady-state", () => {
	for (const id of THEMES) {
		test(`renders the steady-state view in ${id}`, async ({ page }) => {
			await page.goto("/test/visual/harness/index.html");
			await page.waitForFunction(
				() =>
					typeof (window as unknown as { __sterkTest?: unknown })
						.__sterkTest === "object",
			);
			await page.evaluate(
				() => (window as unknown as HarnessWindow).__sterkTest.ready,
			);

			await page.evaluate(
				(themeId) =>
					(window as unknown as HarnessWindow).__sterkTest.setTheme(themeId),
				id,
			);
			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				PAYLOAD,
			);

			const state = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);
			expect(state.lines[0]).toContain("user@host");
			expect(state.lines[3]).toContain("bold-yellow");
			expect(state.lines[5]).toContain("中");

			await expect(page).toHaveScreenshot(`steady-state-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
