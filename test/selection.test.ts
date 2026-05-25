/**
 * xterm.js-compatible selection API parity (kattebak/sterk#36).
 *
 * Covers the additive, non-breaking selection surface that delegates to
 * Ace's selection model under the hood:
 *   - hasSelection / getSelection / getSelectionPosition
 *   - clearSelection
 *   - select(column, row, length)   (viewport-relative row)
 *   - selectAll
 *   - selectLines(start, end)        (absolute buffer rows)
 *   - onSelectionChange(cb) -> Disposable
 *
 * These run under happy-dom, which has no real layout, so we exercise what
 * is observable headlessly: the Ace document is populated from the buffer
 * on each rAF flush, and Ace's selection model operates on the document
 * regardless of pixel layout. We drive the rAF flush explicitly via a
 * fake requestAnimationFrame so the document reflects what we wrote before
 * making selections.
 *
 * Coordinate mapping under test: the renderer keeps Ace document rows 1:1
 * with absolute buffer rows, so `getSelectionPosition` reports absolute
 * `y`, `selectLines` addresses absolute rows, and `select` adds the
 * current `viewportY` to its viewport-relative row.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../src/index.js";
import type { Terminal } from "../src/types.js";

/**
 * Flush the renderer's coalesced rAF so the Ace document reflects the
 * buffer. happy-dom provides requestAnimationFrame; we run it
 * synchronously by mocking it for the duration of the flush.
 */
function flush(): void {
	// The renderer schedules a single rAF per write burst; running all
	// pending timers/frames lets it sync buffer -> document.
	vi.advanceTimersByTime(32);
}

describe("selection API parity", () => {
	describe("headless (no renderer attached)", () => {
		it("methods are safe no-ops / report empty state", () => {
			const term = createTerminal();
			expect(term.hasSelection?.()).toBe(false);
			expect(term.getSelection?.()).toBe("");
			expect(term.getSelectionPosition?.()).toBeUndefined();
			expect(() => term.clearSelection?.()).not.toThrow();
			expect(() => term.select?.(0, 0, 5)).not.toThrow();
			expect(() => term.selectAll?.()).not.toThrow();
			expect(() => term.selectLines?.(0, 1)).not.toThrow();
			term.dispose();
		});

		it("onSelectionChange before open() returns a disposable that does not throw", () => {
			const term = createTerminal();
			let fired = false;
			const sub = term.onSelectionChange?.(() => {
				fired = true;
			});
			// Inert in headless mode (no Ace emitter yet), but disposing is safe.
			expect(fired).toBe(false);
			expect(() => sub?.dispose()).not.toThrow();
			term.dispose();
		});
	});

	describe("with an attached renderer", () => {
		let container: HTMLElement;
		let term: Terminal;

		beforeEach(() => {
			vi.useFakeTimers();
			container = document.createElement("div");
			document.body.appendChild(container);
			term = createTerminal({ cols: 80, rows: 24 });
			term.open?.(container);
			// Seed three lines of content and flush to the document.
			term.write("line one\r\nline two\r\nline three");
			flush();
		});

		afterEach(() => {
			term.dispose();
			container.remove();
			vi.useRealTimers();
		});

		it("selectAll then getSelection/hasSelection reflect content", () => {
			term.selectAll?.();
			expect(term.hasSelection?.()).toBe(true);
			const text = term.getSelection?.() ?? "";
			expect(text).toContain("line one");
			expect(text).toContain("line two");
			expect(text).toContain("line three");
		});

		it("clearSelection empties the selection", () => {
			term.selectAll?.();
			expect(term.hasSelection?.()).toBe(true);
			term.clearSelection?.();
			expect(term.hasSelection?.()).toBe(false);
			expect(term.getSelection?.()).toBe("");
			expect(term.getSelectionPosition?.()).toBeUndefined();
		});

		it("select(column,row,length) sets a single-row selection getSelectionPosition reports", () => {
			// Viewport pinned to bottom; with 3 short lines and 24 rows the
			// buffer is not scrolled, so viewportY === 0 and viewport row 0
			// maps to absolute row 0.
			term.select?.(0, 0, 4);
			expect(term.hasSelection?.()).toBe(true);
			const pos = term.getSelectionPosition?.();
			expect(pos).toBeDefined();
			expect(pos?.start).toEqual({ x: 0, y: 0 });
			expect(pos?.end).toEqual({ x: 4, y: 0 });
			expect(term.getSelection?.()).toBe("line");
		});

		it("select uses viewport-relative rows (row 1 -> absolute row 1 at top)", () => {
			term.select?.(0, 1, 8);
			const pos = term.getSelectionPosition?.();
			expect(pos?.start.y).toBe(1);
			expect(pos?.end.y).toBe(1);
			expect(term.getSelection?.()).toBe("line two");
		});

		it("selectLines selects absolute rows inclusively", () => {
			term.selectLines?.(0, 1);
			expect(term.hasSelection?.()).toBe(true);
			const text = term.getSelection?.() ?? "";
			expect(text).toContain("line one");
			expect(text).toContain("line two");
			expect(text).not.toContain("line three");
			const pos = term.getSelectionPosition?.();
			expect(pos?.start.y).toBe(0);
			// End row extends past the last selected line (to fully cover it).
			expect(pos?.end.y).toBeGreaterThanOrEqual(1);
		});

		it("onSelectionChange fires on selection change and its Disposable stops delivery", () => {
			let count = 0;
			const sub = term.onSelectionChange?.(() => {
				count++;
			});
			term.selectAll?.();
			expect(count).toBeGreaterThan(0);
			const afterFirst = count;

			sub?.dispose();
			term.clearSelection?.();
			term.select?.(0, 0, 3);
			// No further deliveries after dispose.
			expect(count).toBe(afterFirst);
		});

		it("onSelectionChange registered before open() is wired once open() runs", () => {
			// Fresh terminal: subscribe BEFORE open(), then open + select.
			const c2 = document.createElement("div");
			document.body.appendChild(c2);
			const t2 = createTerminal({ cols: 80, rows: 24 });
			let fired = 0;
			const sub = t2.onSelectionChange?.(() => {
				fired++;
			});
			t2.open?.(c2);
			t2.write("hello world");
			flush();
			t2.selectAll?.();
			expect(fired).toBeGreaterThan(0);
			sub?.dispose();
			t2.dispose();
			c2.remove();
		});
	});
});
