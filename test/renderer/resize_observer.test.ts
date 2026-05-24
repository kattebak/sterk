/**
 * Container ResizeObserver tests
 *
 * Verifies that `AceRenderer` installs a `ResizeObserver` on its host
 * container and calls `editor.resize(true)` when the content-box pixels
 * change — independent of any `window.resize` event.
 *
 * This is the regression for Bug A from the mobux postmortem
 * (mvhenten/mobux#81): Android Chrome's soft keyboard only fires
 * `visualViewport.resize`, never `window.resize`. Without a container
 * observer, Ace keeps painting into the pre-keyboard viewport box and the
 * bottom rows are hidden behind the keyboard.
 *
 * happy-dom ships a no-op ResizeObserver stub, so we install a
 * controllable polyfill that lets us trigger the callback synchronously
 * and assert that Ace re-measures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../../src/index.js";
import type { Terminal } from "../../src/types.js";

// ── Controllable ResizeObserver polyfill ──────────────────────────────
// happy-dom ships a no-op ResizeObserver. We install a polyfill that
// records (target, callback) pairs and exposes a `trigger()` so the test
// can fire the observer deterministically with a chosen contentRect.

interface ObservedTarget {
	target: Element;
	callback: ResizeObserverCallback;
	observer: ResizeObserver;
}

const observedTargets: ObservedTarget[] = [];

class TestResizeObserver implements ResizeObserver {
	constructor(private callback: ResizeObserverCallback) {}

	observe(target: Element): void {
		observedTargets.push({ target, callback: this.callback, observer: this });
	}

	unobserve(target: Element): void {
		const idx = observedTargets.findIndex(
			(t) => t.target === target && t.observer === this,
		);
		if (idx >= 0) observedTargets.splice(idx, 1);
	}

	disconnect(): void {
		for (let i = observedTargets.length - 1; i >= 0; i--) {
			if (observedTargets[i]?.observer === this) {
				observedTargets.splice(i, 1);
			}
		}
	}
}

/**
 * Fire the observer for `target` with a synthetic contentRect.
 * Returns the number of callbacks invoked.
 */
function triggerResize(
	target: Element,
	rect: { width: number; height: number },
): number {
	const matches = observedTargets.filter((t) => t.target === target);
	for (const { callback, observer } of matches) {
		const entry: ResizeObserverEntry = {
			target,
			contentRect: {
				x: 0,
				y: 0,
				top: 0,
				left: 0,
				right: rect.width,
				bottom: rect.height,
				width: rect.width,
				height: rect.height,
				toJSON: () => ({}),
			} as DOMRectReadOnly,
			borderBoxSize: [],
			contentBoxSize: [],
			devicePixelContentBoxSize: [],
		};
		callback([entry], observer);
	}
	return matches.length;
}

// Install the polyfill before each test and stub rAF so the coalesced
// `editor.resize()` fires synchronously when we flush.
let rafQueue: FrameRequestCallback[] = [];

beforeEach(() => {
	observedTargets.length = 0;
	rafQueue = [];
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback): number => {
		rafQueue.push(cb);
		return rafQueue.length;
	});
	vi.stubGlobal("cancelAnimationFrame", (_handle: number): void => {
		// Cancellation isn't relevant for these tests; flushRaf simply
		// drains whatever is queued.
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	observedTargets.length = 0;
	rafQueue = [];
});

function flushRaf(): void {
	const pending = rafQueue;
	rafQueue = [];
	for (const cb of pending) {
		cb(performance.now());
	}
}

describe("AceRenderer container ResizeObserver", () => {
	let container: HTMLElement;
	let term: Terminal | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		container.style.width = "800px";
		container.style.height = "600px";
		// happy-dom's getBoundingClientRect honours inline styles for width/height.
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

	it("observes the host container on open", () => {
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		const observed = observedTargets.find((t) => t.target === container);
		expect(observed).toBeDefined();
	});

	it("calls editor.resize(true) when the container content-box changes", () => {
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		const editor = (
			term.renderer as unknown as {
				getEditor: () => { resize: (force?: boolean) => void };
			}
		).getEditor();
		const resizeSpy = vi.spyOn(editor, "resize");

		// Simulate Android keyboard shrinking the host (no window.resize).
		triggerResize(container, { width: 800, height: 300 });
		flushRaf();

		expect(resizeSpy).toHaveBeenCalled();
		// The truthy argument forces Ace to re-measure $size before paint —
		// the whole point of this observer.
		const callsWithTruthy = resizeSpy.mock.calls.filter(
			(args) => args[0] === true,
		);
		expect(callsWithTruthy.length).toBeGreaterThan(0);
	});

	it("coalesces a burst of resize events into a single editor.resize call", () => {
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		const editor = (
			term.renderer as unknown as {
				getEditor: () => { resize: (force?: boolean) => void };
			}
		).getEditor();
		const resizeSpy = vi.spyOn(editor, "resize");
		resizeSpy.mockClear();

		// Five rapid resize events (visualViewport scroll while keyboard
		// animates) — only one rAF-flushed editor.resize should fire.
		triggerResize(container, { width: 800, height: 500 });
		triggerResize(container, { width: 800, height: 450 });
		triggerResize(container, { width: 800, height: 400 });
		triggerResize(container, { width: 800, height: 350 });
		triggerResize(container, { width: 800, height: 300 });
		flushRaf();

		expect(resizeSpy).toHaveBeenCalledTimes(1);
	});

	it("ignores spurious events with identical dimensions", () => {
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		const editor = (
			term.renderer as unknown as {
				getEditor: () => { resize: (force?: boolean) => void };
			}
		).getEditor();
		const resizeSpy = vi.spyOn(editor, "resize");

		// First, establish a known size via the observer.
		triggerResize(container, { width: 800, height: 500 });
		flushRaf();
		resizeSpy.mockClear();

		// Firing again with the same rect must be a no-op (some browsers
		// emit spurious entries when nothing actually changed).
		triggerResize(container, { width: 800, height: 500 });
		flushRaf();

		expect(resizeSpy).not.toHaveBeenCalled();
	});

	it("disconnects the observer on dispose (no leaks)", () => {
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		expect(observedTargets.some((t) => t.target === container)).toBe(true);

		term.dispose();
		term = null;

		// After dispose the observer must be torn down — no entry should
		// remain pointing at our container.
		expect(observedTargets.some((t) => t.target === container)).toBe(false);
	});

	it("does not fire editor.resize after dispose", () => {
		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		const editor = (
			term.renderer as unknown as {
				getEditor: () => { resize: (force?: boolean) => void };
			}
		).getEditor();
		const resizeSpy = vi.spyOn(editor, "resize");

		term.dispose();
		term = null;
		resizeSpy.mockClear();

		// Triggering a resize event on the (now-disconnected) container
		// must be a no-op — the observer is gone.
		const callbackCount = triggerResize(container, {
			width: 400,
			height: 200,
		});
		flushRaf();

		expect(callbackCount).toBe(0);
		expect(resizeSpy).not.toHaveBeenCalled();
	});
});
