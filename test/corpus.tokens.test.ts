/**
 * Corpus token/cell snapshot gate.
 *
 * For every entry in the shared corpus (src/demo/corpus.ts) this:
 *   (a) writes entry.bytes into a fresh terminal and snapshots a combined
 *       token-stream + per-cell-attribute dump, keyed by entry.id — a full
 *       deterministic regression net for SGR-attribute and cell-width bugs.
 *   (b) asserts EXPLICIT invariants for the known bug shapes (SGR background /
 *       space boundaries, CJK wide-char placeholders, combining marks). These
 *       are NOT just snapshots — they encode the *correct* behaviour, so if one
 *       fails it is flagging a real renderer bug. Do not weaken them to go green.
 */

import { afterEach, describe, expect, it } from "vitest";
import { CORPUS, type CorpusEntry } from "../src/demo/corpus.js";
import { createTerminal } from "../src/index.js";
import {
	activeCols,
	type CellDump,
	dumpCells,
	dumpTokens,
	type Term,
	type TokenDump,
} from "./_dump.js";

interface LineDump {
	row: number;
	text: string;
	tokens: TokenDump[];
	cells: CellDump[];
}

/**
 * Build a dump for every non-empty buffer line produced by writing
 * entry.bytes into a fresh terminal. Returns both the dump and the live
 * terminal so callers can run extra cell-level invariants before disposing.
 */
function renderEntry(entry: CorpusEntry): { term: Term; lines: LineDump[] } {
	const term = createTerminal({
		cols: entry.cols ?? 80,
		rows: entry.rows ?? 24,
	});
	term.write(entry.bytes);

	const buffer = term.buffer.active;
	const lines: LineDump[] = [];
	for (let row = 0; row < buffer.length; row++) {
		const line = buffer.getLine(row);
		if (!line) continue;
		const text = line.translateToString(false);
		if (text.trim() === "") continue; // skip blank lines
		lines.push({
			row,
			text,
			tokens: dumpTokens(term, row),
			cells: dumpCells(term, row),
		});
	}
	return { term, lines };
}

/** Find the first non-blank row index of the active buffer. */
function firstContentRow(term: Term): number {
	const buffer = term.buffer.active;
	for (let row = 0; row < buffer.length; row++) {
		const line = buffer.getLine(row);
		if (line && line.translateToString(false).trim() !== "") return row;
	}
	return 0;
}

