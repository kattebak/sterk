import xtermHeadless from "@xterm/headless";
import { describe, expect, it } from "vitest";
import { createTerminal } from "../../src/headless.js";
import {
	createTerminalScreenSource,
	type LineLike,
	type ScreenChange,
	screenLineFromCells,
} from "../../src/index.js";

function text(line: { runs: readonly { text: string }[] }): string {
	return line.runs.map((run) => run.text).join("");
}

function record(term: ReturnType<typeof createTerminal>) {
	const source = createTerminalScreenSource(term);
	const changes: ScreenChange[] = [];
	source.subscribe((change) => changes.push(change));
	return { source, changes };
}

describe("createTerminalScreenSource", () => {
	it("splits the buffer into history and screen", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		term.write("a\r\nb\r\nc\r\nd\r\ne");
		const source = createTerminalScreenSource(term);
		expect(source.history.length).toBe(2);
		expect(text(source.history.line(0)).trimEnd()).toBe("a");
		expect(text(source.screen.line(2)).trimEnd()).toBe("e");
		expect(source.cursor).toEqual({ x: 1, y: 2, visible: true });
	});

	it("reports rows scrolled into the history as appended", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		const { changes } = record(term);
		term.write("a\r\nb\r\nc\r\nd");
		expect(changes.at(-1)).toEqual({
			history: { removedTop: 0, appended: 1 },
			screenRows: [0, 1, 2],
			full: false,
		});
	});

	it("reports rows dropped from the top as removedTop", () => {
		const term = createTerminal({ cols: 10, rows: 2, scrollback: 3 });
		term.write("1\r\n2\r\n3\r\n4\r\n5\r\n");
		const { source, changes } = record(term);
		term.write("6\r\n7\r\n");
		expect(changes.at(-1)?.history).toEqual({ removedTop: 2, appended: 2 });
		expect(source.history.length).toBe(3);
		expect(text(source.history.line(0)).trimEnd()).toBe("4");
	});

	it("lists only the screen rows that changed", () => {
		const term = createTerminal({ cols: 10, rows: 4 });
		term.write("a\r\nb\r\nc");
		const { changes } = record(term);
		term.write("\x1b[2;1H\x1b[7mB\x1b[0m");
		expect(changes.at(-1)).toEqual({
			history: { removedTop: 0, appended: 0 },
			screenRows: [1],
			full: false,
		});
	});

	it("reports a cursor move with no content change", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		const { changes } = record(term);
		term.write("\x1b[3;4H");
		expect(changes).toEqual([
			{ history: { removedTop: 0, appended: 0 }, screenRows: [], full: false },
		]);
	});

	it("stays quiet when a write changes nothing", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		const { changes } = record(term);
		term.write("\x1b[0m");
		expect(changes).toEqual([]);
	});

	it("asks for a full repaint on a buffer switch and on resize", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		const { changes } = record(term);
		term.write("\x1b[?1049h");
		term.resize(12, 4);
		expect(changes.map((change) => change.full)).toEqual([true, true]);
	});

	it("stops notifying once disposed", () => {
		const term = createTerminal({ cols: 10, rows: 3 });
		const { source, changes } = record(term);
		source.dispose();
		term.write("x");
		expect(changes).toEqual([]);
	});
});

describe("screenLineFromCells", () => {
	it("groups sterk cells into runs by attribute", () => {
		const term = createTerminal({ cols: 8, rows: 1 });
		term.write("ab\x1b[1;31mcd\x1b[0m");
		const line = term.buffer.active.getLine(0);
		if (!line) throw new Error("no line");
		const { runs } = screenLineFromCells(line, 8);
		expect(runs.map((run) => run.text)).toEqual(["ab", "cd", "    "]);
		expect(runs[1]?.attrs).toMatchObject({
			fgMode: "Palette",
			fg: 1,
			bold: true,
		});
	});

	it("reads an @xterm/headless line the same way", async () => {
		const xterm = new xtermHeadless.Terminal({
			cols: 8,
			rows: 2,
			allowProposedApi: true,
		});
		await new Promise<void>((resolve) =>
			xterm.write("ab\x1b[1;31mcd\x1b[0m\x1b[38;2;1;2;3m中\x1b[0m", resolve),
		);
		const xtermLine: LineLike | undefined = xterm.buffer.active.getLine(0);
		if (!xtermLine) throw new Error("no line");
		const { runs, wrapped } = screenLineFromCells(xtermLine, 8);
		expect(wrapped).toBe(false);
		expect(runs.map((run) => run.text)).toEqual(["ab", "cd", "中", "  "]);
		expect(runs[1]?.attrs).toMatchObject({
			fgMode: "Palette",
			fg: 1,
			bold: true,
		});
		expect(runs[2]?.attrs).toMatchObject({ fgMode: "Rgb", fg: 0x010203 });
		xterm.dispose();
	});
});
