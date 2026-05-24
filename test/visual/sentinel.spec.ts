import { expect, test } from "@playwright/test";

/**
 * D1 sentinel — smoke test for the visual-regression harness.
 *
 * This test exists to prove the whole pipeline works: harness page loads,
 * sterk boots from dist, `window.__sterkTest.feedRaw` writes into the
 * terminal, and Playwright's screenshot diff against the committed baseline
 * stays under `maxDiffPixelRatio`. Subsequent PRs (D2/D3/...) add the real
 * scenario catalogue on top of this.
 */
test.describe("visual harness sentinel", () => {
	test("renders 'hello world' deterministically", async ({ page }) => {
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
		await page.evaluate(() =>
			(
				window as unknown as {
					__sterkTest: { feedRaw: (s: string) => Promise<void> };
				}
			).__sterkTest.feedRaw("hello world\r\n"),
		);

		const state = await page.evaluate(() =>
			(
				window as unknown as {
					__sterkTest: { dumpState: () => { lines: string[] } };
				}
			).__sterkTest.dumpState(),
		);
		expect(state.lines[0]).toBe("hello world");

		await expect(page).toHaveScreenshot("sentinel-hello-world.png", {
			fullPage: true,
		});
	});
});
