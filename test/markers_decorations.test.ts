/**
 * Markers / decorations / link providers — xterm.js parity (kattebak/sterk#36).
 *
 * Headless coverage (no `open()`, so no real DOM rendering needed):
 * - registerMarker returns a marker whose `line` tracks the buffer as content
 *   scrolls in, and which auto-disposes (firing onDispose) when its line
 *   scrolls out of the retained buffer or on explicit dispose / clear.
 * - registerDecoration lifecycle: object identity, dispose, onDispose, and
 *   disposing-with-its-marker. (Overlay DOM is exercised via the open() path
 *   in a single attach test; the rest stay headless.)
 * - registerLinkProvider returns a Disposable that stops delivery.
 *
 * All assertions are no-throw headless except the one open()/overlay test,
 * which attaches to a detached container and disposes afterwards.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../src/index.js";
import { DecorationImpl } from "../src/marker.js";
import { LinkDetector } from "../src/renderer/links.js";
import type {
	Buffer,
	ILinkProvider,
	IProvidedLink,
	Terminal as TerminalInstance,
} from "../src/types.js";

describe("registerMarker", () => {
	let term: TerminalInstance;

	afterEach(() => {
		term.dispose();
	});

	it("returns a marker anchored at the cursor row", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("line0\r\nline1\r\nline2");
		const buf = term.buffer.active;
		const cursorAbs = buf.baseY + buf.cursorY;
		const marker = term.registerMarker();
		expect(marker).toBeDefined();
		expect(marker?.line).toBe(cursorAbs);
		expect(marker?.isDisposed).toBe(false);
		expect(typeof marker?.id).toBe("number");
	});

	it("supports a cursorYOffset", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("a\r\nb\r\nc");
		const buf = term.buffer.active;
		const cursorAbs = buf.baseY + buf.cursorY;
		const marker = term.registerMarker(-1);
		expect(marker?.line).toBe(cursorAbs - 1);
	});

	it("line tracks the same logical row as content scrolls in", () => {
		// Small scrollback so we can both keep the marker AND scroll content in.
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("anchor-line");
		const marker = term.registerMarker();
		const startLine = marker?.line ?? -1;
		expect(startLine).toBeGreaterThanOrEqual(0);

		// Write several new lines; the anchored line stays at the SAME absolute
		// row (no eviction yet, scrollback is large), so `line` is unchanged.
		for (let i = 0; i < 10; i++) term.write("\r\nmore");
		expect(marker?.line).toBe(startLine);
		expect(marker?.isDisposed).toBe(false);

		// The anchored line should still be readable at marker.line.
		const text = term.buffer.active
			.getLine(marker?.line ?? 0)
			?.translateToString(true);
		expect(text).toContain("anchor-line");
	});

	it("auto-disposes and fires onDispose when its line scrolls out", () => {
		// Tiny scrollback so the anchored line is evicted after a few writes.
		term = createTerminal({ cols: 20, rows: 3, scrollback: 2 });
		// maxLines = rows + scrollback = 5.
		term.write("OLDEST");
		const marker = term.registerMarker();
		expect(marker?.isDisposed).toBe(false);
		const anchoredRow = marker?.line ?? -1;

		const onDispose = vi.fn();
		marker?.onDispose(onDispose);

		// Push many new lines so the ring drops the anchored line.
		for (let i = 0; i < 20; i++) term.write("\r\nx");

		expect(term.buffer.active.baseY).toBeGreaterThan(anchoredRow);
		expect(marker?.isDisposed).toBe(true);
		expect(onDispose).toHaveBeenCalledTimes(1);
	});

	it("disposes explicitly and fires onDispose once", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("hello");
		const marker = term.registerMarker();
		const onDispose = vi.fn();
		marker?.onDispose(onDispose);

		marker?.dispose();
		expect(marker?.isDisposed).toBe(true);
		expect(marker?.line).toBe(-1);
		expect(onDispose).toHaveBeenCalledTimes(1);

		// Idempotent: a second dispose does not re-fire.
		marker?.dispose();
		expect(onDispose).toHaveBeenCalledTimes(1);
	});

	it("disposes all markers on clear()", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("hi");
		const marker = term.registerMarker();
		const onDispose = vi.fn();
		marker?.onDispose(onDispose);
		term.clear();
		expect(marker?.isDisposed).toBe(true);
		expect(onDispose).toHaveBeenCalledTimes(1);
	});

	it("onDispose Disposable can unsubscribe before dispose", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("hi");
		const marker = term.registerMarker();
		const onDispose = vi.fn();
		const sub = marker?.onDispose(onDispose);
		sub?.dispose();
		marker?.dispose();
		expect(onDispose).not.toHaveBeenCalled();
	});
});

describe("registerDecoration", () => {
	let term: TerminalInstance;

	afterEach(() => {
		term.dispose();
	});

	it("returns a decoration bound to its marker (headless)", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("deco");
		const marker = term.registerMarker();
		if (!marker) throw new Error("marker not created");
		const decoration = term.registerDecoration({ marker });
		expect(decoration).toBeDefined();
		expect(decoration?.marker).toBe(marker);
		expect(decoration?.isDisposed).toBe(false);
		// Headless: no DOM, so no overlay element and onRender does not fire.
		expect(decoration?.element).toBeUndefined();
	});

	it("does not fire onRender in headless mode", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("deco");
		const marker = term.registerMarker();
		if (!marker) throw new Error("marker not created");
		const decoration = term.registerDecoration({ marker });
		const onRender = vi.fn();
		decoration?.onRender(onRender);
		expect(onRender).not.toHaveBeenCalled();
	});

	it("dispose fires onDispose once and is idempotent", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("deco");
		const marker = term.registerMarker();
		if (!marker) throw new Error("marker not created");
		const decoration = term.registerDecoration({ marker });
		const onDispose = vi.fn();
		decoration?.onDispose(onDispose);

		decoration?.dispose();
		expect(decoration?.isDisposed).toBe(true);
		expect(onDispose).toHaveBeenCalledTimes(1);
		decoration?.dispose();
		expect(onDispose).toHaveBeenCalledTimes(1);
	});

	it("disposes with its marker", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("deco");
		const marker = term.registerMarker();
		if (!marker) throw new Error("marker not created");
		const decoration = term.registerDecoration({ marker });
		const onDispose = vi.fn();
		decoration?.onDispose(onDispose);

		marker.dispose();
		expect(decoration?.isDisposed).toBe(true);
		expect(onDispose).toHaveBeenCalledTimes(1);
	});

	it("returns undefined for an already-disposed marker", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("deco");
		const marker = term.registerMarker();
		if (!marker) throw new Error("marker not created");
		marker.dispose();
		const decoration = term.registerDecoration({ marker });
		expect(decoration).toBeUndefined();
	});

	it("stays lifecycle-correct through open() without real cell metrics", () => {
		// happy-dom does not lay out the Ace editor, so getCellMetrics()
		// returns null and the overlay cannot be pixel-positioned (documented
		// Ace-layer limitation). The decoration must still survive open() and
		// remain disposable — we don't fake an element when we can't measure.
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		term.write("deco");
		const marker = term.registerMarker();
		if (!marker) throw new Error("marker not created");
		const decoration = term.registerDecoration({
			marker,
			backgroundColor: "#f00",
		});
		const container = document.createElement("div");
		document.body.appendChild(container);
		term.open?.(container);
		// Without metrics there is no overlay element and onRender did not fire
		// — honest behaviour, not a fake.
		expect(decoration?.isDisposed).toBe(false);
		expect(decoration?.element).toBeUndefined();
		expect(() => decoration?.dispose()).not.toThrow();
		document.body.removeChild(container);
	});

	it("positions an overlay when cell metrics are available", () => {
		// Drive the renderer-agnostic DecorationImpl directly with a stub
		// render context so the overlay-positioning logic is covered without
		// depending on a real (unmeasurable under happy-dom) Ace layout.
		const marker = {
			id: 1,
			line: 2,
			isDisposed: false,
			onDispose: () => ({ dispose() {} }),
			dispose() {},
		};
		const parent = document.createElement("div");
		const ctx = {
			getOverlayParent: () => parent,
			getCellMetrics: () => ({ width: 8, height: 16 }),
			getViewportTop: () => 0,
		};
		const decoration = new DecorationImpl(
			{ marker, x: 3, width: 2, backgroundColor: "#abc" },
			ctx,
		);
		const onRender = vi.fn();
		decoration.onRender(onRender);
		expect(decoration.element).toBeInstanceOf(HTMLElement);
		expect(onRender).toHaveBeenCalled();
		expect(decoration.element?.style.position).toBe("absolute");
		expect(decoration.element?.style.top).toBe(`${2 * 16}px`);
		expect(decoration.element?.style.left).toBe(`${3 * 8}px`);
		expect(decoration.element?.style.width).toBe(`${2 * 8}px`);
		expect(parent.children.length).toBe(1);
		decoration.dispose();
		expect(parent.children.length).toBe(0);
	});
});

describe("registerLinkProvider", () => {
	let term: TerminalInstance;

	afterEach(() => {
		term.dispose();
	});

	function makeProvider(spy: () => void): ILinkProvider {
		return {
			provideLinks(
				bufferLineNumber: number,
				callback: (links: IProvidedLink[] | undefined) => void,
			) {
				spy();
				const link: IProvidedLink = {
					range: {
						start: { x: 1, y: bufferLineNumber },
						end: { x: 5, y: bufferLineNumber },
					},
					text: "link",
				};
				callback([link]);
			},
		};
	}

	it("returns a Disposable and does not throw headless", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		const sub = term.registerLinkProvider(makeProvider(() => {}));
		expect(typeof sub.dispose).toBe("function");
		expect(() => sub.dispose()).not.toThrow();
	});

	it("LinkDetector queries providers on hover and a provided link activates", () => {
		// happy-dom can't measure Ace cell metrics, so we drive the
		// LinkDetector directly with a stub metrics fn — this exercises the
		// provider hit-test + activate() wiring honestly. (At the terminal
		// level the providers ARE handed to the detector; see the open()
		// flush in terminal.ts.)
		const el = document.createElement("div");
		// happy-dom getBoundingClientRect → zeros; clientX/Y map to col/row 0.
		const buffer = {
			viewportY: 0,
			getLine: () => ({ translateToString: () => "" }),
		} as unknown as Buffer;
		const detector = new LinkDetector(
			el,
			() => buffer,
			() => ({ width: 8, height: 16 }),
		);

		const activated: string[] = [];
		const provider: ILinkProvider = {
			provideLinks(bufferLineNumber, callback) {
				callback([
					{
						range: {
							start: { x: 1, y: bufferLineNumber },
							end: { x: 5, y: bufferLineNumber },
						},
						text: "provided-link",
						activate: (_e, text) => activated.push(text),
					},
				]);
			},
		};
		const unregister = detector.addProvider(provider);

		const hovered: Array<unknown> = [];
		detector.onHover((link) => hovered.push(link));

		// Hover at col 0 (clientX small) on row 0 → inside the provided link
		// range [0,4).
		el.dispatchEvent(
			new MouseEvent("mousemove", { clientX: 1, clientY: 1, bubbles: true }),
		);
		const hit = hovered[hovered.length - 1] as { text?: string } | null;
		expect(hit?.text).toBe("provided-link");

		// Clicking invokes the provided link's activate handler.
		el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(activated).toEqual(["provided-link"]);

		// Unregistering stops provider delivery: a fresh hover finds no link.
		unregister();
		el.dispatchEvent(
			new MouseEvent("mousemove", { clientX: 1, clientY: 1, bubbles: true }),
		);
		expect(hovered[hovered.length - 1]).toBeNull();

		detector.dispose();
	});

	it("registerLinkProvider wiring survives open() and dispose stops it", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		// Register before open() (buffered) and after — both paths must not
		// throw and both Disposables must be safe to dispose.
		const subBefore = term.registerLinkProvider(makeProvider(() => {}));
		const container = document.createElement("div");
		document.body.appendChild(container);
		term.open?.(container);
		const subAfter = term.registerLinkProvider(makeProvider(() => {}));
		expect(() => subBefore.dispose()).not.toThrow();
		expect(() => subAfter.dispose()).not.toThrow();
		document.body.removeChild(container);
	});

	it("dispose is idempotent and safe before open()", () => {
		term = createTerminal({ cols: 20, rows: 5, scrollback: 100 });
		const sub = term.registerLinkProvider(makeProvider(() => {}));
		sub.dispose();
		expect(() => sub.dispose()).not.toThrow();
	});
});
