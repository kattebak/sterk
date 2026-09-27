import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal as createHeadlessTerminal } from "../../src/headless.js";
import {
	type BufferView,
	createBufferView,
	createTerminalScreenSource,
} from "../../src/index.js";
import { FakeSource, line, numbered } from "./_fake_source.js";

interface AceDoc {
	getLength(): number;
	getLine(row: number): string;
	getAllLines(): string[];
}
interface AceView {
	getEditor(): {
		getSession(): {
			getDocument(): AceDoc;
			getTokens(row: number): { type: string; value: string }[];
		};
	};
}

function doc(view: BufferView): AceDoc {
	return (view as unknown as AceView).getEditor().getSession().getDocument();
}

function tokens(view: BufferView, row: number): string[] {
	return (view as unknown as AceView)
		.getEditor()
		.getSession()
		.getTokens(row)
		.map((token) => token.type);
}

let container: HTMLElement;
let view: BufferView | null = null;

beforeEach(() => {
	container = document.createElement("div");
	container.style.width = "800px";
	container.style.height = "400px";
	document.body.appendChild(container);
});

afterEach(() => {
	view?.dispose();
	view = null;
	container.remove();
});

function mount(
	source: FakeSource | ReturnType<typeof createTerminalScreenSource>,
) {
	view = createBufferView(container, source, { font: "" });
	return view;
}

