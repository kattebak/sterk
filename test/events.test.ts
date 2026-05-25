/**
 * xterm.js-compatible event surface tests.
 *
 * Asserts each additive event (onResize / onLineFeed / onBell / onScroll /
 * onCursorMove / onTitleChange) fires with the correct payload for a
 * representative input, and that the returned Disposable stops delivery.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../src/index.js";

describe("xterm-compatible events", () => {
	let term: ReturnType<typeof createTerminal>;

	beforeEach(() => {
		term = createTerminal({ cols: 80, rows: 24 });
	});

	describe("onResize", () => {
		it("fires with the new size", () => {
			const cb = vi.fn();
			term.onResize(cb);

			term.resize(100, 40);

			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith({ cols: 100, rows: 40 });
			term.dispose();
		});

		it("does not fire on a no-op resize to the same dimensions", () => {
			const cb = vi.fn();
			term.onResize(cb);

			term.resize(80, 24);

			expect(cb).not.toHaveBeenCalled();
			term.dispose();
		});

		it("returns a working Disposable", () => {
			const cb = vi.fn();
			const d = term.onResize(cb);

			d.dispose();
			term.resize(100, 40);

			expect(cb).not.toHaveBeenCalled();
			term.dispose();
		});
	});

	describe("onLineFeed", () => {
		it("fires on a line feed (LF)", () => {
			const cb = vi.fn();
			term.onLineFeed(cb);

			term.write("\n");

			expect(cb).toHaveBeenCalledTimes(1);
			term.dispose();
		});

		it("fires once per line feed", () => {
			const cb = vi.fn();
			term.onLineFeed(cb);

			term.write("a\nb\nc\n");

			expect(cb).toHaveBeenCalledTimes(3);
			term.dispose();
		});

		it("returns a working Disposable", () => {
			const cb = vi.fn();
			const d = term.onLineFeed(cb);

			d.dispose();
			term.write("\n");

			expect(cb).not.toHaveBeenCalled();
			term.dispose();
		});
	});

	describe("onBell", () => {
		it("fires on BEL (0x07)", () => {
			const cb = vi.fn();
			term.onBell(cb);

			term.write("\x07");

			expect(cb).toHaveBeenCalledTimes(1);
			term.dispose();
		});

		it("returns a working Disposable", () => {
			const cb = vi.fn();
			const d = term.onBell(cb);

			d.dispose();
			term.write("\x07");

			expect(cb).not.toHaveBeenCalled();
			term.dispose();
		});
	});

	describe("onScroll", () => {
		it("fires with the new top line when content scrolls past the viewport", () => {
			const cb = vi.fn();
			term.onScroll(cb);

			// Write more lines than the viewport can hold so the live screen
			// scrolls, advancing viewportY.
			let out = "";
			for (let i = 0; i < 50; i++) {
				out += `line ${i}\n`;
			}
			term.write(out);

			expect(cb).toHaveBeenCalled();
			const lastPosition = cb.mock.calls.at(-1)?.[0];
			expect(typeof lastPosition).toBe("number");
			expect(lastPosition).toBe(term.buffer.active.viewportY);
			expect(lastPosition).toBeGreaterThan(0);
			term.dispose();
		});

		it("fires with the new position on scrollLines", () => {
			// First grow the buffer so there is scrollback to scroll into.
			let out = "";
			for (let i = 0; i < 50; i++) {
				out += `line ${i}\n`;
			}
			term.write(out);

			const cb = vi.fn();
			term.onScroll(cb);

			term.scrollLines(-5);

			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith(term.buffer.active.viewportY);
			term.dispose();
		});

		it("returns a working Disposable", () => {
			let out = "";
			for (let i = 0; i < 50; i++) {
				out += `line ${i}\n`;
			}
			term.write(out);

			const cb = vi.fn();
			const d = term.onScroll(cb);
			d.dispose();

			term.scrollLines(-5);

			expect(cb).not.toHaveBeenCalled();
			term.dispose();
		});
	});

	describe("onCursorMove", () => {
		it("fires when a sequence moves the cursor", () => {
			const cb = vi.fn();
			term.onCursorMove(cb);

			// CUP to row 5, col 10 moves the cursor.
			term.write("\x1b[5;10H");

			expect(cb).toHaveBeenCalled();
			term.dispose();
		});

		it("does not fire on a write that leaves the cursor in place", () => {
			const cb = vi.fn();
			term.onCursorMove(cb);

			// A bell does not move the cursor.
			term.write("\x07");

			expect(cb).not.toHaveBeenCalled();
			term.dispose();
		});

		it("returns a working Disposable", () => {
			const cb = vi.fn();
			const d = term.onCursorMove(cb);

			d.dispose();
			term.write("\x1b[5;10H");

			expect(cb).not.toHaveBeenCalled();
			term.dispose();
		});
	});

	describe("onTitleChange", () => {
		it("fires on OSC 0 with the title", () => {
			const cb = vi.fn();
			term.onTitleChange(cb);

			term.write("\x1b]0;hello\x07");

			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith("hello");
			term.dispose();
		});

		it("fires on OSC 2 with the title", () => {
			const cb = vi.fn();
			term.onTitleChange(cb);

			term.write("\x1b]2;world\x07");

			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith("world");
			term.dispose();
		});

		it("does not disturb existing OSC 133 handling", () => {
			const titleCb = vi.fn();
			const oscCb = vi.fn();
			term.onTitleChange(titleCb);
			term.parser.registerOscHandler(133, oscCb);

			term.write("\x1b]133;A\x07");

			expect(oscCb).toHaveBeenCalledWith("A");
			expect(titleCb).not.toHaveBeenCalled();
			term.dispose();
		});

		it("returns a working Disposable", () => {
			const cb = vi.fn();
			const d = term.onTitleChange(cb);

			d.dispose();
			term.write("\x1b]0;hello\x07");

			expect(cb).not.toHaveBeenCalled();
			term.dispose();
		});
	});
});
