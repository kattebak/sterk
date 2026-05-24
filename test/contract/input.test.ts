/**
 * Contract tests — Input (keyboard, IME, paste)
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21
 * Gap-matrix rows covered: 13, 14, 15, 16, 17, 18
 *
 * One test per gap-matrix row. Parity / Improved rows assert real
 * behavior and must pass. Missing rows are listed as `it.todo()` so
 * the future Phase A/B/C PR that fills them flips todo → it.
 *
 * Per-row breakdown (this file):
 * - Row 13 (P):  arrows, Fn keys, modifier combinations.
 * - Row 14 (M):  application-keypad arrows (`\x1bOA` etc. after `\x1b[?1h`).
 * - Row 15 (M):  chord keymap (Shift-PageUp scrollback, Ctrl-Up scroll, …).
 * - Row 16 (M):  paste EOL conversion (`\r\n` → `\r` or `\n` per `convertEol`).
 * - Row 17 (Pa): copy/cut/paste passEvent (working: doesn't preventDefault
 *                Ctrl+C/V; missing: textinput-route fallback).
 * - Row 18 (P):  IME composition (explicit handlers — actually slightly
 *                more deliberate than aceterm's implicit Ace textinput).
 */

import { describe, expect, it } from "vitest";
import { keyboardEventToSequence } from "../../src/renderer/input.js";

function k(
	key: string,
	mod: Partial<{
		ctrlKey: boolean;
		altKey: boolean;
		metaKey: boolean;
		shiftKey: boolean;
	}> = {},
): KeyboardEvent {
	return {
		key,
		ctrlKey: mod.ctrlKey ?? false,
		altKey: mod.altKey ?? false,
		metaKey: mod.metaKey ?? false,
		shiftKey: mod.shiftKey ?? false,
		isComposing: false,
	} as KeyboardEvent;
}

describe("contract: input (keyboard / IME / paste)", () => {
	// ── Row 13 (P) — Arrows, Fn keys, modifiers ──────────────────────
	describe("row 13 [P] arrows, Fn keys, modifier combinations", () => {
		it("emits CSI A/B/C/D for arrow keys", () => {
			expect(keyboardEventToSequence(k("ArrowUp"))).toBe("\x1b[A");
			expect(keyboardEventToSequence(k("ArrowDown"))).toBe("\x1b[B");
			expect(keyboardEventToSequence(k("ArrowRight"))).toBe("\x1b[C");
			expect(keyboardEventToSequence(k("ArrowLeft"))).toBe("\x1b[D");
		});

		it("emits SS3 sequences for F1-F4 and CSI for F5-F12", () => {
			expect(keyboardEventToSequence(k("F1"))).toBe("\x1bOP");
			expect(keyboardEventToSequence(k("F5"))).toBe("\x1b[15~");
			expect(keyboardEventToSequence(k("F12"))).toBe("\x1b[24~");
		});

		it("emits C0 controls for Ctrl+A..Ctrl+Z", () => {
			expect(keyboardEventToSequence(k("c", { ctrlKey: true }))).toBe("\x03");
			expect(keyboardEventToSequence(k("z", { ctrlKey: true }))).toBe("\x1a");
		});
	});

	// ── Row 18 (P) — IME composition ─────────────────────────────────
	describe("row 18 [P] IME composition", () => {
		it("ignores keystrokes while IME composition is active", () => {
			const ev = { key: "a", isComposing: true } as KeyboardEvent;
			expect(keyboardEventToSequence(ev)).toBeNull();
		});
	});

	// ── Row 17 (Pa) — passEvent for copy/cut/paste (working half) ────
	describe("row 17 [Pa] copy/cut/paste — doesn't preventDefault Ctrl+C/V (working half)", () => {
		// keyboardEventToSequence emits \x03 for Ctrl+C (the C0 control)
		// — but the InputHandler keydown listener is responsible for
		// preventing default; the browser-native clipboard relies on the
		// listener *not* swallowing the gesture. The contract here is the
		// observable function output; the broken half (textinput-route
		// fallback aceterm relied on) is `it.todo` below.
		it("Ctrl+C translates to ETX (\\x03) at the key-sequence layer", () => {
			expect(keyboardEventToSequence(k("c", { ctrlKey: true }))).toBe("\x03");
		});
	});

	// ── Row 14 (M) — Application-keypad arrow keys ───────────────────
	it.todo(
		"row 14 [M] application-keypad arrows: after `\\x1b[?1h` arrows must emit `\\x1bOA`/`OB`/`OC`/`OD` instead of CSI A/B/C/D (aceterm input.js:88-95; sterk: not tracked)",
	);

	// ── Row 15 (M) — Chord keymap ────────────────────────────────────
	it.todo(
		"row 15 [M] chord keymap: Shift-PageUp scrolls scrollback up, Ctrl-Up scrolls viewport (aceterm HashHandler input.js:18-46; sterk: no chord support)",
	);

	// ── Row 16 (M) — Paste EOL conversion ────────────────────────────
	it.todo(
		"row 16 [M] paste EOL conversion: `\\r\\n` in pasted text → single `\\r` (or `\\n` per convertEol) so a multi-line paste at a bash prompt doesn't auto-execute (aceterm input.js:215-217; sterk: missing)",
	);

	// ── Row 17 (Pa) — passEvent broken half ──────────────────────────
	it.todo(
		"row 17 [Pa] copy/cut/paste — `passEvent: true` Ace command path so the browser's textinput-route clipboard still fires (aceterm input.js; sterk: only the keydown branch, no fallback)",
	);
});
