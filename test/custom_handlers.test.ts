/**
 * xterm.js-compatible custom handlers + extra events + options slice
 * (kattebak/sterk#36).
 *
 * Covers the additive, non-breaking surface:
 * - attachCustomKeyEventHandler / attachCustomWheelEventHandler — a `false`
 *   return suppresses terminal processing of the event.
 * - onKey — fires alongside onData for key input, carrying the DOM event.
 * - onBinary — fires for the binary subset (mouse reports), at the same
 *   point as onData.
 * - onRender — fires after a committed repaint with the affected row range.
 * - convertEol — `\n` in write() is treated as `\r\n` (behavioral).
 * - disableStdin — suppresses user input → onData (behavioral).
 * - cursorBlink / cursorStyle / cursorInactiveStyle — accepted and surfaced
 *   on `term.options` (store-only).
 *
 * DOM-driven cases attach to a detached container, stub rAF so the renderer
 * flush is synchronous, dispatch real DOM events on the input surface, and
 * dispose afterwards (happy-dom).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../src/index.js";
import type { Terminal } from "../src/types.js";

// ── rAF stubbing so renderer flushes are synchronous ────────────────────
let rafQueue: FrameRequestCallback[] = [];

function flushRaf(): void {
	const pending = rafQueue;
	rafQueue = [];
	for (const cb of pending) {
		cb(performance.now());
	}
}

interface RendererLike {
	getElement(): HTMLElement;
	getCellMetrics: () => { width: number; height: number } | null;
}

function inputElement(term: Terminal): HTMLElement {
	const renderer = term.renderer as RendererLike;
	return renderer.getElement();
}

/**
 * Pin cell metrics + the element's bounding rect so MouseHandler resolves
 * deterministic cell coordinates under happy-dom (which does not measure
 * font metrics, leaving Ace's charWidth/lineHeight at 0). Same approach as
 * test/integration/mouse_modes.test.ts.
 */
function pinMouseGeometry(term: Terminal): void {
	const renderer = term.renderer as RendererLike;
	renderer.getCellMetrics = () => ({ width: 10, height: 18 });
	const rect = {
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 1000,
		bottom: 1000,
		width: 1000,
		height: 1000,
		toJSON: () => ({}),
	} as DOMRect;
	inputElement(term).getBoundingClientRect = () => rect;
}

describe("convertEol (behavioral)", () => {
	it("treats `\\n` as `\\r\\n` so write('a\\nb') produces two rows", () => {
		const term = createTerminal({ cols: 80, rows: 24, convertEol: true });
		term.write("a\nb");

		// Without convertEol, `a\nb` stair-steps: row0 "a", row1 "_b" (cursor
		// stays in col 1). With convertEol the LF becomes CRLF so `b` starts
		// at column 0 of the next row.
		const row0 = term.buffer.active.getLine(0)?.translateToString(true);
		const row1 = term.buffer.active.getLine(1)?.translateToString(true);
		expect(row0).toBe("a");
		expect(row1).toBe("b");
		term.dispose();
	});

	it("does not double-convert an existing CRLF", () => {
		const term = createTerminal({ cols: 80, rows: 24, convertEol: true });
		term.write("a\r\nb");
		expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe("a");
		expect(term.buffer.active.getLine(1)?.translateToString(true)).toBe("b");
		term.dispose();
	});

	it("is accepted and surfaced as false by default", () => {
		const term = createTerminal({ cols: 80, rows: 24 });
		expect(term.options.convertEol).toBe(false);
		term.dispose();
	});
});

describe("disableStdin (behavioral)", () => {
	let container: HTMLElement;
	let term: Terminal;

	beforeEach(() => {
		rafQueue = [];
		vi.stubGlobal(
			"requestAnimationFrame",
			(cb: FrameRequestCallback): number => {
				rafQueue.push(cb);
				return rafQueue.length;
			},
		);
		vi.stubGlobal("cancelAnimationFrame", () => {});
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		term.dispose();
		container.remove();
		vi.unstubAllGlobals();
		rafQueue = [];
	});

	it("suppresses user keyboard input from emitting onData", () => {
		term = createTerminal({ cols: 80, rows: 24, disableStdin: true });
		term.open?.(container);

		const onData = vi.fn();
		term.onData(onData);

		inputElement(term).dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);

		expect(onData).not.toHaveBeenCalled();
	});

	it("does NOT suppress programmatic send()", () => {
		term = createTerminal({ cols: 80, rows: 24, disableStdin: true });
		term.open?.(container);

		const onData = vi.fn();
		term.onData(onData);
		term.send?.("x");

		expect(onData).toHaveBeenCalledWith("x");
	});

	it("input flows normally when disableStdin is false", () => {
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		const onData = vi.fn();
		term.onData(onData);
		inputElement(term).dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);

		expect(onData).toHaveBeenCalledWith("a");
	});
});

