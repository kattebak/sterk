/**
 * Dynamic in-place animation gate.
 *
 * For each corpus entry marked `inPlace: true`, this feeds the frames
 * CUMULATIVELY into ONE terminal (each frame carries real redraw escapes:
 * \r, \x1b[K, cursor-up) and asserts buffer correctness AFTER EVERY FRAME.
 *
 * This is the path that breaks renderers on pulsating busy indicators:
 * ghost cells (stale chars left after a shrink), attribute bleed (a previous
 * frame's dim/colour lingering), and multiline layout desync (cursor-up
 * redraws landing on the wrong row).
 *
 *   (a) toMatchSnapshot of the full per-frame dump sequence (regression net).
 *   (b) EXPLICIT invariants after each frame:
 *       - NO GHOST CELLS to the right of rendered content (or, for the
 *         -noerase sibling, the OPPOSITE: stale tail MUST persist).
 *       - token/document parity on every touched row.
 *       - cursor sanity for busy-multiline.
 *       - pulse reset for busy-spinner-single (no carry-over attrs).
 *
 * If an explicit invariant fails it is flagging a REAL renderer bug — the
 * assertion encodes the correct behaviour and must NOT be weakened.
 */

import { afterEach, describe, expect, it } from "vitest";
import { CORPUS, type CorpusEntry } from "../src/demo/corpus.js";
import { createTerminal } from "../src/index.js";
import {
	activeCols,
	type CellDump,
	dumpCell,
	dumpCells,
	isDefaultBlank,
	joinedTokenValues,
	type Term,
} from "./_dump.js";

interface FrameDump {
	frame: number;
	cursorX: number;
	cursorY: number;
	rows: { row: number; text: string; cells: CellDump[] }[];
}

/**
 * Apply an in-place entry frame by frame. Returns the live terminal plus a
 * per-frame dump of the touched-region rows. `rowsToDump` decides which buffer
 * rows to capture each frame (default: rows 0..maxRow).
 */
function applyInPlace(
	entry: CorpusEntry,
	rowsToDump: number[],
): { term: Term; perFrame: FrameDump[] } {
	const term = createTerminal({
		cols: entry.cols ?? 80,
		rows: entry.rows ?? 24,
	});
	const frames = entry.frames ?? [entry.bytes];
	const perFrame: FrameDump[] = [];
	frames.forEach((f, i) => {
		term.write(f);
		const buffer = term.buffer.active;
		perFrame.push({
			frame: i,
			cursorX: buffer.cursorX,
			cursorY: buffer.cursorY,
			rows: rowsToDump.map((row) => {
				const line = buffer.getLine(row);
				return {
					row,
					text: line ? line.translateToString(true) : "",
					cells: dumpCells(term, row),
				};
			}),
		});
	});
	return { term, perFrame };
}

/** All raw cell dumps for a row (NOT trimmed) — needed for ghost checks. */
function rawRowCells(term: Term, row: number): CellDump[] {
	const line = term.buffer.active.getLine(row);
	if (!line) return [];
	const cols = activeCols(term);
	const cells: CellDump[] = [];
	for (let x = 0; x < cols; x++) cells.push(dumpCell(line.getCell(x)));
	return cells;
}

/**
 * Visible length (in grid columns) of a row: index after the last non-blank
 * cell. Wide-char placeholders (chars==="") count as occupied columns when a
 * preceding glyph filled them, but a trailing run of default-blank cells does
 * not count.
 */
function visibleWidth(cells: CellDump[]): number {
	let end = cells.length;
	while (end > 0) {
		const c = cells[end - 1];
		if (!c || !isDefaultBlank(c)) break;
		end--;
	}
	return end;
}

/**
 * Assert no ghost cells: every cell at or beyond column `from` on `row` is a
 * fully-default blank. Returns a descriptive failure string if violated, else
 * null. (We return rather than assert so callers can attach frame context.)
 */
function findGhost(
	term: Term,
	row: number,
	from: number,
): { col: number; cell: CellDump } | null {
	const cells = rawRowCells(term, row);
	for (let x = from; x < cells.length; x++) {
		const c = cells[x];
		if (c && !isDefaultBlank(c)) return { col: x, cell: c };
	}
	return null;
}

