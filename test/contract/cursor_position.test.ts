/**
 * Contract tests — CSI CUP / HVP coordinates are viewport-relative
 *
 * Regression context: the mobux Pixel-7 "magenta status bar 3×"
 * screenshot. A custom zsh prompt (or tmux-style status redraw on the
 * normal screen) periodically issued `\x1b[<rows>;1H` to repaint the
 * bottom row. Sterk's CUP/HVP handler passed `p1 - 1` as an ABSOLUTE
 * buffer row instead of a viewport-relative row, so once the buffer had
 * grown past `rows` lines each redraw landed at a fixed absolute index
 * deep in scrollback. The previous status froze in place and a fresh
 * one painted at the (now-different) absolute row each refresh,
 * accumulating one stale bar per redraw.
 *
 * Spec: VT100/ECMA-48 — CUP `CSI Pn ; Pn H` and HVP `CSI Pn ; Pn f`
 * arguments are 1-based row;column *within the visible screen*. They
 * MUST NOT be interpreted as absolute scrollback offsets.
 *
 * What this test pins:
 *   1. After the buffer has scrolled (length > rows), a CUP to the
 *      bottom row writes to the live screen's bottom row, not to the
 *      same absolute row in scrollback.
 *   2. Three back-to-back "move + write" pairs at the same CUP
 *      coordinate overwrite the SAME line — there is exactly one copy
 *      of the latest text and zero copies of the older ones. This is
 *      the property tmux-style status redraws (and any zsh PROMPT that
 *      repaints a bottom bar) depend on.
 *   3. CUP is idempotent across scroll state: writing the same payload
 *      after additional scroll lands on the same visible row.
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";

type AnyTerm = ReturnType<typeof createTerminal>;

function lines(term: AnyTerm): string[] {
	const buf = term.buffer.active;
	const out: string[] = [];
	for (let y = 0; y < buf.length; y++) {
		const line = buf.getLine(y);
		out.push(line?.translateToString(true) ?? "");
	}
	return out;
}

describe("contract: CSI CUP / HVP are viewport-relative", () => {
	it("CUP to the bottom row writes to the live screen, not to absolute row `p1-1`", () => {
		const rows = 5;
		const term = createTerminal({ cols: 40, rows, scrollback: 100 });

		// Push the buffer past `rows` so the live screen lives somewhere
		// other than absolute rows 0..rows-1.
		for (let i = 1; i <= rows + 3; i++) {
			term.write(`scrollback-${i}\r\n`);
		}
		const buf = term.buffer.active;
		expect(buf.length).toBeGreaterThan(rows);
		const liveBottomAbs = buf.length - 1;

		// Status-style redraw: jump to the bottom screen row, write.
		term.write(`\x1b[${rows};1H[STATUS]`);

		// The write must land on the live bottom row, NOT on the same
		// absolute index `rows-1` (which is now in scrollback).
		expect(lines(term)[liveBottomAbs]).toContain("[STATUS]");
		expect(lines(term)[rows - 1]).not.toContain("[STATUS]");

		term.dispose();
	});

	it("repeated CUP-to-bottom + write OVERWRITES the same row (no stacking)", () => {
		const rows = 5;
		const term = createTerminal({ cols: 40, rows, scrollback: 100 });

		// Make the buffer live past `rows`.
		for (let i = 1; i <= rows + 3; i++) {
			term.write(`scrollback-${i}\r\n`);
		}

		// Simulate three status-bar redraws (tmux/zsh-style).
		term.write(`\x1b[${rows};1H[STATUS-A]`);
		term.write(`\x1b[${rows};1H[STATUS-B]`);
		term.write(`\x1b[${rows};1H[STATUS-C]`);

		const all = lines(term);
		const aCount = all.filter((l) => l.includes("STATUS-A")).length;
		const bCount = all.filter((l) => l.includes("STATUS-B")).length;
		const cCount = all.filter((l) => l.includes("STATUS-C")).length;

		// Only the most recent status is on screen; older ones are gone.
		expect({ aCount, bCount, cCount }).toEqual({
			aCount: 0,
			bCount: 0,
			cCount: 1,
		});

		// The single surviving copy lives on the live bottom row.
		const buf = term.buffer.active;
		expect(all[buf.length - 1]).toContain("[STATUS-C]");

		term.dispose();
	});

	it("HVP (`\\x1b[r;cf`) shares CUP's viewport-relative semantics", () => {
		const rows = 5;
		const term = createTerminal({ cols: 40, rows, scrollback: 100 });

		for (let i = 1; i <= rows + 2; i++) {
			term.write(`scrollback-${i}\r\n`);
		}
		const buf = term.buffer.active;
		const liveBottomAbs = buf.length - 1;

		// HVP uses final byte 'f' (0x66) instead of 'H'.
		term.write(`\x1b[${rows};1f[HVP-STATUS]`);

		expect(lines(term)[liveBottomAbs]).toContain("[HVP-STATUS]");
		expect(lines(term)[rows - 1]).not.toContain("[HVP-STATUS]");

		term.dispose();
	});

	it("CUP coordinates remain stable as the buffer continues to grow", () => {
		const rows = 5;
		const term = createTerminal({ cols: 40, rows, scrollback: 100 });

		for (let i = 1; i <= rows + 2; i++) {
			term.write(`scrollback-${i}\r\n`);
		}
		term.write(`\x1b[${rows};1H[FIRST]`);
		const firstBottom = term.buffer.active.length - 1;
		expect(lines(term)[firstBottom]).toContain("[FIRST]");

		// Push three more lines of content so the live screen moves down
		// in absolute coordinates. CUP must follow it.
		for (let i = 100; i < 103; i++) {
			term.write(`\r\nmore-${i}`);
		}
		term.write(`\x1b[${rows};1H[SECOND]`);

		const all = lines(term);
		const secondBottom = term.buffer.active.length - 1;

		// [SECOND] is on the new live bottom; [FIRST] (now in scrollback)
		// is untouched but only appears once.
		expect(all[secondBottom]).toContain("[SECOND]");
		expect(all.filter((l) => l.includes("[SECOND]"))).toHaveLength(1);
		expect(all.filter((l) => l.includes("[FIRST]"))).toHaveLength(1);

		term.dispose();
	});
});
