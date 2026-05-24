import { expect, test } from "@playwright/test";

/**
 * Unicode parity (Row 33) — Modern emoji + ZWJ sequences.
 *
 * Locks:
 *   - Single-codepoint emoji (`😀 🚀 🎉 ✨`) — width 2 each
 *   - ZWJ-fused family glyph (`👨‍👩‍👧‍👦`) — 4 emoji + 3 ZWJ → 8 cells
 *     in the cell-grid model (real font shapes them as one ligature)
 *   - Regional indicator pair flag (`🇯🇵`) — 2 emoji-presentation cells
 *
 * Pre-fix, sterk treated 🚀 as width 1 and the next character
 * overlapped the rocket. The Claude Code TUI uses ✶ ✷ ✸ ◇ ◆ animation
 * frames which are *not* width 2 (geometric shapes), so those rendered
 * correctly — but anywhere the model output included an emoji response
 * the alignment of the following text was off by one.
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
	"\x1b[1memoji + zwj\x1b[m",
	"single:  😀 🚀 🎉 ✨",
	"family:  👨‍👩‍👧‍👦",
	"flag:    🇯🇵",
	"mixed:   start 🎉 middle 🚀 end",
	"",
].join("\r\n");

test.describe("unicode: emoji + ZWJ sequences", () => {
	for (const id of THEMES) {
		test(`renders emoji + ZWJ correctly in ${id}`, async ({ page }) => {
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
			expect(state.lines[1]).toContain("🚀");

			await expect(page).toHaveScreenshot(`unicode-emoji-zwj-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