describe("Corpus token/cell snapshot gate", () => {
	let activeTerm: Term | null = null;

	afterEach(() => {
		if (activeTerm) {
			activeTerm.dispose();
			activeTerm = null;
		}
	});

	// (a) Full regression snapshot for EVERY corpus entry, keyed by id.
	describe("snapshots (all entries)", () => {
		for (const entry of CORPUS) {
			it(`${entry.category}: ${entry.id}`, () => {
				const { term, lines } = renderEntry(entry);
				activeTerm = term;
				expect(lines).toMatchSnapshot(entry.id);
			});
		}
	});

	// (b) Explicit invariants for the known bug shapes.

	describe("sgr: background / space boundaries", () => {
		const entry = CORPUS.find((e) => e.id === "sgr-bg-space-boundaries");

		it("plain inter-word spaces carry no bg; colored spaces do", () => {
			if (!entry) throw new Error("missing sgr-bg-space-boundaries entry");
			const term = createTerminal({ cols: 80, rows: 24 });
			activeTerm = term;
			term.write(entry.bytes);

			const buffer = term.buffer.active;
			const row = firstContentRow(term);
			const line = buffer.getLine(row);
			if (!line) throw new Error("no content line");

			// Line layout (cols): open<sp>+<sp>watching
			//   0..3  o p e n
			//   4     ' ' green bg (SGR 42)  -> MUST have bg
			//   5     '+'
			//   6     ' ' red bg   (SGR 41)  -> MUST have bg
			//   7..   watching
			const text = line.translateToString(false);
			expect(text.startsWith("open + watching")).toBe(true);

			// The two SGR-colored space cells.
			const greenSpace = line.getCell(4);
			const redSpace = line.getCell(6);
			expect(greenSpace.getChars()).toBe(" ");
			expect(redSpace.getChars()).toBe(" ");
			expect(greenSpace.isBgDefault()).toBe(false);
			expect(greenSpace.isBgPalette()).toBe(true);
			expect(greenSpace.getBgColor()).toBe(2); // ANSI green
			expect(redSpace.isBgDefault()).toBe(false);
			expect(redSpace.isBgPalette()).toBe(true);
			expect(redSpace.getBgColor()).toBe(1); // ANSI red

			// There are no plain inter-word spaces on THIS line (every space is
			// colored), so verify the surrounding word cells stay default-bg.
			expect(line.getCell(0).isBgDefault()).toBe(true); // 'o'
			expect(line.getCell(5).isBgDefault()).toBe(true); // '+'
			expect(line.getCell(7).isBgDefault()).toBe(true); // 'w'

			// Token-level: the colored space tokens must contain a sterk-bg class,
			// and tokens for default-bg text must NOT.
			const tokens = dumpTokens(term, row);
			const greenSpaceToken = tokens.find(
				(t) => t.value === " " && t.type.includes("sterk-bg-2"),
			);
			const redSpaceToken = tokens.find(
				(t) => t.value === " " && t.type.includes("sterk-bg-1"),
			);
			expect(greenSpaceToken).toBeTruthy();
			expect(redSpaceToken).toBeTruthy();

			// The "watching" run must have NO sterk-bg class.
			const watchingToken = tokens.find((t) => t.value.includes("watching"));
			expect(watchingToken).toBeTruthy();
			expect(watchingToken?.type.includes("sterk-bg")).toBe(false);
		});

		it("the clean 'exit code 0' line has NO color on any cell", () => {
			if (!entry) throw new Error("missing entry");
			const term = createTerminal({ cols: 80, rows: 24 });
			activeTerm = term;
			term.write(entry.bytes);

			const buffer = term.buffer.active;
			// Find the 'exit code 0' row.
			let exitRow = -1;
			for (let row = 0; row < buffer.length; row++) {
				const l = buffer.getLine(row);
				if (l && l.translateToString(true) === "exit code 0") {
					exitRow = row;
					break;
				}
			}
			expect(exitRow).toBeGreaterThanOrEqual(0);

			const line = buffer.getLine(exitRow);
			if (!line) throw new Error("no exit line");
			for (let x = 0; x < "exit code 0".length; x++) {
				const cell = line.getCell(x);
				expect(cell.isFgDefault()).toBe(true);
				expect(cell.isBgDefault()).toBe(true);
				expect(cell.isBold()).toBe(false);
			}

			// Token/document parity for this clean line.
			const tokens = dumpTokens(term, exitRow);
			const joined = tokens.map((t) => t.value).join("");
			expect(joined).toBe(line.translateToString(false));
		});

		it("token/document parity holds on the colored boundary line", () => {
			if (!entry) throw new Error("missing entry");
			const term = createTerminal({ cols: 80, rows: 24 });
			activeTerm = term;
			term.write(entry.bytes);

			const row = firstContentRow(term);
			const line = term.buffer.active.getLine(row);
			if (!line) throw new Error("no line");
			const tokens = dumpTokens(term, row);
			const joined = tokens.map((t) => t.value).join("");
			expect(joined).toBe(line.translateToString(false));
		});
	});

	describe("cjk: wide-char placeholders", () => {
		const entry = CORPUS.find((e) => e.id === "cjk-width-parity");

		it("each wide char has a glyph cell + empty placeholder cell", () => {
			if (!entry) throw new Error("missing cjk entry");
			const term = createTerminal({
				cols: entry.cols ?? 80,
				rows: entry.rows ?? 24,
			});
			activeTerm = term;
			term.write(entry.bytes);

			const buffer = term.buffer.active;
			const row = firstContentRow(term);
			const line = buffer.getLine(row);
			if (!line) throw new Error("no line");

			// "日本語 test 中文 ok" — col 0 is 日 (wide), col 1 its placeholder.
			const lead = line.getCell(0);
			const placeholder = line.getCell(1);
			expect(lead.getChars()).toBe("日");
			expect(placeholder.getChars()).toBe("");
			expect(placeholder.getChars().length).toBe(0);

			// 本 (cols 2-3), 語 (cols 4-5).
			expect(line.getCell(2).getChars()).toBe("本");
			expect(line.getCell(3).getChars()).toBe("");
			expect(line.getCell(4).getChars()).toBe("語");
			expect(line.getCell(5).getChars()).toBe("");

			// translateToString length < cols: placeholders contribute nothing.
			const text = line.translateToString(false);
			const cols = activeCols(term);
			expect(text.length).toBeLessThan(cols);
			expect(text.startsWith("日本語 test 中文 ok")).toBe(true);
		});

		it("token/document parity holds for CJK", () => {
			if (!entry) throw new Error("missing cjk entry");
			const term = createTerminal({
				cols: entry.cols ?? 80,
				rows: entry.rows ?? 24,
			});
			activeTerm = term;
			term.write(entry.bytes);

			const row = firstContentRow(term);
			const line = term.buffer.active.getLine(row);
			if (!line) throw new Error("no line");
			const tokens = dumpTokens(term, row);
			const joined = tokens.map((t) => t.value).join("");
			expect(joined).toBe(line.translateToString(false));
		});
	});

	describe("combining: base + combining mark", () => {
		const entry = CORPUS.find((e) => e.id === "combining-diacritics");

		it("base cell holds base + combining codepoint; cursor did not advance", () => {
			if (!entry) throw new Error("missing combining entry");
			const term = createTerminal({
				cols: entry.cols ?? 80,
				rows: entry.rows ?? 24,
			});
			activeTerm = term;
			term.write(entry.bytes);

			const buffer = term.buffer.active;
			const row = firstContentRow(term);
			const line = buffer.getLine(row);
			if (!line) throw new Error("no line");

			// Entry bytes (built from explicit codepoints so editor NFC
			// normalization can't collapse them): the first base = "e" + U+0301
			// (combining acute), the second = "a" + U+0308 (combining diaeresis),
			// then a precomposed U+00E9. All literals here are constructed via
			// String.fromCodePoint for the same reason.
			const eAcute = `e${String.fromCodePoint(0x0301)}`; // decomposed e-acute
			const aDiaeresis = `a${String.fromCodePoint(0x0308)}`; // decomposed a-diaeresis
			const precomposedE = String.fromCodePoint(0x00e9); // precomposed e-acute

			// The decomposed base cell at col 0 must carry BOTH codepoints.
			const base = line.getCell(0);
			expect(base.getChars()).toBe(eAcute);
			expect(base.getChars()).toContain("e");
			expect(base.getChars()).toContain(String.fromCodePoint(0x0301));
			expect([...base.getChars()].length).toBe(2); // base + combining mark
			// The combining mark did not consume its own cell: col 1 is a space.
			expect(line.getCell(1).getChars()).toBe(" ");

			// Decomposed a-diaeresis lives at col 2.
			const base2 = line.getCell(2);
			expect(base2.getChars()).toBe(aDiaeresis);

			// Cursor/cell-count parity: the visible string is 8 grid columns wide
			// even though it contains 2 combining marks. The combining marks must
			// NOT have advanced the cursor — so the trimmed line text equals the
			// source string and the cursor sits at column 8.
			const expected = `${eAcute} ${aDiaeresis} vs ${precomposedE}`;
			const text = line.translateToString(true);
			expect(text).toBe(expected);
			// rendered = 8 grid columns.
			expect(buffer.cursorX).toBe(8);
		});

		it("token/document parity holds for combining marks", () => {
			if (!entry) throw new Error("missing combining entry");
			const term = createTerminal({
				cols: entry.cols ?? 80,
				rows: entry.rows ?? 24,
			});
			activeTerm = term;
			term.write(entry.bytes);

			const row = firstContentRow(term);
			const line = term.buffer.active.getLine(row);
			if (!line) throw new Error("no line");
			const tokens = dumpTokens(term, row);
			const joined = tokens.map((t) => t.value).join("");
			expect(joined).toBe(line.translateToString(false));
		});
	});
});
