import { expect, test } from "@playwright/test";

/**
 * D4 — Alt-screen-toggle scenario, cycled across the 5 themes.
 *
 * Drives the DECSET 1049 (smcup/rmcup) flow:
 *   1. Feed a normal-buffer payload.
 *   2. Enter the alternate screen (`\x1b[?1049h`), feed alt content.
 *      Screenshot ("entered").
 *   3. Exit the alternate screen (`\x1b[?1049l`).
 *      Screenshot ("exited") — the normal-buffer payload must be
 *      restored byte-for-byte.
 *
 * Two sub-baselines per theme = 2 × 5 = 10 baselines for this scenario.
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

const NORMAL_PAYLOAD = [
	"\x1b[1mnormal buffer\x1b[m line one",
	"normal buffer line two",
	"normal buffer line three",
	"",
].join("\r\n");

const ALT_PAYLOAD = [
	"\x1b[1malt screen\x1b[m banner",
	"\x1b[35malt body line A\x1b[m",
	"\x1b[36malt body line B\x1b[m",
	"",
].join("\r\n");

test.describe("D4 alt-screen-toggle", () => {
	for (const id of THEMES) {
		test(`enters and exits the alt buffer in ${id}`, async ({ page }) => {
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

			// 1. Normal-buffer baseline content.
			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				NORMAL_PAYLOAD,
			);

			// 2. Enter the alt screen + render alt payload, screenshot.
			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(
						`\x1b[?1049h${payload}`,
					),
				ALT_PAYLOAD,
			);
			const altState = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);
			expect(altState.lines[0]).toContain("alt screen");
			await expect(page).toHaveScreenshot(
				`alt-screen-toggle-entered-${id}.png`,
				{ fullPage: true },
			);

			// 3. Exit the alt screen — normal payload must be restored.
			await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.feedRaw("\x1b[?1049l"),
			);
			const normalState = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);
			expect(normalState.lines[0]).toContain("normal buffer");
			await expect(page).toHaveScreenshot(
				`alt-screen-toggle-exited-${id}.png`,
				{ fullPage: true },
			);
		});
	}
});
