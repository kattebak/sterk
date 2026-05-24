import { expect, test } from "@playwright/test";

/**
 * D4 — Wide-and-combining-chars scenario, cycled across the 5 themes.
 *
 * Drives the renderer's cell-width path (`wc.js` parity, audit Row 33):
 *   - CJK ideographs (`中文`, U+4E2D + U+6587) — width-2 cells each.
 *   - Box-drawing chars (`─`, `│`, `┼`) — width-1 BMP non-ASCII.
 *   - Latin-with-combining-mark — base + COMBINING ACUTE ACCENT
 *     (`é` → "é") which must collapse to one cell, not two.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (D4, Row 33).
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

const PAYLOAD = [
	"\x1b[1mwide + combining\x1b[m",
	"cjk: 中文 ideographs",
	"box: ┌─┬─┐ │ │ │ └─┴─┘",
	"combining: é (precomposed é for compare)",
	"mixed: AB中文CD─EF",
	"",
].join("\r\n");

test.describe("D4 wide-and-combining-chars", () => {
	for (const id of THEMES) {
		test(`renders wide + combining glyphs in ${id}`, async ({ page }) => {
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
			expect(state.lines[0]).toContain("wide + combining");
			expect(state.lines[1]).toContain("中文");

			await expect(page).toHaveScreenshot(
				`wide-and-combining-chars-${id}.png`,
				{
					fullPage: true,
				},
			);
		});
	}
});
