import { expect, test } from "@playwright/test";

/**
 * D4 — After-container-resize scenario, cycled across the 5 themes.
 *
 * Boots the harness at the default 80×24 grid, feeds a fixed payload,
 * then calls `term.resize(cols, rows)` to shrink to a smaller grid
 * (60×16). The screenshot captures the post-settle frame so future
 * regressions in `editor.resize()` / buffer reflow / re-paint are caught.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (D4).
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		setTheme: (id: string) => Promise<void>;
		setSize: (cols: number, rows: number) => Promise<void>;
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
	"\x1b[1mresize-test\x1b[m payload",
	"\x1b[31malpha\x1b[m \x1b[32mbeta\x1b[m \x1b[33mgamma\x1b[m \x1b[34mdelta\x1b[m",
	"line three with some text",
	"line four with some text",
	"",
].join("\r\n");

test.describe("D4 after-container-resize", () => {
	for (const id of THEMES) {
		test(`survives a resize in ${id}`, async ({ page }) => {
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

			// Shrink the grid. Sterk's `resize()` reflows the buffer and the
			// AceRenderer re-paints on the next rAF tick.
			await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.setSize(60, 16),
			);

			const state = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);
			expect(state.lines[0]).toContain("resize-test");

			await expect(page).toHaveScreenshot(`after-container-resize-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
