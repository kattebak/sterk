/**
 * Contract tests — Mouse (XTerm protocols, DEC modes, touch)
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21
 * Gap-matrix rows covered: 7, 8, 9, 10, 11, 12, 35, 36
 *
 * One test per gap-matrix row. Parity / Improved rows assert real
 * behavior and must pass. Missing rows are listed as `it.todo()` so
 * the future Phase A/B/C PR that fills them flips todo → it.
 *
 * Per-row breakdown (this file):
 * - Row  7 (P):  X10 mouse encoding `\x1b[M <button+32> <x+33> <y+33>`.
 * - Row  8 (P):  SGR 1006 mouse encoding `\x1b[< button ; x ; y M/m`.
 * - Row  9 (M):  VT200 / normal / vt300 / urxvt / decLocator protocols.
 * - Row 10 (M):  wire DEC private modes 1000/1002/1003/1006 to
 *                `MouseHandler.setMode` — without this, tmux's "enable
 *                mouse" sequence is silently dropped. **Critical.**
 * - Row 11 (M):  wheel→arrow-keys when application-keypad mode is active.
 * - Row 12 (M):  alt-click cursor-jump (`\x1b[D` / `\x1b[C` runs).
 * - Row 35 (+):  single-finger touch scroll (sterk owns this; aceterm did not).
 * - Row 36 (M):  long-press selection, tap-to-position, momentum/inertia.
 *
 * NB: many of these will flip to passing when the Phase A1 PR
 * (`feat/wire-dec-mouse-modes-a1`) lands — that PR is the trigger to
 * convert rows 9, 10, 11, 12 from `it.todo` to `it()`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MouseHandler, MouseMode } from "../../src/renderer/mouse.js";

describe("contract: mouse", () => {
	let host: HTMLElement;
	let received: string[];
	let handler: MouseHandler | null = null;

	beforeEach(() => {
		host = document.createElement("div");
		document.body.appendChild(host);
		received = [];
		// happy-dom doesn't lay out, so hand-feed cell metrics.
		handler = new MouseHandler(host, () => ({ width: 10, height: 20 }));
		handler.onData((d) => received.push(d));
	});

	afterEach(() => {
		handler?.dispose();
		handler = null;
		if (host.parentNode) host.parentNode.removeChild(host);
	});

	// ── Row 7 (P) — X10 mouse protocol ───────────────────────────────
	describe("row 7 [P] X10 mouse encoding", () => {
		it("supports MouseMode.X10 (mode enum exposed)", () => {
			expect(MouseMode.X10).toBeDefined();
			handler?.setMode(MouseMode.X10);
			// We don't synthesize a full layout-bearing MouseEvent here —
			// the encoding helper is already covered by the renderer
			// suite; this is the contract: the mode is exposed and
			// settable without throwing.
			expect(() => handler?.setMode(MouseMode.X10)).not.toThrow();
		});
	});

	// ── Row 8 (P) — SGR 1006 mouse protocol ──────────────────────────
	describe("row 8 [P] SGR 1006 mouse encoding", () => {
		it("supports MouseMode.SGR1006 (preferred mode)", () => {
			expect(MouseMode.SGR1006).toBeDefined();
			expect(() => handler?.setMode(MouseMode.SGR1006)).not.toThrow();
		});
	});

	// ── Row 35 (+) — Single-finger touch scroll ──────────────────────
	describe("row 35 [+] single-finger touch scroll (sterk owns this)", () => {
		it("calls onScroll callback when touchmove exceeds threshold (mode = Off)", () => {
			const scrolls: number[] = [];
			handler?.onScroll((lines) => scrolls.push(lines));
			handler?.setMode(MouseMode.Off);

			// Fire a touchstart + touchmove sequence with a vertical drag
			// large enough to clear the 10px deadband.
			const start = new Event("touchstart") as TouchEvent;
			(start as unknown as { touches: Array<{ clientY: number }> }).touches = [
				{ clientY: 100 },
			];
			host.dispatchEvent(start);

			const move = new Event("touchmove", { cancelable: true }) as TouchEvent;
			(move as unknown as { touches: Array<{ clientY: number }> }).touches = [
				{ clientY: 50 }, // dragged up 50px → scroll down (revealing older)
			];
			host.dispatchEvent(move);

			expect(scrolls.length).toBeGreaterThan(0);
			// Direction: dragging up means content moves down, sign is positive.
			expect(scrolls[0]).toBeGreaterThan(0);
		});
	});

	// ── Row 9 (M) — Extended mouse protocols ─────────────────────────
	it.todo(
		"row 9 [M] mouse: VT200 / normal / vt300 / urxvt / decLocator protocols (aceterm mouse.js:1-309; sterk: only X10 + SGR 1006)",
	);

	// ── Row 10 (M) — DEC private mode → setMode wiring ───────────────
	it.todo(
		"row 10 [M] CRITICAL: writing `\\x1b[?1000h` / `?1002h` / `?1003h` / `?1006h` toggles MouseHandler.setMode automatically (aceterm libterm.js mode-set cases 1000/1002/1006; sterk: terminal.ts handleDecPrivateMode only handles 1047/1048/1049 — mouse code is currently dead)",
	);

	// ── Row 11 (M) — Wheel→arrow-keys in application-keypad ──────────
	it.todo(
		"row 11 [M] wheel scroll emits arrow-key VT sequences when application-keypad mode is active (aceterm mouse.js:266-285; sterk: no application-keypad state tracked)",
	);

	// ── Row 12 (M) — Alt-click cursor jump ───────────────────────────
	it.todo(
		"row 12 [M] alt-click jumps the shell cursor by emitting `\\x1b[D`/`\\x1b[C` runs (aceterm mouse.js:289-308; sterk: not implemented)",
	);

	// ── Row 36 (M) — Touch: long-press selection / momentum ──────────
	it.todo(
		"row 36 [M] touch: long-press for selection, tap-to-position cursor, momentum/inertia scroll (Phase C improvement — neither aceterm nor sterk has it)",
	);
});
