import { expect, test } from "@playwright/test";

/**
 * In-place status bar — visual lock for the tmux/zsh "magenta status bar
 * duplicates 3×" regression mobux users reported on Pixel 7.
 *
 * Bug shape: Sterk's CSI CUP / HVP handler passed `p1 - 1` straight
 * through to the buffer's setCursor() as an ABSOLUTE row index. Once
 * the buffer had grown past `rows` lines (i.e. any real session with
 * scrollback), `\x1b[<rows>;1H` from a status-bar redraw landed at the
 * same absolute row in scrollback rather than on the live screen.
 * Each refresh painted a fresh status text at the (different) absolute
 * live-screen-bottom row while the previous bars froze in scrollback
 * — so after N redraws you saw N stacked status bars when scrolling.
 *
 * The fix translates viewport-relative CUP coordinates to absolute via
 * `liveTop = max(0, lines.length - rows)` before calling setCursor.
 *
 * This scenario:
 *   1. Scrolls the buffer past `rows` (so we are in the regime where
 *      the bug manifests — `liveTop > 0`).
 *   2. Emits three back-to-back status-bar redraws using the same
 *      magenta-bg colour combo the user's prompt uses. Each redraw
 *      cursor-moves to the bottom row and writes a fresh label.
 *   3. Captures a screenshot. Baseline locks "only one magenta status
 *      visible, pinned to the bottom row" across five themes.
 *
 * DOM assertion is the critical complement to the pixel baseline:
 * the magenta colour is theme-independent, so a regression that re-
 * introduces stacking would still produce visually similar pixels
 * (just at a different vertical offset that pixel diff might or
 * might not catch within `maxDiffPixelRatio`). Counting status-text
 * occurrences in the buffer dump catches the bug deterministically.
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

const STATUS_TAG = "[STATUS-BAR]";
// SGR 45 = magenta bg, SGR 97 = bright white fg, SGR 1 = bold. Matches
// the visual shape of the prompt that triggered the original report.
const STATUS_SGR_OPEN = "\x1b[1;97;45m";
const STATUS_SGR_CLOSE = "\x1b[m";

function buildScrollbackPayload(scrollbackLines: number): string {
	const lines: string[] = [];
	for (let i = 1; i <= scrollbackLines; i++) {
		lines.push(`output-line-${i.toString().padStart(3, "0")}`);
	}
	return `${lines.join("\r\n")}\r\n`;
}

function statusRedraw(rows: number, label: string): string {
	// CUP to bottom row, col 1, paint the bar, then `\x1b[K` (EL mode 0)
	// to clear any stale chars to the right of our new payload. This is
	// the exact sequence tmux and most zsh "magenta status bar" prompts
	// emit on each refresh. Pre-fix this exercised BOTH bugs:
	//   - CUP-as-absolute landed the cursor in scrollback instead of on
	//     the live screen.
	//   - `\x1b[K` (no param) routed as EL-mode-1 (erase LEFT) instead of
	//     EL-mode-0 (erase RIGHT), so even when the cursor was in the
	//     right place the tail of the previous render was preserved.
	// The trailing CR keeps the cursor on the same row (mimicking a real
	// prompt that doesn't emit a newline after the status bar).
	return `\x1b[${rows};1H${STATUS_SGR_OPEN} ${label} ${STATUS_SGR_CLOSE}\x1b[K\r`;
}

test.describe("in-place-status-bar", () => {
	for (const id of THEMES) {
		test(`status bar overwrites in place across redraws in ${id}`, async ({
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

			// Resync `term.rows` to the actual Pixel-7 viewport height,
			// matching the buffer-grows-past-rows scenario's recipe so we
			// are in the same regime the user hit.
			const grid = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.shrinkAndResyncGrid(0),
			);
			expect(grid?.rows ?? 0).toBeGreaterThan(0);
			const rows = grid?.rows ?? 24;

			// Push the buffer 10 lines past `rows` so `liveTop > 0` — the
			// pre-condition where the CUP-as-absolute bug fires.
			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				buildScrollbackPayload(rows + 10),
			);

			// Three "status bar redraws" — equivalent to three seconds of a
			// 1Hz status-interval prompt. Pre-fix, each redraw left a stale
			// magenta bar in scrollback at a different absolute row, so
			// scrolling back would reveal three stacked bars (matching the
			// user's screenshot).
			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				statusRedraw(rows, `${STATUS_TAG}-A`),
			);
			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				statusRedraw(rows, `${STATUS_TAG}-B`),
			);
			await page.evaluate(
				(payload) =>
					(window as unknown as HarnessWindow).__sterkTest.feedRaw(payload),
				statusRedraw(rows, `${STATUS_TAG}-C`),
			);

			const state = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);

			// We are in the bug-prone regime.
			expect(state.length).toBeGreaterThan(state.rows);

			// ── DOM assertions (theme-independent, deterministic) ─────────
			// Only the most recent status bar should survive. Previous ones
			// must have been overwritten — not preserved at different
			// absolute rows.
			const matches = state.lines.filter((l) => l.includes(STATUS_TAG));
			expect(
				matches.length,
				`exactly one [STATUS-BAR]-* line should exist; got ${matches.length}: ${JSON.stringify(matches)}`,
			).toBe(1);
			expect(matches[0]).toContain(`${STATUS_TAG}-C`);
			expect(matches[0]).not.toContain(`${STATUS_TAG}-A`);
			expect(matches[0]).not.toContain(`${STATUS_TAG}-B`);

			// The surviving bar must live on the live bottom row.
			const lastNonEmptyIdx = (() => {
				for (let i = state.lines.length - 1; i >= 0; i--) {
					const line = state.lines[i];
					if (line !== undefined && line.trim().length > 0) return i;
				}
				return -1;
			})();
			expect(state.lines[lastNonEmptyIdx] ?? "").toContain(`${STATUS_TAG}-C`);

			// ── Pixel baseline ────────────────────────────────────────────
			await expect(page).toHaveScreenshot(`in-place-status-bar-${id}.png`, {
				fullPage: true,
			});
		});
	}
});