describe("createBufferView", () => {
	it("draws history above the screen and starts at the bottom", () => {
		const source = new FakeSource(3);
		source.historyLines = numbered("old", 5).map((t) => line(t));
		const v = mount(source);
		expect(doc(v).getAllLines()).toEqual([
			...numbered("old", 5),
			"screen 0",
			"screen 1",
			"screen 2",
		]);
		expect(v.length).toBe(8);
		expect(v.viewportY).toBe(5);
	});

	it("appends history before the screen and follows the bottom", async () => {
		const source = new FakeSource(3);
		const v = mount(source);
		source.appendHistory(["a", "b"]);
		await v.refresh();
		expect(doc(v).getAllLines()).toEqual([
			"a",
			"b",
			"screen 0",
			"screen 1",
			"screen 2",
		]);
		expect(v.viewportY).toBe(2);
	});

	it("keeps the viewport on the same rows across appends when scrolled up", async () => {
		const source = new FakeSource(3);
		source.historyLines = numbered("row", 20).map((t) => line(t));
		const v = mount(source);
		v.scrollToLine(4);
		source.appendHistory(numbered("new", 5));
		await v.refresh();
		expect(v.viewportY).toBe(4);
		expect(doc(v).getLine(v.viewportY)).toBe("row 4");
	});

	it("keeps the viewport on the same rows across top trims", async () => {
		const source = new FakeSource(3);
		source.historyLines = numbered("row", 20).map((t) => line(t));
		const v = mount(source);
		v.scrollToLine(10);
		const scrolls: number[] = [];
		v.onScroll((top) => scrolls.push(top));
		source.trimHistory(6);
		source.appendHistory(numbered("new", 6));
		await v.refresh();
		expect(v.viewportY).toBe(4);
		expect(doc(v).getLine(4)).toBe("row 10");
		expect(doc(v).getLength()).toBe(23);
		expect(scrolls).toEqual([4]);
	});

	it("clamps to the top when the rows in view are trimmed", async () => {
		const source = new FakeSource(3);
		source.historyLines = numbered("row", 10).map((t) => line(t));
		const v = mount(source);
		v.scrollToLine(2);
		source.trimHistory(5);
		await v.refresh();
		expect(v.viewportY).toBe(0);
		expect(doc(v).getLine(0)).toBe("row 5");
	});

	it("merges appends and trims that land before one flush", async () => {
		const source = new FakeSource(2);
		source.historyLines = numbered("row", 4).map((t) => line(t));
		const v = mount(source);
		source.appendHistory(numbered("mid", 3));
		source.trimHistory(6);
		source.appendHistory(["end"]);
		await v.refresh();
		expect(doc(v).getAllLines()).toEqual([
			"mid 2",
			"end",
			"screen 0",
			"screen 1",
		]);
		expect(v.viewportY).toBe(2);
	});

	it("rewrites only the screen rows the change lists", async () => {
		const source = new FakeSource(3);
		const v = mount(source);
		source.screenLines[1] = line("status: ok");
		source.screenLines[2] = line("not announced");
		source.emit({ screenRows: [1] });
		await v.refresh();
		expect(doc(v).getAllLines()).toEqual([
			"screen 0",
			"status: ok",
			"screen 2",
		]);
	});

	it("re-tokenizes a screen row whose attributes changed but text did not", async () => {
		const source = new FakeSource(2);
		const v = mount(source);
		expect(tokens(v, 1)).toEqual([""]);
		source.screenLines[1] = line("screen 1", {
			fgMode: "Palette",
			fg: 1,
			bold: true,
		});
		source.emit({ screenRows: [1] });
		await v.refresh();
		expect(tokens(v, 1)).toEqual(["sterk-fg-1.sterk-bold"]);
	});

	it("draws hidden, struck and blinking runs with their own classes", async () => {
		const source = new FakeSource(1);
		const v = mount(source);
		source.screenLines[0] = {
			runs: [
				line("C", { invisible: true }).runs[0],
				line("D", { strikethrough: true }).runs[0],
				line("E", { blink: true }).runs[0],
			].filter((run) => run !== undefined),
			wrapped: false,
		};
		source.emit({ screenRows: [0] });
		await v.refresh();
		expect(tokens(v, 0)).toEqual([
			"sterk-invisible",
			"sterk-strikethrough",
			"sterk-blink",
		]);
	});

	it("repaints from scratch on a full change", async () => {
		const source = new FakeSource(3);
		source.historyLines = numbered("row", 5).map((t) => line(t));
		const v = mount(source);
		source.rows = 2;
		source.historyLines = [line("fresh")];
		source.screenLines = [line("s0"), line("s1")];
		source.emit({ full: true });
		await v.refresh();
		expect(doc(v).getAllLines()).toEqual(["fresh", "s0", "s1"]);
		expect(v.viewportY).toBe(1);
	});

	it("rebuilds when a change does not add up with the source", async () => {
		const source = new FakeSource(2);
		const v = mount(source);
		source.historyLines = [line("x"), line("y")];
		source.emit({ history: { removedTop: 0, appended: 5 } });
		await v.refresh();
		expect(doc(v).getAllLines()).toEqual(["x", "y", "screen 0", "screen 1"]);
	});

	it("offers the terminal scroll API", () => {
		const source = new FakeSource(4);
		source.historyLines = numbered("row", 20).map((t) => line(t));
		const v = mount(source);
		const scrolls: number[] = [];
		v.onScroll((top) => scrolls.push(top));
		v.scrollLines(-3);
		v.scrollPages(-1);
		v.scrollToTop();
		v.scrollLines(-1);
		v.scrollToLine(7);
		v.scrollToBottom();
		v.scrollLines(5);
		expect(scrolls).toEqual([17, 13, 0, 7, 20]);
		expect(v.viewportY).toBe(20);
	});

	it("joins wrapped rows when copying the selection", () => {
		const source = new FakeSource(3);
		source.screenLines = [
			line("hello "),
			line("world", {}, true),
			line("next"),
		];
		const v = mount(source);
		v.selectLines(0, 2);
		expect(v.getSelection()).toBe("hello world\nnext");
	});

	it("unsubscribes from the source on dispose", () => {
		const source = new FakeSource(2);
		const v = mount(source);
		expect(source.listenerCount).toBe(1);
		v.dispose();
		view = null;
		expect(source.listenerCount).toBe(0);
	});
});

describe("createBufferView over a headless sterk terminal", () => {
	it("draws the terminal's rows and holds position while it trims", async () => {
		const term = createHeadlessTerminal({ cols: 30, rows: 5, scrollback: 50 });
		const source = createTerminalScreenSource(term);
		term.write(numbered("line", 40).join("\r\n"));
		const v = mount(source);
		const buffer = term.buffer.active;
		const rows = Array.from({ length: buffer.length }, (_, i) =>
			buffer.getLine(i)?.translateToString(false),
		);
		expect(doc(v).getAllLines()).toEqual(rows);
		expect(v.viewportY).toBe(35);

		v.scrollToLine(20);
		term.write(`\r\n${numbered("more", 30).join("\r\n")}`);
		await v.refresh();
		const trimmed = buffer.baseY;
		expect(trimmed).toBeGreaterThan(0);
		expect(v.viewportY).toBe(20 - trimmed);
		expect(doc(v).getLine(v.viewportY)).toBe(
			buffer.getLine(v.viewportY)?.translateToString(false),
		);
		expect(doc(v).getLine(v.viewportY).trimEnd()).toBe("line 20");
		expect(doc(v).getLength()).toBe(buffer.length);
		source.dispose();
		term.dispose();
	});
});
