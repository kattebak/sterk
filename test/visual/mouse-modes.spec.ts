import { expect, test } from "@playwright/test";

/**
 * A1 visual regression — DEC mouse-mode plumbing must not leak into the
 * renderer.
 *
 * `Terminal.handleDecPrivateMode` now routes 1000/1002/1003/1006 into the
 * `MouseHandler`. The renderer has no business reacting to these escapes,
 * so the painted document should be visually identical whether mouse
 * tracking is enabled or not. This screenshot is the baseline that guards
 * against accidental rendering side-effects in future refactors of the
 * DEC-mode dispatch path — if a regression ever paints a mouse cursor
 * indicator, mode banner, or repaints any cell on mode change, the diff
 * will catch it.
 *
 * The companion contract test (`test/integration/mouse_modes.test.ts`)
 * covers the wire-level behaviour. This spec only covers the *visual*
 * invariant.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (row 10).
 */
test.describe("visual A1 — DEC mouse modes are visually inert", () => {
	test("mouse-enable escapes do not alter the rendered document", async ({
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

		// tmux's typical mouse-enable preamble (VT200 tracking + SGR 1006
		// encoding), followed by ordinary text. The rendered surface must
		// match the surface produced by feeding just "hello\r\n" — i.e.
		// the DEC modes are renderer-invisible.
		await page.evaluate(() =>
			(
				window as unknown as {
					__sterkTest: { feedRaw: (s: string) => Promise<void> };
				}
			).__sterkTest.feedRaw("\x1b[?1000h\x1b[?1006hhello\r\n"),
		);

		// Sanity-check the buffer state: only the printable text should
		// have landed on row 0; the DEC escapes are consumed by the parser.
		const state = await page.evaluate(() =>
			(
				window as unknown as {
					__sterkTest: { dumpState: () => { lines: string[] } };
				}
			).__sterkTest.dumpState(),
		);
		expect(state.lines[0]).toBe("hello");

		await expect(page).toHaveScreenshot("mouse-modes-enable.png", {
			fullPage: true,
		});
	});
});
