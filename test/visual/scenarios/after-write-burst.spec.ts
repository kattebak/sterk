import { expect, test } from "@playwright/test";

/**
 * D4 — After-write-burst scenario, cycled across the 5 themes.
 *
 * Floods the terminal with 200 synthetic lines in a single `write()`
 * call (forcing the parser/renderer to coalesce them onto one rAF
 * tick), then sends a single follow-up line and screenshots. This
 * captures the post-burst steady state: the bottom of a 200-line scroll
 * + one clean trailing line. Any rAF-coalescer regression (zombie rows,
 * torn paints, missed final flush) will diff the screenshot.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (D4).
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		setTheme: (id: string) => Promise<void>;
		feedBurst: (n: number, prefix?: string) => Promise<void>;
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

test.describe("D4 after-write-burst", () => {
	for (const id of THEMES) {
		test(`settles cleanly after a 200-line burst in ${id}`, async ({
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

			await page.evaluate(
				(themeId) =>
					(window as unknown as HarnessWindow).__sterkTest.setTheme(themeId),
				id,
			);

			// 200-line burst, then a single trailing non-bursty line. The
			// burst lands as one parser session; the trailing line lands as
			// a separate write to exercise the steady-state path after the
			// coalescer drains.
			await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.feedBurst(
					200,
					"burst",
				),
			);
			await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.feedRaw(
					"trailing line after burst\r\n",
				),
			);

			const state = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);
			// Last printable buffer line must be the trailing marker so the
			// burst was fully drained before the screenshot.
			const printable = state.lines.filter((l) => l.length > 0);
			expect(printable[printable.length - 1]).toContain(
				"trailing line after burst",
			);

			await expect(page).toHaveScreenshot(`after-write-burst-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