describe("attachCustomKeyEventHandler + onKey", () => {
	let container: HTMLElement;
	let term: Terminal;

	beforeEach(() => {
		rafQueue = [];
		vi.stubGlobal(
			"requestAnimationFrame",
			(cb: FrameRequestCallback): number => {
				rafQueue.push(cb);
				return rafQueue.length;
			},
		);
		vi.stubGlobal("cancelAnimationFrame", () => {});
		container = document.createElement("div");
		document.body.appendChild(container);
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);
	});

	afterEach(() => {
		term.dispose();
		container.remove();
		vi.unstubAllGlobals();
		rafQueue = [];
	});

	it("onKey fires alongside onData with the translated key + domEvent", () => {
		const onData = vi.fn();
		const onKey = vi.fn();
		term.onData(onData);
		term.onKey(onKey);

		const ev = new KeyboardEvent("keydown", { key: "a", bubbles: true });
		inputElement(term).dispatchEvent(ev);

		expect(onData).toHaveBeenCalledWith("a");
		expect(onKey).toHaveBeenCalledTimes(1);
		expect(onKey.mock.calls[0]?.[0]).toMatchObject({ key: "a", domEvent: ev });
	});

	it("returning false from the custom handler suppresses processing", () => {
		const onData = vi.fn();
		const onKey = vi.fn();
		term.onData(onData);
		term.onKey(onKey);
		term.attachCustomKeyEventHandler(() => false);

		inputElement(term).dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);

		expect(onData).not.toHaveBeenCalled();
		expect(onKey).not.toHaveBeenCalled();
	});

	it("returning true lets normal processing proceed", () => {
		const onData = vi.fn();
		term.onData(onData);
		term.attachCustomKeyEventHandler(() => true);

		inputElement(term).dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);

		expect(onData).toHaveBeenCalledWith("a");
	});

	it("onKey Disposable stops delivery", () => {
		const onKey = vi.fn();
		const d = term.onKey(onKey);
		d.dispose();

		inputElement(term).dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);

		expect(onKey).not.toHaveBeenCalled();
	});

	it("a handler attached before open() is honoured after open()", () => {
		// Fresh terminal: attach BEFORE open to exercise the pending-flush path.
		const t2 = createTerminal({ cols: 80, rows: 24 });
		t2.attachCustomKeyEventHandler(() => false);
		const c2 = document.createElement("div");
		document.body.appendChild(c2);
		t2.open?.(c2);

		const onData = vi.fn();
		t2.onData(onData);
		inputElement(t2).dispatchEvent(
			new KeyboardEvent("keydown", { key: "a", bubbles: true }),
		);

		expect(onData).not.toHaveBeenCalled();
		t2.dispose();
		c2.remove();
	});
});