describe("Corpus in-place animation gate", () => {
	let activeTerm: Term | null = null;

	afterEach(() => {
		if (activeTerm) {
			activeTerm.dispose();
			activeTerm = null;
		}
	});

	const byId = (id: string): CorpusEntry => {
		const e = CORPUS.find((c) => c.id === id);
		if (!e) throw new Error(`missing corpus entry ${id}`);
		return e;
	};

	// ── (a) Full per-frame snapshot for every in-place entry ─────────────────
	describe("snapshots (all in-place entries)", () => {
		for (const entry of CORPUS.filter((e) => e.inPlace)) {
			it(`${entry.category}: ${entry.id}`, () => {
				// Dump rows 0..2 to cover multiline; single-line entries just have
				// blank rows 1-2.
				const { term, perFrame } = applyInPlace(entry, [0, 1, 2]);
				activeTerm = term;
				expect(perFrame).toMatchSnapshot(entry.id);
			});
		}
	});

	// ── (b) Explicit invariants ──────────────────────────────────────────────

	describe("busy-spinner-single: no ghost, parity, pulse reset", () => {
		it("after each frame the line has no ghost tail and resets pulse attrs", () => {
			const entry = byId("busy-spinner-single");
			const term = createTerminal({ cols: 80, rows: 24 });
			activeTerm = term;
			const frames = entry.frames ?? [];

			let prevWidth = 0;
			frames.forEach((f, i) => {
				term.write(f);
				const line = term.buffer.active.getLine(0);
				if (!line) throw new Error(`frame ${i}: no row 0`);
				const text = line.translateToString(true);

				// The line always opens with the spinner glyph + space + word.
				expect(text.startsWith(`${"⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[i % 10]} Transfiguring…`)).toBe(
					true,
				);

				// NO GHOST: every cell beyond the rendered content is default-blank.
				const cells = rawRowCells(term, 0);
				const width = visibleWidth(cells);
				const ghost = findGhost(term, 0, width);
				expect(
					ghost,
					`frame ${i} (${JSON.stringify(f)}): ghost cell at col ${ghost?.col}: ${JSON.stringify(ghost?.cell)}`,
				).toBeNull();

				// The previous frame's content width may shrink (counter rolls
				// 9->10 etc grows, but earlier frames are shorter). After \x1b[K
				// the tail must be clean regardless of prevWidth.
				if (width < prevWidth) {
					const tailGhost = findGhost(term, 0, width);
					expect(tailGhost, `frame ${i}: stale tail after shrink`).toBeNull();
				}
				prevWidth = width;

				// PULSE RESET: the spinner glyph cell (col 0) must carry NO dim and
				// NO colour — the leading \x1b[K + \x1b[0m reset means the glyph is
				// always default-styled, never inheriting the previous frame's
				// dim/colour pulse that was applied to the WORD.
				const glyphCell = dumpCell(line.getCell(0));
				expect(
					glyphCell.dim,
					`frame ${i}: spinner glyph carried dim from prior pulse`,
				).toBe(false);
				expect(
					glyphCell.fg,
					`frame ${i}: spinner glyph carried fg colour from prior pulse`,
				).toBe("default");
				expect(glyphCell.bg).toBe("default");

				// Token/document parity on the touched row.
				expect(joinedTokenValues(term, 0)).toBe(line.translateToString(false));
			});
		});

		it("the word pulses (dim on odd frames, fg colour on even frames)", () => {
			const entry = byId("busy-spinner-single");
			const term = createTerminal({ cols: 80, rows: 24 });
			activeTerm = term;
			const frames = entry.frames ?? [];

			frames.forEach((f, i) => {
				term.write(f);
				const line = term.buffer.active.getLine(0);
				if (!line) throw new Error("no row 0");
				// The word starts at col 2 ("<glyph> <word>"); 'T' of Transfiguring.
				const wordCell = dumpCell(line.getCell(2));
				expect(wordCell.ch).toBe("T");
				if (i % 2 === 1) {
					// Odd frame: dim pulse.
					expect(wordCell.dim, `frame ${i}: expected dim word`).toBe(true);
					expect(wordCell.fg).toBe("default");
				} else {
					// Even frame: 256-colour grey-ramp fg pulse, no dim.
					expect(wordCell.dim, `frame ${i}: expected no dim`).toBe(false);
					expect(
						wordCell.fg.startsWith("p"),
						`frame ${i}: expected palette fg, got ${wordCell.fg}`,
					).toBe(true);
				}
			});
		});
	});

	describe("busy-shrinking-tail: erase-line clears stale tail", () => {
		it("no ghost cells remain after each shrink (with \\x1b[K)", () => {
			const entry = byId("busy-shrinking-tail");
			const term = createTerminal({ cols: 80, rows: 24 });
			activeTerm = term;
			const frames = entry.frames ?? [];

			frames.forEach((f, i) => {
				term.write(f);
				const line = term.buffer.active.getLine(0);
				if (!line) throw new Error("no row 0");
				const cells = rawRowCells(term, 0);
				const width = visibleWidth(cells);
				const ghost = findGhost(term, 0, width);
				expect(
					ghost,
					`frame ${i} (${JSON.stringify(f)}): ghost at col ${ghost?.col}: ${JSON.stringify(ghost?.cell)}`,
				).toBeNull();
				// Token/document parity.
				expect(joinedTokenValues(term, 0)).toBe(line.translateToString(false));
			});

			// Final frame is the shortest ("⠼ Done."); the buffer must not still
			// hold "items" / "processing" from frame 0.
			const finalText = term.buffer.active.getLine(0)?.translateToString(true);
			expect(finalText).toBe("⠼ Done.");
		});
	});

	describe("busy-shrinking-tail-noerase: stale tail MUST persist", () => {
		it("without \\x1b[K the longer frame-0 tail remains (real-terminal semantics)", () => {
			const entry = byId("busy-shrinking-tail-noerase");
			const term = createTerminal({ cols: 80, rows: 24 });
			activeTerm = term;
			const frames = entry.frames ?? [];

			// Apply all frames.
			for (const f of frames) term.write(f);

			// Frame 0 wrote "⠋ Loading (processing 4096 items)…" (len 34 cells —
			// the trailing "…" is 1 col). The final short frame "⠼ Done." only
			// overwrote the first 7 columns via CR (no erase), so the tail from
			// frame 0 ("items)…") MUST still be on the row.
			const line = term.buffer.active.getLine(0);
			if (!line) throw new Error("no row 0");
			const text = line.translateToString(true);

			// Prefix overwritten by the last frame.
			expect(text.startsWith("⠼ Done.")).toBe(true);
			// Stale tail from the longest earlier frame must remain.
			expect(
				text.includes("items)…"),
				`expected stale tail to persist without erase, got: ${JSON.stringify(text)}`,
			).toBe(true);

			// Token/document parity still holds on the mixed row.
			expect(joinedTokenValues(term, 0)).toBe(line.translateToString(false));
		});
	});

	describe("progress-bar-inplace: clean fill, no ghost, parity", () => {
		it("each frame redraws cleanly with a green fill and no stale cells", () => {
			const entry = byId("progress-bar-inplace");
			const term = createTerminal({ cols: 80, rows: 24 });
			activeTerm = term;
			const frames = entry.frames ?? [];

			frames.forEach((f, i) => {
				term.write(f);
				const line = term.buffer.active.getLine(0);
				if (!line) throw new Error("no row 0");
				const text = line.translateToString(true);
				expect(text.startsWith("[")).toBe(true);
				expect(text.includes("%")).toBe(true);

				// No ghost beyond rendered content.
				const cells = rawRowCells(term, 0);
				const width = visibleWidth(cells);
				const ghost = findGhost(term, 0, width);
				expect(
					ghost,
					`frame ${i}: ghost at col ${ghost?.col}: ${JSON.stringify(ghost?.cell)}`,
				).toBeNull();

				// Token/document parity.
				expect(joinedTokenValues(term, 0)).toBe(line.translateToString(false));
			});
		});
	});

	describe("busy-multiline: cursor-up redraw layout", () => {
		it("3 lines hold expected text, cursor lands correctly, no row bleed", () => {
			const entry = byId("busy-multiline");
			const term = createTerminal({ cols: 80, rows: 24 });
			activeTerm = term;
			const frames = entry.frames ?? [];
			const glyphs = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

			frames.forEach((f, i) => {
				term.write(f);
				const buffer = term.buffer.active;

				const l0 = buffer.getLine(0);
				const l1 = buffer.getLine(1);
				const l2 = buffer.getLine(2);
				if (!l0 || !l1 || !l2) throw new Error(`frame ${i}: missing rows`);

				const expectedGlyph = glyphs[i % glyphs.length];
				const done = i + 1;

				// Each line holds exactly its expected text — no bleed between rows.
				expect(l0.translateToString(true), `frame ${i}: line 0 text`).toBe(
					`${expectedGlyph} Building project`,
				);
				expect(l1.translateToString(true), `frame ${i}: line 1 text`).toBe(
					"steps: compile → link → bundle",
				);
				expect(l2.translateToString(true), `frame ${i}: line 2 text`).toBe(
					`done: ${done}/8 files`,
				);

				// No ghost on any of the three rows beyond rendered content.
				for (const row of [0, 1, 2]) {
					const width = visibleWidth(rawRowCells(term, row));
					const ghost = findGhost(term, row, width);
					expect(
						ghost,
						`frame ${i} row ${row}: ghost at col ${ghost?.col}: ${JSON.stringify(ghost?.cell)}`,
					).toBeNull();
				}

				// Row 3 (below the block) must stay empty — the redraw must not
				// have spilled a 4th line.
				const l3 = buffer.getLine(3);
				expect(l3?.translateToString(true) ?? "").toBe("");

				// CURSOR SANITY: after each frame the cursor sits at the END of
				// line 3 (row 2). The last thing written each frame is line 3's
				// text with no trailing newline, so cursorY === 2 and cursorX is
				// the printed width of "  done: N/8 files".
				const line3Printed = `  done: ${done}/8 files`;
				expect(buffer.cursorY, `frame ${i}: cursorY`).toBe(2);
				expect(buffer.cursorX, `frame ${i}: cursorX`).toBe(line3Printed.length);

				// Token/document parity for all three rows.
				for (const row of [0, 1, 2]) {
					const line = buffer.getLine(row);
					if (!line) continue;
					expect(joinedTokenValues(term, row)).toBe(
						line.translateToString(false),
					);
				}
			});
		});
	});
});
