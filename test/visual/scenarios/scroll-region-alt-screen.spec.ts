import { expect, type Page, test } from "@playwright/test";

/**
 * tmux scrolls a pane by setting a scroll region above its status line on
 * the alternate screen and feeding line feeds at the region's bottom
 * margin. The rendered rows must show the newest lines in the region, the
 * status line exactly once on the last row, and no alternate-screen row
 * may reach the normal screen's scrollback.
 */

type HarnessWindow = {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		shrinkAndResyncGrid: (
			pxFromBottom: number,
		) => Promise<{ cols: number; rows: number } | null>;
		dumpState: () => {
			lines: string[];
			linesRaw: string[];
			rows: number;
			length: number;
		};
		dumpDom: () => { lines: { text: string }[] };
	};
};

const STATUS = "[STATUS] pane 0";
const ROUNDS = 3;
const LINES_PER_ROUND = 60;

function label(round: number, line: number): string {
	return `r${round}-line-${line.toString().padStart(2, "0")}`;
}

function roundPayload(round: number): string {
	let out = "";
	for (let line = 1; line <= LINES_PER_ROUND; line++) {
		out += `\r\n${label(round, line)}`;
	}
	return out;
}

const feedRaw = (page: Page, data: string) =>
	page.evaluate(
		(d) => (window as unknown as HarnessWindow).__sterkTest.feedRaw(d),
		data,
	);

const dumpState = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as HarnessWindow).__sterkTest.dumpState(),
	);

const dumpDom = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as HarnessWindow).__sterkTest.dumpDom(),
	);

test("scroll region on the alternate screen keeps the status line and scrollback clean", async ({
	page,
}) => {
	await page.goto("/test/visual/harness/index.html");
	await page.waitForFunction(
		() =>
			typeof (window as unknown as { __sterkTest?: unknown }).__sterkTest ===
			"object",
	);
	await page.evaluate(
		() => (window as unknown as HarnessWindow).__sterkTest.ready,
	);
	const grid = await page.evaluate(() =>
		(window as unknown as HarnessWindow).__sterkTest.shrinkAndResyncGrid(0),
	);
	const rows = grid?.rows ?? 0;
	expect(rows).toBeGreaterThan(3);
	expect(rows - 1).toBeLessThanOrEqual(ROUNDS * LINES_PER_ROUND);

	const shellLines = Array.from(
		{ length: rows * 2 },
		(_, i) => `shell-${i.toString().padStart(3, "0")}`,
	);
	await feedRaw(page, `${shellLines.join("\r\n")}\r\n`);
	const before = await dumpState(page);
	const scrollbackBefore = before.lines.slice(0, before.length - before.rows);
	expect(scrollbackBefore.length).toBeGreaterThan(0);

	await feedRaw(
		page,
		`\x1b[?1049h\x1b[H\x1b[2J\x1b[${rows};1H${STATUS}\x1b[1;${rows - 1}r\x1b[${rows - 1};1H`,
	);
	const all: string[] = [];
	for (let round = 1; round <= ROUNDS; round++) {
		await feedRaw(page, roundPayload(round));
		for (let line = 1; line <= LINES_PER_ROUND; line++) {
			all.push(label(round, line));
		}
	}

	const expected = [...all.slice(-(rows - 1)), STATUS];

	const state = await dumpState(page);
	expect(state.length).toBe(rows);
	expect(state.lines).toEqual(expected);

	const dom = await dumpDom(page);
	const rendered = dom.lines.slice(0, rows).map((l) => l.text.trimEnd());
	expect(rendered).toEqual(expected);
	expect(dom.lines.filter((l) => l.text.includes(STATUS))).toHaveLength(1);

	await feedRaw(page, "\x1b[r\x1b[?1049l");
	const normal = await dumpState(page);
	const scrollbackAfter = normal.lines.slice(0, normal.length - normal.rows);
	expect(scrollbackAfter).toEqual(scrollbackBefore);
	expect(scrollbackAfter.filter((l) => /^r\d-line-|STATUS/.test(l))).toEqual(
		[],
	);
	expect(normal.lines.filter((l) => /^r\d-line-/.test(l))).toEqual([]);
});
