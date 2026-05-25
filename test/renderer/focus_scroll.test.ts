/**
 * Focus → scroll-to-bottom (mobile "tap to bring up keyboard = jump to latest").
 *
 * On touch browsers the soft keyboard is summoned by FOCUSING the input
 * surface. We wire focus to a scroll-to-bottom so tapping the terminal both
 * raises the keyboard AND snaps the viewport to the live screen.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";
import type { Terminal } from "../../src/types.js";

/**
 * Feed `count` newline-terminated rows so the buffer grows past the viewport
 * and a scrollback window exists to scroll up into.
 */
function feedLines(term: Terminal, count: number): void {
	for (let i = 0; i < count; i++) {
		term.write(`line ${i}\r\n`);
	}
}

/** Absolute row index of the topmost visible row when pinned to the bottom. */
function maxViewportY(term: Terminal): number {
	return Math.max(0, term.buffer.active.length - term.rows);
}

describe("scroll to bottom when the input is focused", () => {
	let container: HTMLElement;
	let term: Terminal | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		if (term) {
			term.dispose();
			term = null;
		}
		if (container.parentNode) {
			container.parentNode.removeChild(container);
		}
	});

	it("pins the viewport to the bottom when focus() is called", () => {
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		feedLines(term, 100);
		const bottom = maxViewportY(term);
		expect(bottom).toBeGreaterThan(0);

		// Park mid-scrollback.
		term.scrollLines?.(-50);
		expect(term.buffer.active.viewportY).toBeLessThan(bottom);

		// Focusing the input surface summons the keyboard → jump to latest.
		term.focus?.();
		expect(term.buffer.active.viewportY).toBe(bottom);
	});

	it("pins to the bottom on a DOM focus event on the input surface", () => {
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		feedLines(term, 100);
		const bottom = maxViewportY(term);

		term.scrollLines?.(-40);
		expect(term.buffer.active.viewportY).toBeLessThan(bottom);

		// The real mobile trigger: a focus event on Ace's hidden textarea.
		const textarea = container.querySelector<HTMLTextAreaElement>(
			"textarea.ace_text-input",
		);
		expect(textarea).toBeTruthy();
		textarea?.dispatchEvent(new FocusEvent("focus"));

		expect(term.buffer.active.viewportY).toBe(bottom);
	});

	it("does NOT scroll on focus when scrollToBottomOnFocus is false", () => {
		term = createTerminal({ cols: 80, rows: 24, scrollToBottomOnFocus: false });
		term.open?.(container);

		feedLines(term, 100);
		const bottom = maxViewportY(term);

		term.scrollLines?.(-50);
		const parked = term.buffer.active.viewportY;
		expect(parked).toBeLessThan(bottom);

		term.focus?.();
		// Still parked — the opt-out disabled the focus pin.
		expect(term.buffer.active.viewportY).toBe(parked);
	});

	it("defaults scrollToBottomOnFocus to true", () => {
		term = createTerminal();
		expect(term.options.scrollToBottomOnFocus).toBe(true);
	});

	it("does not throw when focus() is called headless (before open)", () => {
		term = createTerminal();
		expect(() => term?.focus?.()).not.toThrow();
	});
});
