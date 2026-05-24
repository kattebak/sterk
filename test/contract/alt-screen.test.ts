/**
 * Contract tests — Alternate screen (DEC private modes 1047 / 1048 / 1049 / 47)
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21
 * Gap-matrix rows covered: 26, 27, 28
 *
 * One test per gap-matrix row. Parity / Improved rows assert real
 * behavior and must pass. Missing rows are listed as `it.todo()` so
 * the future Phase A/B/C PR that fills them flips todo → it.
 *
 * Per-row breakdown (this file):
 * - Row 26 (Pa): alt-screen save+restore — working: `{cursorX, cursorY,
 *                attrs}` are saved/restored. Missing: `scrollTop`,
 *                `scrollBottom`, `tabs` (TUIs that set DECSTBM before alt
 *                misbehave on exit).
 * - Row 27 (M):  mode 47 (legacy alt-screen, pre-1047).
 * - Row 28 (M):  `changeMode` veto event (aceterm libterm.js:2566).
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";

describe("contract: alt-screen", () => {
	// ── Row 26 (Pa) — Working half: cursor + attrs save/restore ──────
	describe("row 26 [Pa] DECSET 1049 save/restore cursor + attrs (working half)", () => {
		it("entering and exiting alt-screen restores cursor X / Y to pre-entry values", () => {
			const term = createTerminal({ cols: 20, rows: 5 });
			term.write("Normal line 1\nNormal line 2");
			term.write("\x1b[2;5H"); // move to (4, 1)

			term.write("\x1b[?1049h"); // enter alt
			term.write("Alt content");
			term.write("\x1b[?1049l"); // exit alt

			expect(term.buffer.active.cursorX).toBe(4);
			expect(term.buffer.active.cursorY).toBe(1);
			term.dispose();
		});
	});

	// ── Row 26 (Pa) — Broken half: scrollTop / scrollBottom / tabs ───
	it.todo(
		"row 26 [Pa] alt-screen restore — `scrollTop`, `scrollBottom`, and tab stops are also restored on exit (aceterm libterm.js:2561-2611 saves full `{lines, ybase, ydisp, x, y, scrollTop, scrollBottom, tabs}`; sterk only saves `{cursorX, cursorY, attrs}`)",
	);

	// ── Row 27 (M) — Mode 47 legacy alt-screen ───────────────────────
	it.todo(
		"row 27 [M] DECSET 47 (legacy alt-screen, pre-1047): `\\x1b[?47h` enters alt, `\\x1b[?47l` exits — for legacy screen(1) / older tmux (aceterm: yes; sterk: not implemented)",
	);

	// ── Row 28 (M) — `changeMode` veto event ─────────────────────────
	it.todo(
		"row 28 [M] alt-screen emits a `changeMode` event that the consumer can veto (aceterm libterm.js:2566; sterk: no event)",
	);
});
