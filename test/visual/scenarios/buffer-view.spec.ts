import { expect, type Page, test } from "@playwright/test";

/**
 * Buffer view over a supplied buffer: a headless sterk terminal feeds a
 * ScreenSource and `createBufferView` draws it. Asserts the rows Ace puts
 * on screen and the viewport position while output keeps arriving.
 */

interface ViewState {
	viewportY: number;
	length: number;
	rows: number;
	baseY: number;
	sourceRows: string[];
}

interface HarnessWindow {
	__bufferViewTest: {
		ready: Promise<void>;
		mount: (options: { rows?: number; scrollback?: number }) => Promise<void>;
		feedLines: (count: number, from?: number) => Promise<void>;
		paintStatus: (text: string) => Promise<void>;
		scrollLines: (amount: number) => Promise<void>;
		scrollToBottom: () => Promise<void>;
		renderedRows: () => string[];
		state: () => ViewState;
	};
}

const harness = (page: Page) =>
	({
		feedLines: (count: number, from = 0) =>
			page.evaluate(
				([c, f]) =>
					(window as unknown as HarnessWindow).__bufferViewTest.feedLines(c, f),
				[count, from] as const,
			),
		paintStatus: (text: string) =>
			page.evaluate(
				(t) =>
					(window as unknown as HarnessWindow).__bufferViewTest.paintStatus(t),
				text,
			),
		scrollLines: (amount: number) =>
			page.evaluate(
				(n) =>
					(window as unknown as HarnessWindow).__bufferViewTest.scrollLines(n),
				amount,
			),
		scrollToBottom: () =>
			page.evaluate(() =>
				(window as unknown as HarnessWindow).__bufferViewTest.scrollToBottom(),
			),
		mount: (options: { rows?: number; scrollback?: number }) =>
			page.evaluate(
				(o) => (window as unknown as HarnessWindow).__bufferViewTest.mount(o),
				options,
			),
		rendered: () =>
			page.evaluate(() =>
				(window as unknown as HarnessWindow).__bufferViewTest.renderedRows(),
			),
		state: () =>
			page.evaluate(() =>
				(window as unknown as HarnessWindow).__bufferViewTest.state(),
			),
	}) as const;

const label = (i: number) => `line ${i.toString().padStart(3, "0")}`;

async function boot(page: Page) {
	await page.goto("/test/visual/harness/buffer-view.html");
	await page.waitForFunction(
		() =>
			typeof (window as unknown as { __bufferViewTest?: unknown })
				.__bufferViewTest === "object",
	);
	await page.evaluate(
		() => (window as unknown as HarnessWindow).__bufferViewTest.ready,
	);
	return harness(page);
}

test.describe("buffer view over a supplied buffer", () => {
	test("draws scrollback and a status line, and holds position while scrolled up", async ({
		page,
	}) => {
		const h = await boot(page);
		await h.feedLines(200);
		await h.paintStatus(" STATUS 200 lines ");

		const bottom = await h.state();
		expect(bottom.rows).toBe(24);
		expect(bottom.length).toBe(201);
		expect(bottom.viewportY).toBe(177);
		const rows = await h.rendered();
		expect(rows).toEqual(bottom.sourceRows);
		expect(rows[0]).toBe(label(177));
		expect(rows[22]).toBe(label(199));
		expect(rows[23]).toBe(" STATUS 200 lines");

		await h.scrollLines(-50);
		const scrolled = await h.state();
		expect(scrolled.viewportY).toBe(127);
		const scrolledRows = await h.rendered();
		expect(scrolledRows).toEqual(scrolled.sourceRows);
		expect(scrolledRows[0]).toBe(label(127));
		expect(scrolledRows[23]).toBe(label(150));

		await h.feedLines(10, 200);
		const held = await h.state();
		expect(held.viewportY).toBe(127);
		expect(held.length).toBe(211);
		expect(await h.rendered()).toEqual(scrolledRows);

		await h.scrollToBottom();
		const back = await h.state();
		expect(back.viewportY).toBe(back.length - back.rows);
		const backRows = await h.rendered();
		expect(backRows).toEqual(back.sourceRows);
		expect(backRows[22]).toBe(label(209));
	});

	test("keeps the same rows in view while the history is trimmed", async ({
		page,
	}) => {
		const h = await boot(page);
		await h.mount({ rows: 24, scrollback: 100 });
		await h.feedLines(200);
		await h.scrollLines(-40);
		const before = await h.state();
		const beforeRows = await h.rendered();
		expect(beforeRows[0]).toBe(label(137));

		await h.feedLines(15, 200);
		const after = await h.state();
		expect(after.baseY - before.baseY).toBe(15);
		expect(after.viewportY).toBe(before.viewportY - 15);
		expect(await h.rendered()).toEqual(beforeRows);
	});
});
