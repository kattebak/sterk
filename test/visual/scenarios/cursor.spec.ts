import { expect, test } from "@playwright/test";

/**
 * D4 — Cursor scenario, cycled across the 5 themes.
 *
 * Original plan slot was "cursor-blink-on-off". Sterk's harness already
 * neutralises blink animations via global `animation-duration: 0s`, and
 * sterk does not currently implement DECTCEM (`?25h/?25l`) cursor
 * visibility — so a deterministic blink-on / blink-off pair isn't
 * meaningful here. Substituted: render a partial prompt that parks the
 * cursor at a known interior column, screenshot the cursor cell. This
 * is the canonical regression anchor for cursor positioning + paint
 * (cursor colour from theme, cursor placement after CUP, no stale
 * cursor at the previous row). Substitution documented in the PR body.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (D4).
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		setTheme: (id: string) => Promise<void>;
		dumpState: () => {
			lines: string[];
			cursorX: number;
			cursorY: number;
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

// Two lines of context + a partial prompt that ends without a newline so
// the cursor parks at column == prompt-length on the third row.
const PAYLOAD = [
	"\x1b[1mcursor test\x1b[m line one",
	"second context line",
	"$ partial command",
].join("\r\n");

test.describe("D4 cursor", () => {
	for (const id of THEMES) {
		test(`parks the cursor at a known position in ${id}`, async ({ page }) => {
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
			// Cursor must be parked at end of the partial prompt (no
			// trailing newline → cursor stays on row 2 at col 17).
			expect(state.cursorY).toBe(2);
			expect(state.cursorX).toBe("$ partial command".length);

			await expect(page).toHaveScreenshot(`cursor-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
