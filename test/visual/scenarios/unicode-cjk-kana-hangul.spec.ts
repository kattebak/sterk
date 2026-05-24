import { expect, test } from "@playwright/test";

/**
 * Unicode parity (Row 33) — CJK ideographs + Japanese kana + Hangul.
 *
 * Locks the wide-character path for the East-Asian baseline:
 *   - U+4E00 block Hanzi (`中文测试`)
 *   - Hiragana / Katakana (`テスト`, `あいうえお`)
 *   - Hangul syllables (`한글`)
 *   - Fullwidth punctuation (`！？，。「」`)
 *
 * Pre-fix, sterk treated every cell as 1 column → these all collapsed
 * to half-width visually and subsequent ASCII drifted left. Post-fix,
 * each CJK glyph occupies 2 cells via the wcwidth + placeholder
 * encoding (`src/util/wcwidth.ts`, `src/buffer/scroll_buffer.ts`
 * `printCodePoint`).
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (Row 33).
 * Mobux postmortem: https://github.com/mvhenten/mobux/issues/81.
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
	"\x1b[1mCJK + kana + hangul\x1b[m",
	"hanzi:   中文测试",
	"kana:    テスト あいうえお",
	"hangul:  한글 안녕하세요",
	"fwidth:  ！？，。「」",
	"mixed:   AB中文CD한국EF",
	"",
].join("\r\n");

test.describe("unicode: CJK + kana + hangul", () => {
	for (const id of THEMES) {
		test(`renders CJK/kana/hangul correctly in ${id}`, async ({ page }) => {
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
			expect(state.lines[1]).toContain("中文测试");
			expect(state.lines[3]).toContain("한글");

			await expect(page).toHaveScreenshot(`unicode-cjk-kana-hangul-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
