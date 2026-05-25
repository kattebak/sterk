/**
 * xterm-compatible addon system + scroll method + buffer-change tests.
 *
 * Covers:
 * - loadAddon: activate() receives the terminal, dispose() runs on term.dispose()
 * - scrollToTop / scrollToLine / scrollPages move viewportY correctly
 * - buffer.onBufferChange fires with the alternate buffer on enter, the
 *   normal buffer on exit, and the Disposable stops delivery
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../src/index.js";
import type { ITerminalAddon, Terminal } from "../src/types.js";

describe("loadAddon / ITerminalAddon", () => {
	let term: ReturnType<typeof createTerminal>;

	beforeEach(() => {
		term = createTerminal({ cols: 80, rows: 24 });
	});

	it("calls activate() with the terminal instance", () => {
		const activate = vi.fn();
		const addon: ITerminalAddon = { activate, dispose: vi.fn() };

		term.loadAddon(addon);

		expect(activate).toHaveBeenCalledTimes(1);
		expect(activate).toHaveBeenCalledWith(term);
		term.dispose();
	});

	it("disposes loaded addons when the terminal is disposed", () => {
		const dispose = vi.fn();
		const addon: ITerminalAddon = { activate: vi.fn(), dispose };

		term.loadAddon(addon);
		expect(dispose).not.toHaveBeenCalled();

		term.dispose();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("disposes every loaded addon exactly once", () => {
		const a: ITerminalAddon = { activate: vi.fn(), dispose: vi.fn() };
		const b: ITerminalAddon = { activate: vi.fn(), dispose: vi.fn() };

		term.loadAddon(a);
		term.loadAddon(b);
		term.dispose();

		expect(a.dispose).toHaveBeenCalledTimes(1);
		expect(b.dispose).toHaveBeenCalledTimes(1);
	});

	it("gives the addon a usable terminal in activate()", () => {
		const activate = vi.fn<(t: Terminal) => void>();
		const addon: ITerminalAddon = { activate, dispose: vi.fn() };

		term.loadAddon(addon);

		const seen = activate.mock.calls[0]?.[0];
		expect(seen).toBe(term);
		expect(seen?.cols).toBe(80);
		term.dispose();
	});
});

describe("scroll methods", () => {
	let term: ReturnType<typeof createTerminal>;

	// Grow the buffer well past the viewport so there is scrollback to move
	// the viewport through.
	function fillScrollback(t: ReturnType<typeof createTerminal>): void {
		let out = "";
		for (let i = 0; i < 100; i++) {
			out += `line ${i}\n`;
		}
		t.write(out);
	}

	beforeEach(() => {
		term = createTerminal({ cols: 80, rows: 24, scrollback: 1000 });
		fillScrollback(term);
	});

	it("scrollToTop pins viewportY to 0", () => {
		expect(term.buffer.active.viewportY).toBeGreaterThan(0);

		term.scrollToTop();

		expect(term.buffer.active.viewportY).toBe(0);
		term.dispose();
	});

	it("scrollToLine moves viewportY to the requested absolute line", () => {
		term.scrollToLine(10);

		expect(term.buffer.active.viewportY).toBe(10);
		term.dispose();
	});

	it("scrollToLine clamps to the valid scroll range", () => {
		const bottom = term.buffer.active.viewportY; // pinned to bottom

		term.scrollToLine(1_000_000);
		expect(term.buffer.active.viewportY).toBe(bottom);

		term.scrollToLine(-50);
		expect(term.buffer.active.viewportY).toBe(0);
		term.dispose();
	});

	it("scrollPages(-1) scrolls up by one viewport height", () => {
		const before = term.buffer.active.viewportY;

		term.scrollPages(-1);

		expect(term.buffer.active.viewportY).toBe(before - term.rows);
		term.dispose();
	});

	it("scrollPages(1) scrolls back down by one viewport height", () => {
		term.scrollToTop();
		expect(term.buffer.active.viewportY).toBe(0);

		term.scrollPages(1);

		expect(term.buffer.active.viewportY).toBe(term.rows);
		term.dispose();
	});

	it("scrollToTop fires onScroll with the new position", () => {
		const cb = vi.fn();
		term.onScroll(cb);

		term.scrollToTop();

		expect(cb).toHaveBeenCalledWith(0);
		term.dispose();
	});
});

describe("buffer.onBufferChange", () => {
	let term: ReturnType<typeof createTerminal>;

	beforeEach(() => {
		term = createTerminal({ cols: 80, rows: 24 });
	});

	it("fires with the alternate buffer on enter and normal on exit (1049)", () => {
		const cb = vi.fn();
		term.buffer.onBufferChange(cb);

		term.write("\x1b[?1049h");
		expect(cb).toHaveBeenCalledTimes(1);
		expect(cb).toHaveBeenLastCalledWith(term.buffer.alternate);
		expect(term.buffer.active).toBe(term.buffer.alternate);

		term.write("\x1b[?1049l");
		expect(cb).toHaveBeenCalledTimes(2);
		expect(cb).toHaveBeenLastCalledWith(term.buffer.normal);
		expect(term.buffer.active).toBe(term.buffer.normal);

		term.dispose();
	});

	it("fires on the 1047 alt-screen toggle too", () => {
		const cb = vi.fn();
		term.buffer.onBufferChange(cb);

		term.write("\x1b[?1047h");
		term.write("\x1b[?1047l");

		expect(cb).toHaveBeenCalledTimes(2);
		expect(cb).toHaveBeenNthCalledWith(1, term.buffer.alternate);
		expect(cb).toHaveBeenNthCalledWith(2, term.buffer.normal);
		term.dispose();
	});

	it("does not fire when the active buffer does not actually change", () => {
		const cb = vi.fn();
		term.buffer.onBufferChange(cb);

		// Already on the normal buffer; exiting alt without entering is a no-op.
		term.write("\x1b[?1047l");

		expect(cb).not.toHaveBeenCalled();
		term.dispose();
	});

	it("returns a working Disposable", () => {
		const cb = vi.fn();
		const d = term.buffer.onBufferChange(cb);

		d.dispose();
		term.write("\x1b[?1049h");

		expect(cb).not.toHaveBeenCalled();
		term.dispose();
	});
});
