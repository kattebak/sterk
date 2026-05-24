import { expect, test } from "@playwright/test";

/**
 * Font-rendering baseline — one snapshot per bundled font.
 *
 * For each entry in `BUILTIN_FONTS`, the harness loads the corresponding
 * woff2 asset, switches the renderer family via `setFont(id)`, waits for
 * `document.fonts.load(...)` to confirm the typeface is on the page, and
 * then feeds a payload that mixes TUI box-drawing characters with common
 * code dingbats so eye-balling a baseline diff immediately reveals
 * stylistic identity (rounded vs. square corners, slashed zero, ligatures,
 * cell-width consistency).
 *
 * Pixel 7 viewport (see playwright.config.ts) so the baseline matches the
 * production phone target. One screenshot per font = 5 baselines committed.
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		setFont: (id: string) => Promise<void>;
		dumpState: () => { lines: string[] };
		reset: () => Promise<void>;
	};
};

const FONTS = [
	"jetbrains-mono",
	"ibm-plex-mono",
	"cascadia-mono",
	"fira-mono",
	"source-code-pro",
] as const;

const PAYLOAD = [
	"\x1b[1msterk font baseline\x1b[m",
	"the quick brown fox jumps over the lazy dog",
	"THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG",
	"0123456789  0Oo  iIlL1  ()[]{}<>",
	"!= == === => -> :: <- |> && || // /* */",
	"",
	"\x1b[1mbox drawing + dingbats (Claude TUI set)\x1b[m",
	"corners:  ┌─┬─┐  ╭─┬─╮",
	"sides:    │ │ │  │ │ │",
	"bottoms:  └─┴─┘  ╰─┴─╯",
	"bullets:  ◇ ◆ ✶ ✷ ✸ ● ○ ◉ ▲ ▶",
	"arrows:   ← → ↑ ↓ ⇐ ⇒ ⇑ ⇓",
	"blocks:   ▌ ▘ █ ▄ ▀ ░ ▒ ▓",
	"dings:    ✱ ✓ ✗ ➜ ✶ ❯",
	"",
].join("\r\n");

test.describe("font: rendering baseline", () => {
	for (const id of FONTS) {
		test(`renders TUI payload with ${id}`, async ({ page }) => {
			await page.goto("/test/visual/harness/index.html");
			await page.waitForFunction(
				() =>
					typeof (window as unknown as { __sterkTest?: unknown })
						.__sterkTest === "object",
			);
			await page.evaluate(
				() => (window as unknown as HarnessWindow).__sterkTest.ready,
			);

			// reset() so each font starts from a clean buffer — avoids
			// previous-test residue bleeding into the diff if the runner
			// reuses the page.
			await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.reset(),
			);

			await page.evaluate(
				(fontId) =>
					(window as unknown as HarnessWindow).__sterkTest.setFont(fontId),
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
			// Sanity: the payload made it into the buffer.
			expect(state.lines[1]).toContain("quick brown fox");
			expect(state.lines[7]).toContain("┌");

			await expect(page).toHaveScreenshot(`font-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
