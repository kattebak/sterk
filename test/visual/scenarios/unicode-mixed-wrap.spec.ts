import { expect, test } from "@playwright/test";

/**
 * Unicode parity (Row 33) — Mixed wide/narrow under cell-width math.
 *
 * Verifies the wide-char wrap path: a width-2 glyph that would split
 * across the row boundary wraps to the next row instead of being
 * truncated (xterm/foot/iTerm behaviour). Buffer logic:
 * `scroll_buffer.ts → printCodePoint(w === 2)` checks the remaining
 * room on the current line and rolls to col 0 of the next row if
 * needed.
 *
 * Layout:
 *   - Default harness is 80×24. We feed a string whose width-1 prefix
 *     fills the row up to position 79 (one column free) and then emits
 *     a width-2 glyph that cannot fit there. Visually the glyph
 *     appears at the start of the next row, and the prior trailing
 *     cell is left blank.
 *   - We also include a smaller burst that mixes ASCII and CJK to
 *     verify that the mid-row CJK doesn't shift everything to its
 *     right by an off-by-one.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (Row 33).
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

// 79 ASCII chars + one CJK char → CJK wraps to next row.
const FILL_79 = "x".repeat(79);

const PAYLOAD = [
	"\x1b[1mmixed wrap\x1b[m",
	`${FILL_79}中`,
	"continued on next line",
	"AB中文CD中文EF (no wrap, mid-row CJK)",
	"",
].join("\r\n");

test.describe("unicode: mixed wide+narrow wrap", () => {
	for (const id of THEMES) {
		test(`renders mixed wrap correctly in ${id}`, async ({ page }) => {
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
			// Row 2 in the buffer is the row that received the 79 x's,
			// row 3 (the wrap target) starts with the CJK glyph.
			expect(state.lines[1]).toContain("x");
			expect(state.lines[2]).toContain("中");

			await expect(page).toHaveScreenshot(`unicode-mixed-wrap-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
