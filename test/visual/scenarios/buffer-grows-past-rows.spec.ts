import { expect, test } from "@playwright/test";

/**
 * Buffer-grows-past-rows — visual lock for the PR #13 fix
 * ("pin viewport to live screen as buffer grows past rows").
 *
 * Regression context: tmux/shell sessions running in mobux on a Pixel 7
 * showed scrollback frozen at the top of the renderer and the active
 * screen — including tmux's status row and the most recent shell
 * output — clipped below the visible area.
 *
 * Two coupled bugs caused this:
 *
 *  1. `ScrollBuffer.insertLine` only auto-scrolled while
 *     `viewportY === baseY`. `baseY` only advances when the scrollback
 *     ring fills to `maxLines`, so in normal use it stays at 0 forever.
 *     As soon as the buffer grew past `rows` lines, `viewportY` ticked
 *     to 1 and the check stopped matching; the viewport froze near the
 *     top while new lines kept landing at the bottom and rolled
 *     off-screen.
 *
 *  2. `AceRenderer.updateScroll` used `editor.scrollToLine(viewportY,
 *     true, ...)` which is a no-op when the target row is already
 *     inside Ace's visible range. For terminal use the document is
 *     only marginally larger than the viewport, so the call silently
 *     did nothing even when the buffer fix above was applied.
 *
 * What this test does:
 *   1. Feed `rows + 10` numbered lines.
 *   2. Feed a sentinel last line "[LIVE-BOTTOM]" — the line a real
 *      tmux session's status bar would occupy.
 *   3. Screenshot. The committed baseline locks in: the sentinel
 *      `[LIVE-BOTTOM]` row is the LAST row in the visible scroller,
 *      with no overflow below.
 *
 * The baseline IS the assertion: any regression to either bug above
 * leaves the sentinel off-screen and produces a pixel diff. To make
 * the failure mode obvious in CI we ALSO assert the buffer is in the
 * post-fix state (viewportY tracks the bottom of the buffer, last
 * buffer line contains the sentinel).
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
			viewportY: number;
			length: number;
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

const SENTINEL = "[LIVE-BOTTOM]";

function buildPayload(preSentinelLines: number): string {
	const lines: string[] = [];
	for (let i = 1; i <= preSentinelLines; i++) {
		lines.push(`scrollback-${i.toString().padStart(3, "0")}`);
	}
	lines.push(SENTINEL);
	return `${lines.join("\r\n")}\r\n`;
}

test.describe("buffer-grows-past-rows", () => {
	for (const id of THEMES) {
		test(`sentinel last line is visible at the bottom in ${id}`, async ({
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

			// Resync the terminal's `rows` to the actual container height
			// (Pixel-7 viewport ≈ 60 monospace-14 rows) by calling
			// `shrinkAndResyncGrid(0)` — same code path as mobux, no
			// shrink. After this `term.rows` matches the scroller height
			// so "buffer past rows" is a real visible-clipping condition.
			const grid = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.shrinkAndResyncGrid(0),
			);
			expect(grid?.rows ?? 0).toBeGreaterThan(0);

			// Feed enough lines to overflow the resynced rows by 10. The
			// 10 extra lines is the scrollback the renderer should bury at
			// the top while pinning the sentinel at the bottom.
			const preSentinelLines = (grid?.rows ?? 24) + 9;
			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				buildPayload(preSentinelLines),
			);

			const state = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);

			// The buffer grew past one screen of content — this is the
			// regime where the two bugs manifested.
			expect(state.length).toBeGreaterThan(state.rows);

			// Sentinel landed at the bottom of the buffer (the live screen).
			// `dumpState` filters falsy lines but keeps blanks, so we walk
			// from the end to find the last non-empty line.
			const lastNonEmpty = [...state.lines]
				.reverse()
				.find((l) => l.trim().length > 0);
			expect(lastNonEmpty).toContain(SENTINEL);

			// viewportY is pinned to the live screen: top of viewport ==
			// bottom-of-buffer - rows. Pre-fix, viewportY froze near 0/1
			// and this assertion would fail.
			expect(state.viewportY).toBe(state.length - state.rows);
			expect(state.viewportY).toBeGreaterThan(0);

			// The baseline IS the assertion: pixel-diff catches both
			// (a) the buffer pin (sentinel must be in the visible buffer
			// region) and (b) the renderer pin (scrollTop must align Ace's
			// visible area to the bottom of the document so the sentinel
			// actually paints inside the scroller).
			await expect(page).toHaveScreenshot(`buffer-grows-past-rows-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
