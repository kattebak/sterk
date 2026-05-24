import { expect, test } from "@playwright/test";

/**
 * Unicode parity (Row 33) — Combining marks (zero-width).
 *
 * Locks the combining-mark anchor path:
 *   - Latin Extended combining diacriticals
 *     (`é` = e + COMBINING ACUTE U+0301, `ñ` = n + U+0303, …)
 *   - Thai combining vowels (`ที่`, `เป็น`) where the cell anchor sits
 *     above/below the consonant
 *   - Devanagari with virama (`नमस्ते` — Hindi "hello")
 *
 * Pre-fix, sterk advanced the cursor by 1 for the combining mark itself
 * (because it had no width table), so a base + combining pair occupied
 * 2 cells and the diacritic floated to the wrong glyph. Post-fix,
 * combining marks have width 0 and glue onto the previous cell's
 * `chars` buffer without advancing the cursor (see
 * `scroll_buffer.ts` → `appendCombiningMark`).
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

// "é" written as e + COMBINING ACUTE so the combining-mark path is
// exercised; "é" precomposed is included as a visual sanity check. The
// two should render identically and occupy exactly 1 cell.
const PAYLOAD = [
	"\x1b[1mcombining marks\x1b[m",
	"latin:   café résumé naïve",
	"e+acute: é vs precomposed: é",
	"thai:    ที่ เป็น (combining vowels)",
	"hindi:   नमस्ते (devanagari + virama)",
	"mixed:   préfix-é-suffix",
	"",
].join("\r\n");

test.describe("unicode: combining marks", () => {
	for (const id of THEMES) {
		test(`renders combining marks correctly in ${id}`, async ({ page }) => {
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
			// Both forms should be present and indistinguishable for buffer reads.
			expect(state.lines[2]).toContain("é");

			await expect(page).toHaveScreenshot(`unicode-combining-marks-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
