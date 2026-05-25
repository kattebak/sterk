import { expect, test } from "@playwright/test";
import { CORPUS } from "../../../src/demo/corpus.js";

/**
 * Deterministic screenshot baseline for the pulsing busy indicator.
 *
 * Animations are CSS-disabled in the Playwright config, so we drive the
 * in-place `busy-spinner-single` animation to ONE pinned mid-animation frame
 * (an EVEN frame, where the 256-colour brightness pulse on the word is active)
 * and screenshot that single committed frame. This gives a pixel baseline for
 * the busy indicator going forward — a regression in the pulse colour / span
 * classes / cell layout will show up as a pixel diff here.
 */

interface HarnessWindow {
	__sterkTest: {
		ready: Promise<void>;
		feedFrames: (frames: string[]) => Promise<void>;
		dumpState: () => { lines: string[] };
	};
}

// Pin to frame index 4: even → palette fg pulse active, spinner glyph ⠼,
// counter "(4s · still thinking)".
const PINNED_FRAME = 4;

test.describe("busy indicator", () => {
	test("pulsing busy indicator at a pinned mid-animation frame", async ({
		page,
	}) => {
		const entry = CORPUS.find((e) => e.id === "busy-spinner-single");
		if (!entry?.frames) throw new Error("missing busy-spinner-single");

		await page.goto("/test/visual/harness/index.html");
		await page.waitForFunction(
			() =>
				typeof (window as unknown as { __sterkTest?: unknown }).__sterkTest ===
				"object",
		);
		await page.evaluate(
			() => (window as unknown as HarnessWindow).__sterkTest.ready,
		);

		// Drive frames 0..PINNED_FRAME cumulatively so the in-place redraws land
		// on a deterministic, pulse-active frame.
		const frames = entry.frames.slice(0, PINNED_FRAME + 1);
		await page.evaluate(
			(f) => (window as unknown as HarnessWindow).__sterkTest.feedFrames(f),
			frames,
		);

		const state = await page.evaluate(() =>
			(window as unknown as HarnessWindow).__sterkTest.dumpState(),
		);
		expect(state.lines[0]).toContain("Transfiguring…");
		expect(state.lines[0]).toContain("(4s · still thinking)");

		await expect(page).toHaveScreenshot("busy-indicator-pinned.png", {
			fullPage: true,
		});
	});
});
