import { expect, test } from "@playwright/test";

/**
 * SGR colours + bold + underline + bg — regression baseline.
 *
 * Anchored to the mobux ":5151 no colours, no bold" report:
 *   - VtMode space-joined cell classes, Ace's text layer split token type
 *     on `.` (not space), so only the first class got the `ace_` prefix
 *     Ace's CSS expected. Every SGR class beyond the first silently
 *     dropped its styling. Themes.spec.ts' baselines were captured
 *     against that broken DOM and accepted as canonical, so the existing
 *     visual suite was blind to the regression.
 *
 * This scenario asserts BOTH:
 *   1. The pixel baseline (per theme), so a future drift in palette /
 *      attribute rendering is flagged at the image diff stage.
 *   2. The DOM class chain produced by Ace's tokenizer, so a regression
 *      that re-introduces the space-joiner is caught even if the pixels
 *      happen to match (font fallback, colour-blind anti-aliasing,
 *      etc.). Class assertions are theme-independent — same chain across
 *      all five themes.
 *
 * Coverage matrix exercised per theme:
 *   - SGR 31, 32, 33, 34, 35, 36 (chromatic ANSI fg colours, palette path)
 *   - SGR 1 (bold)
 *   - SGR 4 (underline)
 *   - SGR 42 (bg-only, exercises default-fg-on-bg luminance contrast)
 *   - SGR 1;33 (combined bold + yellow — the original space-joiner shape
 *     that produced `ace_sterk-fg-3 sterk-bold` in the DOM)
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

// SGR exercise payload. Each `\r\n` lands a fresh line; the labels are
// deliberately plain ASCII so a missing colour shows up as a flat block
// of theme-fg in the pixel diff.
const PAYLOAD = [
	"\x1b[31mred\x1b[m \x1b[32mgreen\x1b[m \x1b[33myellow\x1b[m \x1b[34mblue\x1b[m \x1b[35mmagenta\x1b[m \x1b[36mcyan\x1b[m",
	"\x1b[1mbold\x1b[m \x1b[4munderline\x1b[m \x1b[1;33mbold-yellow\x1b[m",
	"\x1b[42m on-green \x1b[m \x1b[41m on-red \x1b[m",
	"",
].join("\r\n");

test.describe("SGR colour + bold + bg — regression baseline", () => {
	for (const id of THEMES) {
		test(`renders ANSI palette + attributes in ${id}`, async ({ page }) => {
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

			// Sanity dump — the buffer must contain the exercise text;
			// guards against a flaky write that lands an empty frame.
			const state = await page.evaluate(() =>
				(window as unknown as HarnessWindow).__sterkTest.dumpState(),
			);
			expect(state.lines[0]).toContain("red");
			expect(state.lines[1]).toContain("bold");

			// ── DOM class-chain assertions ──────────────────────────────
			// Ace's text layer turns a token type `sterk-fg-1.sterk-bold`
			// into the DOM `class="ace_sterk-fg-1 ace_sterk-bold"`. If
			// `vt_mode.ts` space-joins classes (the bug shape) only the
			// first class gets `ace_` and the rest silently fail to match
			// the CSS rules. Asserting EVERY attribute class carries the
			// `ace_` prefix is the discipline test the existing pixel
			// suite failed to provide.
			const classes = await page.evaluate(() => {
				const spans = document.querySelectorAll(".ace_line span");
				return Array.from(spans).map((s) => s.className);
			});

			// Each non-empty class chain must consist entirely of
			// `ace_`-prefixed tokens (or the bare `ace_` Ace emits for
			// the empty-token-type case). A space-joined regression
			// shows up here as a `sterk-bold` (no prefix) class.
			const offenders = classes
				.flatMap((c) => c.split(/\s+/).filter(Boolean))
				.filter((c) => c !== "ace_" && !c.startsWith("ace_"));
			expect(offenders, "every SGR class must be ace_-prefixed").toEqual([]);

			// Specific palette classes (1-6 = red..cyan) must be present.
			const flat = classes.join(" ");
			for (const idx of [1, 2, 3, 4, 5, 6]) {
				expect(
					flat,
					`palette fg ${idx} must appear as ace_sterk-fg-${idx}`,
				).toContain(`ace_sterk-fg-${idx}`);
			}
			// Bold + underline + bg classes must be present.
			expect(flat).toContain("ace_sterk-bold");
			expect(flat).toContain("ace_sterk-underline");
			expect(flat).toContain("ace_sterk-bg-2"); // green bg
			expect(flat).toContain("ace_sterk-bg-1"); // red bg

			// ── Pixel baseline ──────────────────────────────────────────
			await expect(page).toHaveScreenshot(
				`sgr-colors-and-bold-${id}.png`,
				{ fullPage: true },
			);
		});
	}
});
