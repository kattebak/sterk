import { expect, test } from "@playwright/test";

/**
 * D4 — Scrollback-scroll scenario, cycled across the 5 themes.
 *
 * Pumps 500 numbered lines into the buffer (well beyond the visible
 * 24-row viewport, into the scrollback ring), then scrolls the viewport
 * to absolute row 100 and screenshots. Captures the renderer's handling
 * of viewportY != baseY (scrollback paint) and pins the visible row
 * indices so any regression in `scrollLines()` / viewport indexing is
 * caught visually.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (D4).
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		setTheme: (id: string) => Promise<void>;
		feedBurst: (n: number, prefix?: string) => Promise<void>;
		scrollToRow: (absoluteY: number) => Promise<void>;
		dumpState: () => {
			lines: string[];
			viewportY: number;
			baseY: number;
			length: number;
			rows: number;
		};
	};
};

const THEMES = [
	"solarized-dark",
	"solarized-light",
	"tomorrow-night",
	"nord",
	"gruvbox-dark-soft",
] as const;

const SCROLL_TARGET = 100;

test.describe("D4 scrollback-scroll", () => {
	for (const id of THEMES) {
		test(`scrolls the viewport into scrollback in ${id}`, async ({ page }) => {
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

			// 500 numbered lines — each labelled with its row number so the
			// screenshot encodes "viewport pinned at row 100" implicitly.
			await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.feedBurst(500, "row"),
			);

			await page.evaluate(
				(y) => (window as unknown as HarnessWindow).__sterkTest.scrollToRow(y),
				SCROLL_TARGET,
			);

			const state = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);
			// Sanity: the viewport is parked at the requested row, not
			// pinned to the bottom (i.e. the scrollLines delta actually
			// took effect). baseY stays at 0 until the scrollback ring
			// (default 1000) overflows — with only 500 lines fed, scrolling
			// off-bottom is the meaningful check.
			expect(state.viewportY).toBe(SCROLL_TARGET);
			const maxViewportY = state.length - state.rows;
			expect(state.viewportY).toBeLessThan(maxViewportY);
			expect(state.lines[SCROLL_TARGET]).toContain("row 0100");

			await expect(page).toHaveScreenshot(`scrollback-scroll-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