describe("attachCustomWheelEventHandler + onBinary", () => {
	let container: HTMLElement;
	let term: Terminal;

	beforeEach(() => {
		rafQueue = [];
		vi.stubGlobal(
			"requestAnimationFrame",
			(cb: FrameRequestCallback): number => {
				rafQueue.push(cb);
				return rafQueue.length;
			},
		);
		vi.stubGlobal("cancelAnimationFrame", () => {});
		container = document.createElement("div");
		document.body.appendChild(container);
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);
	});

	afterEach(() => {
		term.dispose();
		container.remove();
		vi.unstubAllGlobals();
		rafQueue = [];
	});

	it("returning false from the custom wheel handler suppresses scroll", () => {
		const onScrollLines = vi.fn();
		// A wheel with tracking off normally scrolls the viewport. We observe
		// suppression via onScroll NOT firing (scrollLines is internal).
		term.onScroll(onScrollLines);
		term.attachCustomWheelEventHandler(() => false);

		inputElement(term).dispatchEvent(
			new WheelEvent("wheel", { deltaY: 100, bubbles: true }),
		);
		flushRaf();

		expect(onScrollLines).not.toHaveBeenCalled();
	});

	it("onBinary fires for mouse-report (binary) data alongside onData", () => {
		pinMouseGeometry(term);
		// Enable VT200 tracking + SGR encoding so a mousedown produces a
		// mouse-report sequence (the binary subset).
		term.write("\x1b[?1000h\x1b[?1006h");
		flushRaf();

		const onData = vi.fn();
		const onBinary = vi.fn();
		term.onData(onData);
		term.onBinary(onBinary);

		inputElement(term).dispatchEvent(
			new MouseEvent("mousedown", {
				button: 0,
				clientX: 5,
				clientY: 5,
				bubbles: true,
			}),
		);

		// Both streams carry the SGR mouse report at the same point.
		expect(onBinary).toHaveBeenCalledTimes(1);
		expect(onData).toHaveBeenCalledTimes(1);
		const binaryPayload = onBinary.mock.calls[0]?.[0] as string;
		// SGR 1006 mouse report begins with CSI `<` (ESC [ <).
		expect(binaryPayload.startsWith("\x1b[<")).toBe(true);
		expect(onData.mock.calls[0]?.[0]).toBe(binaryPayload);
	});

	it("onBinary Disposable stops delivery", () => {
		pinMouseGeometry(term);
		term.write("\x1b[?1000h\x1b[?1006h");
		flushRaf();

		const onBinary = vi.fn();
		const d = term.onBinary(onBinary);
		d.dispose();

		inputElement(term).dispatchEvent(
			new MouseEvent("mousedown", {
				button: 0,
				clientX: 5,
				clientY: 5,
				bubbles: true,
			}),
		);

		expect(onBinary).not.toHaveBeenCalled();
	});
});

describe("onRender", () => {
	let container: HTMLElement;
	let term: Terminal;

	beforeEach(() => {
		rafQueue = [];
		vi.stubGlobal(
			"requestAnimationFrame",
			(cb: FrameRequestCallback): number => {
				rafQueue.push(cb);
				return rafQueue.length;
			},
		);
		vi.stubGlobal("cancelAnimationFrame", () => {});
		container = document.createElement("div");
		document.body.appendChild(container);
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);
		// Drain the initial open() render so the callback only sees our write.
		flushRaf();
	});

	afterEach(() => {
		term.dispose();
		container.remove();
		vi.unstubAllGlobals();
		rafQueue = [];
	});

	it("fires after a committed repaint with a row range", () => {
		const onRender = vi.fn();
		term.onRender(onRender);

		term.write("hello");
		flushRaf();

		expect(onRender).toHaveBeenCalledTimes(1);
		const range = onRender.mock.calls[0]?.[0] as {
			start: number;
			end: number;
		};
		expect(range.start).toBe(0);
		expect(range.end).toBeGreaterThanOrEqual(0);
	});

	it("Disposable stops delivery", () => {
		const onRender = vi.fn();
		const d = term.onRender(onRender);
		d.dispose();

		term.write("hello");
		flushRaf();

		expect(onRender).not.toHaveBeenCalled();
	});
});

describe("cursor options (store-only, surfaced on term.options)", () => {
	it("defaults are applied and readable", () => {
		const term = createTerminal({ cols: 80, rows: 24 });
		expect(term.options.cursorBlink).toBe(false);
		expect(term.options.cursorStyle).toBe("block");
		expect(term.options.cursorInactiveStyle).toBe("outline");
		expect(term.options.convertEol).toBe(false);
		expect(term.options.disableStdin).toBe(false);
		term.dispose();
	});

	it("accepts and surfaces explicit values", () => {
		const term = createTerminal({
			cols: 80,
			rows: 24,
			cursorBlink: true,
			cursorStyle: "bar",
			cursorInactiveStyle: "none",
		});
		expect(term.options.cursorBlink).toBe(true);
		expect(term.options.cursorStyle).toBe("bar");
		expect(term.options.cursorInactiveStyle).toBe("none");
		term.dispose();
	});
});
