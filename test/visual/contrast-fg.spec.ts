import { expect, test } from "@playwright/test";

/**
 * A3 — visual baseline for the luminance-contrast fallback.
 *
 * Drives the harness with a payload that exercises the bug the fix
 * targets: default foreground on an explicit dark/light SGR bg. Without
 * the contrast fallback the dark-bg cell renders as black-on-(near-)
 * black and the light-bg cell as white-on-(near-)white — both
 * unreadable. With the fallback the renderer flips the fg colour by
 * luminance and both labels are legible against their backgrounds.
 *
 * The harness's default theme has foreground `#d4d4d4` (light); to
 * make this baseline a meaningful regression catch for *future* dark
 * themes too, the test also writes a row that pins the *theme*'s fg
 * (default-fg + default-bg) so the baseline captures all three states
 * — dark bg, light bg, plain — in one screenshot.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (Row 21).
 */
test.describe("A3 contrast fg fallback", () => {
	test("default fg on explicit bg renders with readable contrast", async ({
		page,
	}) => {
		await page.goto("/test/visual/harness/index.html");
		await page.waitForFunction(
			() =>
				typeof (window as unknown as { __sterkTest?: unknown }).__sterkTest ===
				"object",
		);
		await page.evaluate(
			() =>
				(window as unknown as { __sterkTest: { ready: Promise<void> } })
					.__sterkTest.ready,
		);

		// Three labelled rows on one screen:
		//   1. dark bg (palette black, \x1b[40m) + default fg
		//   2. light bg (palette white, \x1b[47m) + default fg
		//   3. plain default-on-default (control row)
		// `\r\n` between rows so each lands in its own buffer line.
		await page.evaluate(() =>
			(
				window as unknown as {
					__sterkTest: { feedRaw: (s: string) => Promise<void> };
				}
			).__sterkTest.feedRaw(
				"\x1b[40mdark-bg-default-fg\x1b[m \x1b[47mlight-bg-default-fg\x1b[m\r\n" +
					"plain-default-fg-default-bg\r\n",
			),
		);

		// Sanity check via the harness's state dump — the buffer must
		// contain the literal text (independent of how it's coloured).
		// This catches regressions where the SGR parser drops the bg
		// reset, which would otherwise look like an unrelated pixel diff.
		const state = await page.evaluate(() =>
			(
				window as unknown as {
					__sterkTest: { dumpState: () => { lines: string[] } };
				}
			).__sterkTest.dumpState(),
		);
		expect(state.lines[0]).toContain("dark-bg-default-fg");
		expect(state.lines[0]).toContain("light-bg-default-fg");
		expect(state.lines[1]).toContain("plain-default-fg-default-bg");

		await expect(page).toHaveScreenshot("contrast-fg.png", {
			fullPage: true,
		});
	});
});
