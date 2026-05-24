import { expect, test } from "@playwright/test";

/**
 * B10 + B11 — Visual baselines for the 5 built-in themes.
 *
 * For each theme:
 *   1. Boot the harness and call `setTheme(theme-id)` via the public API.
 *   2. Feed a fixed payload that exercises the palette:
 *        - bold theme banner
 *        - all 6 chromatic ANSI fgs (red/green/yellow/blue/magenta/cyan)
 *        - bold + italic + underline attributes
 *        - an explicit bg (40m, 47m) to verify the contrast fallback
 *        - a line of plain default-fg/default-bg text
 *   3. Screenshot the full page; Playwright commits the baseline under
 *      `themes.spec.ts-snapshots/themes-<id>-<project>.png`.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (rows 40-46).
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		setTheme: (id: string) => Promise<void>;
		clear: () => Promise<void>;
		dumpState: () => { lines: string[] };
	};
};

const THEMES = [
	{ id: "solarized-dark", name: "Solarized Dark" },
	{ id: "solarized-light", name: "Solarized Light" },
	{ id: "tomorrow-night", name: "Tomorrow Night" },
	{ id: "nord", name: "Nord" },
	{ id: "gruvbox-dark-soft", name: "Gruvbox Dark Soft" },
] as const;

function buildPayload(name: string): string {
	// One screen worth of ANSI exercise. Each `\r\n` lands a fresh buffer line.
	return [
		`\x1b[1mTheme: ${name}\x1b[m`,
		"\x1b[31m  red\x1b[m \x1b[32m  green\x1b[m \x1b[33m  yellow\x1b[m \x1b[34m  blue\x1b[m \x1b[35m  magenta\x1b[m \x1b[36m  cyan\x1b[m",
		"\x1b[1;31m  bold-red\x1b[m \x1b[3m  italic\x1b[m \x1b[4m  underline\x1b[m",
		"\x1b[40m ongreen \x1b[m \x1b[47m light-bg \x1b[m",
		"lorem ipsum dolor sit amet",
		"",
	].join("\r\n");
}

test.describe("B10 + B11 built-in theme baselines", () => {
	for (const { id, name } of THEMES) {
		test(`renders the ${id} palette deterministically`, async ({ page }) => {
			await page.goto("/test/visual/harness/index.html");
			await page.waitForFunction(
				() =>
					typeof (window as unknown as HarnessWindow).__sterkTest === "object",
			);
			await page.evaluate(
				() => (window as unknown as HarnessWindow).__sterkTest.ready,
			);

			// Swap the theme before any payload so the screenshot only
			// captures the new palette's rendering.
			await page.evaluate(
				(themeId) =>
					(window as unknown as HarnessWindow).__sterkTest.setTheme(themeId),
				id,
			);

			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				buildPayload(name),
			);

			// Sanity check: the buffer must contain the theme banner so
			// future regressions don't masquerade as colour-only diffs.
			const state = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);
			expect(state.lines[0]).toContain(`Theme: ${name}`);

			await expect(page).toHaveScreenshot(`themes-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
