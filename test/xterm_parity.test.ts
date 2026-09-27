import xtermHeadless from "@xterm/headless";
import { afterEach, describe, expect, it } from "vitest";
import { createTerminal, type Terminal, type Theme } from "../src/index.js";

const { Terminal: XtermTerminal } = xtermHeadless;
type Xterm = InstanceType<typeof XtermTerminal>;

type Step = string | Uint8Array | { resize: [number, number] };

interface Size {
	cols: number;
	rows: number;
	convertEol?: boolean;
	theme?: Theme;
}

const open: { dispose(): void }[] = [];

function isResize(step: Step): step is { resize: [number, number] } {
	return typeof step === "object" && !(step instanceof Uint8Array);
}

function defined<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("expected a value");
	return value;
}

afterEach(() => {
	for (const t of open.splice(0)) t.dispose();
});

function sterkScreen(t: Terminal): string[] {
	const buf = t.buffer.active;
	const top = buf.length - t.rows;
	const rows: string[] = [];
	for (let y = 0; y < t.rows; y++) {
		rows.push(
			buf
				.getLine(top + y)
				?.translateToString(false)
				.trimEnd() ?? "",
		);
	}
	return rows;
}

function xtermScreen(t: Xterm): string[] {
	const buf = t.buffer.active;
	const rows: string[] = [];
	for (let y = 0; y < t.rows; y++) {
		rows.push(
			buf
				.getLine(buf.baseY + y)
				?.translateToString(false)
				.trimEnd() ?? "",
		);
	}
	return rows;
}

function runSterk(
	size: Size,
	steps: Step[],
): { term: Terminal; replies: string[] } {
	const term = createTerminal(size);
	open.push(term);
	const replies: string[] = [];
	term.onReply((r) => replies.push(r));
	for (const step of steps) {
		if (isResize(step)) term.resize(...step.resize);
		else term.write(step);
	}
	return { term, replies };
}

async function runXterm(
	size: Size,
	steps: Step[],
): Promise<{ term: Xterm; replies: string[] }> {
	const term = new XtermTerminal({ ...size, allowProposedApi: true });
	open.push(term);
	const replies: string[] = [];
	term.onData((r) => replies.push(r));
	for (const step of steps) {
		if (isResize(step)) {
			term.resize(...step.resize);
		} else {
			await new Promise<void>((resolve) => term.write(step, resolve));
		}
	}
	return { term, replies };
}

async function expectParity(
	size: Size,
	steps: Step[],
	expected: string[],
): Promise<{ sterk: string[]; xterm: string[] }> {
	const sterk = runSterk(size, steps);
	const xterm = await runXterm(size, steps);
	expect(xtermScreen(xterm.term)).toEqual(expected);
	expect(sterkScreen(sterk.term)).toEqual(expected);
	return { sterk: sterk.replies, xterm: xterm.replies };
}

describe("line feed (xterm parity)", () => {
	it("moves down one row in the same column", async () => {
		await expectParity(
			{ cols: 10, rows: 4 },
			["abc\r\ndef\r\n", "\x1b[3;3H\nZ"],
			["abc", "def", "", "  Z"],
		);
	});

	it("returns the carriage as well with convertEol", async () => {
		await expectParity(
			{ cols: 10, rows: 4, convertEol: true },
			["\x1b[3;3H\nZ"],
			["", "", "", "Z"],
		);
	});

	it("keeps a character split across byte writes intact", async () => {
		await expectParity(
			{ cols: 10, rows: 3, convertEol: true },
			[new Uint8Array([0x61, 0xc3]), new Uint8Array([0xa9, 0x0a, 0x62])],
			["a\u00e9", "b", ""],
		);
	});
});

describe("pending wrap (xterm parity)", () => {
	it("survives widening the terminal", async () => {
		await expectParity(
			{ cols: 5, rows: 3 },
			["abcde", { resize: [8, 3] }, "X"],
			["abcdeX", "", ""],
		);
	});

	it("is dropped when the terminal narrows", async () => {
		await expectParity(
			{ cols: 8, rows: 3 },
			["abcdefgh", { resize: [5, 3] }, "X"],
			["abcdX", "", ""],
		);
	});

	it("is dropped by a row-only resize", async () => {
		await expectParity(
			{ cols: 5, rows: 3 },
			["abcde", { resize: [5, 4] }, "X"],
			["abcdX", "", "", ""],
		);
	});

	it("is kept by a tab, so the next character wraps", async () => {
		await expectParity(
			{ cols: 10, rows: 3 },
			["abcdefghij\tX"],
			["abcdefghij", "X", ""],
		);
	});

	it("keeps the last column on EL 0 and ED 0", async () => {
		await expectParity(
			{ cols: 10, rows: 3 },
			["abcdefghij\x1b[K"],
			["abcdefghij", "", ""],
		);
		await expectParity(
			{ cols: 10, rows: 3 },
			["abcdefghij\x1b[J"],
			["abcdefghij", "", ""],
		);
	});

	it("clears the whole row on EL 1", async () => {
		await expectParity(
			{ cols: 10, rows: 3 },
			["abcdefghij\x1b[1K"],
			["", "", ""],
		);
	});

	it("reports the column past the last one in a cursor position report", async () => {
		const replies = await expectParity(
			{ cols: 10, rows: 3 },
			["abcdefghij\x1b[6n"],
			["abcdefghij", "", ""],
		);
		expect(replies.xterm).toEqual(["\x1b[1;11R"]);
		expect(replies.sterk).toEqual(replies.xterm);
	});
});

