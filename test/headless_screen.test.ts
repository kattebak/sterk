import { afterEach, describe, expect, it } from "vitest";
import { createTerminal, type Terminal } from "../src/index.js";

let term: Terminal;

afterEach(() => {
	term?.dispose();
});

function screen(t: Terminal): string[] {
	const buf = t.buffer.active;
	const top = buf.length - t.rows;
	const rows: string[] = [];
	for (let y = 0; y < t.rows; y++) {
		rows.push(buf.getLine(top + y)?.translateToString(true) ?? "");
	}
	return rows;
}

function scrollback(t: Terminal): string[] {
	const buf = t.buffer.active;
	const rows: string[] = [];
	for (let y = 0; y < buf.length - t.rows; y++) {
		rows.push(buf.getLine(y)?.translateToString(true) ?? "");
	}
	return rows;
}

function statusScreen(alternate: boolean): Terminal {
	const t = createTerminal({ cols: 10, rows: 4, scrollback: 100 });
	if (alternate) t.write("\x1b[?1049h");
	t.write("a\r\nb\r\nc\r\nSTATUS");
	return t;
}

describe.each([
	["alternate", true],
	["normal", false],
])("scroll region on the %s screen", (_name, alternate) => {
	it("scrolls the region on a line feed at its bottom margin", () => {
		term = statusScreen(alternate);
		term.write("\x1b[1;3r\x1b[3;1H\n");
		expect(screen(term)).toEqual(["b", "c", "", "STATUS"]);
	});

	it("scrolls the region up with CSI S", () => {
		term = statusScreen(alternate);
		term.write("\x1b[1;3r\x1b[1S");
		expect(screen(term)).toEqual(["b", "c", "", "STATUS"]);
	});

	it("scrolls the region on IND at its bottom margin", () => {
		term = statusScreen(alternate);
		term.write("\x1b[1;3r\x1b[3;1H\x1bD");
		expect(screen(term)).toEqual(["b", "c", "", "STATUS"]);
	});

	it("scrolls the region on NEL at its bottom margin and returns the carriage", () => {
		term = statusScreen(alternate);
		term.write("\x1b[1;3r\x1b[3;5H\x1bEx");
		expect(screen(term)).toEqual(["b", "c", "x", "STATUS"]);
	});

	it("scrolls the region down on RI at its top margin", () => {
		term = statusScreen(alternate);
		term.write("\x1b[1;3r\x1b[1;1H\x1bM");
		expect(screen(term)).toEqual(["", "a", "b", "STATUS"]);
	});

	it("scrolls the region down with CSI T", () => {
		term = statusScreen(alternate);
		term.write("\x1b[1;3r\x1b[1T");
		expect(screen(term)).toEqual(["", "a", "b", "STATUS"]);
	});

	it("deletes a line inside the region with CSI M", () => {
		term = statusScreen(alternate);
		term.write("\x1b[1;3r\x1b[1;1H\x1b[M");
		expect(screen(term)).toEqual(["b", "c", "", "STATUS"]);
	});

	it("inserts a line inside the region with CSI L", () => {
		term = statusScreen(alternate);
		term.write("\x1b[1;3r\x1b[2;1H\x1b[L");
		expect(screen(term)).toEqual(["a", "", "b", "STATUS"]);
	});

	it("keeps rows above a region that starts below the top", () => {
		term = statusScreen(alternate);
		term.write("\x1b[2;3r\x1b[3;1H\n");
		expect(screen(term)).toEqual(["a", "c", "", "STATUS"]);
	});
});

describe("scroll region scrollback", () => {
	it("keeps alternate-screen rows out of scrollback", () => {
		term = statusScreen(true);
		term.write("\x1b[1;3r\x1b[3;1H\n\n\n");
		expect(term.buffer.active.length).toBe(4);
		term.write("\x1b[r\x1b[?1049l");
		expect(term.buffer.active.type).toBe("normal");
		expect(scrollback(term)).toEqual([]);
	});

	it("moves the top row into scrollback on the normal screen", () => {
		term = statusScreen(false);
		term.write("\x1b[1;3r\x1b[3;1H\n");
		expect(scrollback(term)).toEqual(["a"]);
	});
});

describe("resize", () => {
	it("grows the screen so the cursor and line feeds reach the new rows", () => {
		term = createTerminal({ cols: 10, rows: 4 });
		term.write("1\r\n2\r\n3\r\n4");
		term.resize(10, 6);
		term.write("\x1b[H\r\n\r\n\r\n\r\n\r\nz");
		expect(screen(term)).toEqual(["1", "2", "3", "4", "", "z"]);
		expect(term.buffer.active.length).toBe(6);
	});

	it("shrinks the screen with the cursor still on its row", () => {
		term = createTerminal({ cols: 10, rows: 6 });
		term.write("1\r\n2\r\n3\r\n4\r\n5\r\n6");
		term.resize(10, 3);
		term.write("Y");
		expect(screen(term)).toEqual(["4", "5", "6Y"]);
		expect(scrollback(term)).toEqual(["1", "2", "3"]);
	});

	it("drops blank rows below the cursor when the screen shrinks", () => {
		term = createTerminal({ cols: 10, rows: 6 });
		term.write("1\r\n2");
		term.resize(10, 3);
		term.write("X");
		expect(screen(term)).toEqual(["1", "2X", ""]);
		expect(term.buffer.active.length).toBe(3);
	});

	it("grows the alternate screen", () => {
		term = createTerminal({ cols: 10, rows: 4 });
		term.write("\x1b[?1049h");
		term.resize(10, 6);
		term.write("1\r\n2\r\n3\r\n4\r\n5\r\n6");
		expect(screen(term)).toEqual(["1", "2", "3", "4", "5", "6"]);
		expect(term.buffer.active.length).toBe(6);
	});

	it("resizes the inactive screen too", () => {
		term = createTerminal({ cols: 10, rows: 4 });
		term.write("\x1b[?1049h");
		term.resize(10, 6);
		term.write("\x1b[?1049l\x1b[6;1HZ");
		expect(term.buffer.active.length).toBe(6);
		expect(screen(term)).toEqual(["", "", "", "", "", "Z"]);
	});
});

