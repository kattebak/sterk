import { expect, test } from "@playwright/test";

/**
 * Bottom-row-after-shrink — visual lock for the
 * `getViewportCellCount` sync-resize fix.
 *
 * Regression context: on Pixel 7, when mobux's mobile input bar
 * appears as a flex sibling of the terminal, the terminal's host box
 * shrinks. mobux fires a synchronous `resize` event and asks sterk
 * `getViewportCellCount()` for the new grid in the same task. Before
 * this fix, sterk read Ace's STALE `$size` (set by the previous
 * paint) and reported MORE rows than actually fit — the PTY was
 * resized larger than the visible scroller, and the bottom 2-5 rows
 * rendered off-screen ("bottom cut off").
 *
 * The fix: `getViewportCellCount()` forces `editor.resize(true)`
 * before reading `$size`, so the answer reflects the live container.
 *
 * What this test does:
 *   1. Boot at 80×24 in the full-height container.
 *   2. Feed N lines numbered LAST_N..N so the LAST row is easy to
 *      identify visually (it's the highest number).
 *   3. Synchronously shrink the container by 120px AND re-resync the
 *      grid via the harness's `shrinkAndResyncGrid()` — the exact
 *      timing pattern mobux uses.
 *   4. Screenshot. The committed baseline locks in: after the shrink,
 *      the bottom edge of the scroller contains the LAST row of
 *      content that actually fits, with no rows orphaned below.
 *
 * Diff failure means the timing fix in `AceRenderer.getViewportCellCount`
 * regressed.
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		setTheme: (id: string) => Promise<void>;
		shrinkAndResyncGrid: (
			pxFromBottom: number,
		) => Promise<{ cols: number; rows: number } | null>;
		dumpState: () => {
			lines: string[];
			cols: number;
			rows: number;
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

// Feed 60 lines so even after the shrink there's content past the
// visible bottom — the screenshot must capture the LAST FITTING row
// with no overflow below.
const LINE_COUNT = 60;

function buildPayload(): string {
	const lines: string[] = [];
	for (let i = 1; i <= LINE_COUNT; i++) {
		lines.push(`bottom-marker-${i.toString().padStart(3, "0")}`);
	}
	return `${lines.join("\r\n")}\r\n`;
}

test.describe("bottom-row-after-shrink", () => {
	for (const id of THEMES) {
		test(`bottom row is last fitting row after synchronous shrink in ${id}`, async ({
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

			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				buildPayload(),
			);

			// Shrink the container by 120px from the bottom AND ask the
			// terminal to resync its grid to the new size — all in one
			// synchronous step. This is the call pattern mobux uses when
			// the input bar appears. If `getViewportCellCount()` doesn't
			// force a re-measurement, the resulting `rows` is stale and
			// the screenshot will show clipped content below the scroller.
			const grid = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.shrinkAndResyncGrid(
					120,
				),
			);
			expect(grid).not.toBeNull();
			expect(grid?.rows ?? 0).toBeGreaterThan(0);

			const state = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);
			// The buffer's reported rows must match the grid the API
			// returned — proving the resize call took. (A stale-read
			// failure would leave term.rows at the pre-shrink value.)
			expect(state.rows).toBe(grid?.rows);

			await expect(page).toHaveScreenshot(`bottom-row-after-shrink-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