describe("markers follow scrolled rows", () => {
	const setup = "a\r\nb\r\nc\r\nSTATUS";

	it("keeps a status-row marker on the status row after a region scroll (xterm parity)", async () => {
		const sterk = runSterk({ cols: 10, rows: 4 }, [setup]);
		const xterm = await runXterm({ cols: 10, rows: 4 }, [setup]);
		const sm = sterk.term.registerMarker(0);
		const xm = defined(xterm.term.registerMarker(0));
		sterk.term.write("\x1b[1;3r\x1b[3;1H\n");
		await new Promise<void>((r) => xterm.term.write("\x1b[1;3r\x1b[3;1H\n", r));
		expect(
			xterm.term.buffer.active.getLine(xm.line)?.translateToString(true),
		).toBe("STATUS");
		expect(
			sterk.term.buffer.active.getLine(sm?.line ?? -1)?.translateToString(true),
		).toBe("STATUS");
	});

	it("disposes a marker on a deleted line (xterm parity)", async () => {
		const steps = [setup, "\x1b[1;1H"];
		const sterk = runSterk({ cols: 10, rows: 4 }, steps);
		const xterm = await runXterm({ cols: 10, rows: 4 }, steps);
		const sm = sterk.term.registerMarker(0);
		const xm = defined(xterm.term.registerMarker(0));
		sterk.term.write("\x1b[1;3r\x1b[1;1H\x1b[M");
		await new Promise<void>((r) =>
			xterm.term.write("\x1b[1;3r\x1b[1;1H\x1b[M", r),
		);
		expect(xm.isDisposed).toBe(true);
		expect(sm?.isDisposed).toBe(true);
	});

	it("moves a marker down on IL and disposes one pushed out of the region (xterm parity)", async () => {
		const sterk = runSterk({ cols: 10, rows: 4 }, [setup, "\x1b[2;1H"]);
		const smB = sterk.term.registerMarker(0);
		sterk.term.write("\x1b[3;1H");
		const smC = sterk.term.registerMarker(0);
		const xterm = await runXterm({ cols: 10, rows: 4 }, [setup, "\x1b[2;1H"]);
		const xmB = defined(xterm.term.registerMarker(0));
		await new Promise<void>((r) => xterm.term.write("\x1b[3;1H", r));
		const xmC = defined(xterm.term.registerMarker(0));
		sterk.term.write("\x1b[1;3r\x1b[2;1H\x1b[L");
		await new Promise<void>((r) =>
			xterm.term.write("\x1b[1;3r\x1b[2;1H\x1b[L", r),
		);
		expect([xmB.line, xmC.isDisposed]).toEqual([2, true]);
		expect([smB?.line, smC?.isDisposed]).toEqual([2, true]);
	});

	it("moves markers with a region that starts below the top", () => {
		const { term } = runSterk({ cols: 10, rows: 4 }, [setup, "\x1b[2;1H"]);
		const b = term.registerMarker(0);
		term.write("\x1b[3;1H");
		const c = term.registerMarker(0);
		term.write("\x1b[2;3r\x1b[3;1H\n");
		expect(b?.isDisposed).toBe(true);
		expect(
			term.buffer.active.getLine(c?.line ?? -1)?.translateToString(true),
		).toBe("c");
	});

	it("disposes a marker scrolled off the region bottom by RI", () => {
		const { term } = runSterk({ cols: 10, rows: 4 }, [setup, "\x1b[3;1H"]);
		const c = term.registerMarker(0);
		term.write("\x1b[2;1H");
		const b = term.registerMarker(0);
		term.write("\x1b[1;3r\x1b[1;1H\x1bM");
		expect(c?.isDisposed).toBe(true);
		expect(
			term.buffer.active.getLine(b?.line ?? -1)?.translateToString(true),
		).toBe("b");
	});

	it("disposes a marker on a blank row dropped by a shrink", () => {
		const { term } = runSterk({ cols: 10, rows: 6 }, ["1\r\n2", "\x1b[5;1H"]);
		const m = term.registerMarker(0);
		term.write("\x1b[2;2H");
		term.resize(10, 3);
		expect(m?.isDisposed).toBe(true);
	});
});

describe("colour query replies", () => {
	function replies(theme: Theme, query: string): string[] {
		return runSterk({ cols: 10, rows: 3, theme }, [query]).replies;
	}

	it("answers with the terminator the query used", () => {
		expect(replies({ foreground: "#112233" }, "\x1b]10;?\x07")).toEqual([
			"\x1b]10;rgb:1111/2222/3333\x07",
		]);
		expect(replies({ foreground: "#112233" }, "\x1b]10;?\x1b\\")).toEqual([
			"\x1b]10;rgb:1111/2222/3333\x1b\\",
		]);
	});

	it("does not answer for a colour it cannot parse", () => {
		expect(replies({ foreground: "red" }, "\x1b]10;?\x07")).toEqual([]);
		expect(replies({ background: "transparent" }, "\x1b]11;?\x07")).toEqual([]);
		expect(replies({ background: "#11223344" }, "\x1b]11;?\x07")).toEqual([]);
		expect(replies({ palette: ["black", "red"] }, "\x1b]4;1;?\x07")).toEqual(
			[],
		);
	});
});