describe("autowrap", () => {
	it("wraps a line written on the bottom row onto a new bottom row", () => {
		term = createTerminal({ cols: 10, rows: 3 });
		term.write("1\r\n2\r\nABCDEFGHIJKL");
		expect(screen(term)).toEqual(["2", "ABCDEFGHIJ", "KL"]);
		const buf = term.buffer.active;
		expect(buf.getLine(buf.length - 1)?.isWrapped).toBe(true);
	});

	it("leaves a full bottom row in place until the next character", () => {
		term = createTerminal({ cols: 10, rows: 3 });
		term.write("1\r\n2\r\nABCDEFGHIJ");
		expect(screen(term)).toEqual(["1", "2", "ABCDEFGHIJ"]);
	});

	it("wraps below the screen top once there is scrollback", () => {
		term = createTerminal({ cols: 10, rows: 3 });
		term.write("1\r\n2\r\n3\r\n4\r\nABCDEFGHIJKL");
		expect(screen(term)).toEqual(["4", "ABCDEFGHIJ", "KL"]);
		expect(scrollback(term)).toEqual(["1", "2", "3"]);
	});
});

describe("erase in display", () => {
	function withScrollback(): Terminal {
		const t = createTerminal({ cols: 10, rows: 3, scrollback: 100 });
		t.write("1\r\n2\r\n3\r\n4\r\n5");
		return t;
	}

	it("ED 2 clears the screen and keeps scrollback", () => {
		term = withScrollback();
		term.write("\x1b[2J");
		expect(screen(term)).toEqual(["", "", ""]);
		expect(scrollback(term)).toEqual(["1", "2"]);
	});

	it("ED 3 clears scrollback and keeps the screen", () => {
		term = withScrollback();
		term.write("\x1b[3J");
		expect(scrollback(term)).toEqual([]);
		expect(screen(term)).toEqual(["3", "4", "5"]);
		term.write("X");
		expect(screen(term)).toEqual(["3", "4", "5X"]);
	});
});

describe("line feed after a cursor move", () => {
	it("moves down one screen row when there is scrollback", () => {
		term = createTerminal({ cols: 10, rows: 3 });
		term.write("1\r\n2\r\n3\r\n4\r\n5");
		term.write("\x1b[1;1H\nX");
		expect(screen(term)).toEqual(["3", "X", "5"]);
		expect(scrollback(term)).toEqual(["1", "2"]);
	});

	it("scrolls only from the bottom row", () => {
		term = createTerminal({ cols: 10, rows: 3 });
		term.write("1\r\n2\r\n3\r\n4\r\n5");
		term.write("\x1b[2;1H\n\nX");
		expect(screen(term)).toEqual(["4", "5", "X"]);
	});
});

describe("device query replies", () => {
	function replies(t: Terminal, data: string): string[] {
		const out: string[] = [];
		const sub = t.onReply((reply) => out.push(reply));
		t.write(data);
		sub.dispose();
		return out;
	}

	it("answers primary and secondary device attributes", () => {
		term = createTerminal({ cols: 10, rows: 4 });
		expect(replies(term, "\x1b[c")).toEqual(["\x1b[?1;2c"]);
		expect(replies(term, "\x1b[0c")).toEqual(["\x1b[?1;2c"]);
		expect(replies(term, "\x1b[>c")).toEqual(["\x1b[>0;276;0c"]);
	});

	it("answers status and cursor position reports", () => {
		term = createTerminal({ cols: 10, rows: 3 });
		expect(replies(term, "\x1b[5n")).toEqual(["\x1b[0n"]);
		term.write("1\r\n2\r\n3\r\n4\r\n5");
		expect(replies(term, "\x1b[2;3H\x1b[6n")).toEqual(["\x1b[2;3R"]);
		expect(replies(term, "\x1b[?6n")).toEqual(["\x1b[?2;3R"]);
	});

	it("answers colour queries from the theme", () => {
		term = createTerminal({
			cols: 10,
			rows: 4,
			theme: {
				foreground: "#112233",
				background: "#445566",
				cursor: "#778899",
				palette: ["#000000", "#abcdef"],
			},
		});
		expect(replies(term, "\x1b]10;?\x07")).toEqual([
			"\x1b]10;rgb:1111/2222/3333\x07",
		]);
		expect(replies(term, "\x1b]11;?\x1b\\")).toEqual([
			"\x1b]11;rgb:4444/5555/6666\x1b\\",
		]);
		expect(replies(term, "\x1b]12;?\x07")).toEqual([
			"\x1b]12;rgb:7777/8888/9999\x07",
		]);
		expect(replies(term, "\x1b]4;1;?\x07")).toEqual([
			"\x1b]4;1;rgb:abab/cdcd/efef\x07",
		]);
	});

	it("does not send replies as user input", () => {
		term = createTerminal({ cols: 10, rows: 4 });
		const data: string[] = [];
		term.onData((d) => data.push(d));
		term.write("\x1b[c\x1b[6n\x1b]10;?\x07");
		expect(data).toEqual([]);
	});
});
