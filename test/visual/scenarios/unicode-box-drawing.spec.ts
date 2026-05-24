import { expect, test } from "@playwright/test";

/**
 * Unicode parity (Row 33) — Box-drawing characters.
 *
 * This is the specific scenario the user reported as broken in mobux's
 * production Claude Code TUI session: the rounded-corner box characters
 * (`╭ ╮ ╰ ╯`), the line drawings (`─ │ ├ ┤`), and the bullet/spinner
 * shapes (`◇ ◆ ✶ ✷ ✸`) all live in the U+2500..U+25FF + U+2700..U+27BF
 * blocks. East-Asian-Width classifies them as **Narrow** (width 1).
 * Sterk's pre-fix wcwidth-less buffer treated them as width 1 too — so
 * the cell math actually worked, BUT mojibake-adjacent diagnostic
 * output (e.g. tmux status bar mixing box-drawing with kanji from a
 * Japanese system locale) collapsed because the *neighbouring* CJK was
 * width 1 in sterk, shifting the entire row.
 *
 * Locking this scenario guarantees we don't regress to treating box
 * characters as wide (over-correction) when we eventually add EAW
 * "Ambiguous" handling.
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

const PAYLOAD = [
	"\x1b[1mbox drawing (Claude Code TUI)\x1b[m",
	"corners:  ┌─┬─┐  ╭─┬─╮",
	"sides:    │ │ │  │ │ │",
	"bottoms:  └─┴─┘  ╰─┴─╯",
	"bullets:  ◇ ◆ ✶ ✷ ✸ ● ○ ◉",
	"frame:    ├─┤   ┬   ┴   ┼",
	"",
].join("\r\n");

test.describe("unicode: box drawing", () => {
	for (const id of THEMES) {
		test(`renders box-drawing chars correctly in ${id}`, async ({ page }) => {
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
			expect(state.lines[1]).toContain("┌");
			expect(state.lines[4]).toContain("◆");

			await expect(page).toHaveScreenshot(`unicode-box-drawing-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
