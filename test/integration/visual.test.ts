/**
 * V4 — Visual race-safety integration tests.
 *
 * Background: mobux PR #79 (https://github.com/mvhenten/mobux/pull/79,
 * reverted in #80) forced a repaint via Ace internals during an active
 * write burst. Sterk's renderer batches buffer→document sync on a
 * coalesced rAF; the forced repaint caught the document mid-sync and
 * produced "zombie rows" — duplicated prompt lines, stale content
 * interleaved with fresh writes. See the postmortem at
 * https://github.com/mvhenten/mobux/issues/81.
 *
 * Sterk closed that hole with two complementary APIs:
 *   • `Terminal.refresh()`            — race-safe public repaint barrier (PR #16)
 *   • `AceRenderer` ResizeObserver    — auto re-measure on container change (PR #15)
 *
 * The existing unit tests in `test/renderer/refresh.test.ts` and
 * `test/renderer/resize_observer.test.ts` cover the API surface of each
 * feature in isolation. These integration tests exercise the *integrated*
 * failure mode: a realistic write burst with concurrent renderer-side
 * activity (mid-burst refresh or mid-burst container resize). They will
 * catch any future internal refactor that re-introduces the race window —
 * even one that leaves both unit-test suites green.
 *
 * Strategy: capture-then-compare. Each test runs a *reference* terminal
 * that receives the same write burst with **no** mid-burst intervention,
 * snapshots its document + cursor + viewport, then runs the *variant*
 * terminal with the intervention applied and asserts byte-equal state.
 * No external snapshot file is involved — the assertion is purely
 * intra-test and therefore deterministic across environments.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../../src/index.js";
import type { Terminal } from "../../src/types.js";

// ── Test helpers ─────────────────────────────────────────────────────

interface AceLike {
	renderer: { updateFull: (force?: boolean) => void };
	getSession: () => {
		getValue: () => string;
		getDocument: () => {
			getLength: () => number;
			getLine: (i: number) => string;
		};
	};
}

interface RendererLike {
	getEditor?: () => AceLike;
}

function getEditor(term: Terminal): AceLike | null {
	const renderer = term.renderer as RendererLike | undefined;
	return renderer?.getEditor?.() ?? null;
}

/**
 * Full document snapshot: every line concatenated with `\n`, plus the
 * structural state that a user would notice on-screen (cursor + viewport
 * scroll). This is what the roadmap calls "rendered document state" —
 * what the consumer sees. The cursor + viewport are part of the user-
 * visible surface; a race that desynchronises them from the document
 * content is also a bug.
 */
interface DocumentSnapshot {
	text: string;
	docLength: number;
	cursorX: number;
	cursorY: number;
	baseY: number;
	viewportY: number;
	bufferLength: number;
}

function snapshotDocument(term: Terminal): DocumentSnapshot {
	const editor = getEditor(term);
	const session = editor?.getSession();
	const text = session?.getValue() ?? "";
	const docLength = session?.getDocument().getLength() ?? 0;
	const buffer = term.buffer.active;
	return {
		text,
		docLength,
		cursorX: buffer.cursorX,
		cursorY: buffer.cursorY,
		baseY: buffer.baseY,
		viewportY: buffer.viewportY,
		bufferLength: buffer.length,
	};
}

/**
 * Realistic write burst — exercises every interesting buffer→document
 * code path:
 *   • SGR escape codes (color attributes per cell)
 *   • Plain ASCII lines
 *   • A line whose printed length exceeds `cols` (40), so the buffer
 *     auto-advances the cursor onto the next row — this is the
 *     buffer-to-document mapping case that the original mobux #79
 *     zombie-row regression mis-rendered.
 *   • Cursor reset between lines via CR LF
 * Total: 60 distinct prompt+output line pairs (≥ 50, as required).
 *
 * The burst is built once and reused so reference and variant runs feed
 * identical bytes.
 */
function buildWriteBurst(): string[] {
	const writes: string[] = [];
	const RESET = "\x1b[0m";
	const GREEN = "\x1b[32m";
	const CYAN = "\x1b[36m";
	const BOLD = "\x1b[1m";
	const RED = "\x1b[31m";

	// 60 prompt+output pairs (each pair is two writes). We pad some
	// command names so a handful of lines render wider than the 40-col
	// terminal, forcing the auto-advance-to-next-row path in the buffer.
	for (let i = 0; i < 60; i++) {
		const wide = i % 7 === 0; // every 7th line is wider than cols=40
		const cmd = wide
			? `long-running-command-${i}-with-extra-padding-${i}`
			: `cmd-${i}`;
		writes.push(
			`${GREEN}user@host${RESET}:${CYAN}~${RESET}$ ${BOLD}${cmd}${RESET}\r\n`,
		);
		writes.push(`${RED}output line ${i}${RESET}\r\n`);
	}
	return writes;
}

/**
 * Feed every byte in `writes` synchronously, in the same microtask. This
 * is the mobux failure mode: a PTY drain delivers a flurry of writes
 * back-to-back; the renderer is expected to coalesce them into a single
 * rAF flush. Any intervention (refresh / resize) must wait for that
 * flush before it can be allowed to paint.
 */
function flushBurstSynchronously(term: Terminal, writes: string[]): void {
	for (const chunk of writes) {
		term.write(chunk);
	}
}

/**
 * Wait for at least N animation frames so coalesced flushes and any
 * Ace-internal scheduleRender callbacks have all settled.
 */
async function settleFrames(n = 3): Promise<void> {
	for (let i = 0; i < n; i++) {
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
	}
}

// ── ResizeObserver polyfill (shared with resize_observer.test.ts) ────
//
// happy-dom ships a no-op `ResizeObserver`. We install a controllable
// polyfill so the test can trigger a synthetic content-box change with
// the AceRenderer's observer still wired up natively. This is the
// `visualViewport`-only path from the postmortem: no `window.resize`
// ever fires.

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

// ── Tests ────────────────────────────────────────────────────────────

describe("V4 integration — visual race safety under write burst", () => {
	let container: HTMLElement;
	let term: Terminal | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		container.style.width = "800px";
		container.style.height = "600px";
		document.body.appendChild(container);
		// Install the controllable ResizeObserver up front so even the
		// reference terminal exercises the same observer code path as the
		// variant — we never want the reference and variant runs to differ
		// in *which* observer is wired in.
		observedTargets.length = 0;
		vi.stubGlobal("ResizeObserver", TestResizeObserver);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		observedTargets.length = 0;
		if (term) {
			term.dispose();
			term = null;
		}
		if (container.parentNode) {
			container.parentNode.removeChild(container);
		}
	});

	/**
	 * V4a — Race-safe refresh under write burst.
	 *
	 * Failure mode it catches: the original mobux #79 zombie-row bug, and
	 * any future regression where `refresh()` does not wait for the
	 * in-flight buffer→document sync to complete before forcing Ace to
	 * paint. A regressed refresh() would either:
	 *   • snapshot a half-synced document (text mismatch),
	 *   • leave the cursor in the wrong place (cursor mismatch), or
	 *   • produce duplicated rows from a stale paint (row-count drift).
	 * All three are flagged by the equality assertion below.
	 */
	it("V4a — refresh() mid-burst converges to the no-refresh steady state", async () => {
		const burst = buildWriteBurst();

		// 1. Reference run: same burst, no mid-burst refresh.
		const reference = createTerminal({ cols: 40, rows: 10 });
		reference.open?.(container);
		flushBurstSynchronously(reference, burst);
		await settleFrames();
		const expected = snapshotDocument(reference);
		reference.dispose();

		// Sanity check: the reference snapshot must be non-trivial — the
		// burst produced 120 logical lines (60 prompt + 60 output) plus
		// a handful of auto-advanced rows for over-width lines. If the
		// reference is empty, equality below would pass trivially.
		expect(expected.text.length).toBeGreaterThan(1000);
		expect(expected.docLength).toBeGreaterThanOrEqual(60);

		// Reset the container so the variant runs in an identical DOM
		// environment.
		container.innerHTML = "";

		// 2. Variant run: identical burst, but call refresh() *mid-burst*.
		// We invoke refresh() three times — once after roughly 1/3 of the
		// burst, once after 2/3, once at the very end — so the race
		// window is exercised at multiple points along the burst, not
		// just at the boundary.
		term = createTerminal({ cols: 40, rows: 10 });
		term.open?.(container);

		const refreshes: Promise<void>[] = [];
		const third = Math.floor(burst.length / 3);
		const twoThirds = Math.floor((burst.length * 2) / 3);
		for (let i = 0; i < burst.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: burst[i] is in range
			term.write(burst[i]!);
			if (i === third || i === twoThirds) {
				refreshes.push(term.refresh?.() ?? Promise.resolve());
			}
		}
		refreshes.push(term.refresh?.() ?? Promise.resolve());

		await Promise.all(refreshes);
		await settleFrames();

		const actual = snapshotDocument(term);

		// 3. Full equality: the document state after the race must match
		// the steady-state run byte-for-byte. Any zombie row, missed
		// write, stale paint, or cursor drift is a diff here.
		expect(actual).toEqual(expected);

		// Defensive spot checks — narrow assertions that would identify
		// the *kind* of failure if the equality assertion ever regresses:
		//   • No duplicate prompt lines
		//   • Every output line shows up exactly once
		// We match each output line with a trailing word boundary so
		// "output line 1" does not also match "output line 10..19".
		const lines = actual.text.split("\n");
		for (let i = 0; i < 60; i++) {
			const needle = `output line ${i}`;
			const re = new RegExp(`\\boutput line ${i}\\b`);
			const occurrences = lines.filter((l) => re.test(l)).length;
			expect(occurrences, `"${needle}" should appear exactly once`).toBe(1);
		}
	});

	/**
	 * V4b — ResizeObserver-triggered resize under write burst.
	 *
	 * Failure mode it catches: a future refactor where the
	 * ResizeObserver path calls `editor.resize(true)` (which forces an
	 * Ace re-paint from the document) before the in-flight buffer→
	 * document sync has run. Same race window as V4a, but reached via
	 * the resize callback instead of `refresh()`. On Android Chrome
	 * this happens every time the soft keyboard opens.
	 *
	 * Crucially, we trigger the resize via the observer callback only —
	 * no `window.resize` event is ever fired. This mirrors the actual
	 * mobile path: `visualViewport` height changes → CSS layout shrinks
	 * the host → `ResizeObserver` fires → `editor.resize(true)`. If a
	 * regression wires the resize to a `window.resize` listener, this
	 * test will (correctly) still pass — but the unit test in
	 * `resize_observer.test.ts` will fail, catching it there.
	 */
	it("V4b — ResizeObserver fired mid-burst converges to the no-resize steady state", async () => {
		const burst = buildWriteBurst();

		// 1. Reference run: same burst, container left at its original
		// size, no observer trigger.
		const reference = createTerminal({ cols: 40, rows: 10 });
		reference.open?.(container);
		flushBurstSynchronously(reference, burst);
		await settleFrames();
		const expected = snapshotDocument(reference);
		reference.dispose();

		// Sanity check: snapshot non-trivial (see V4a for rationale).
		expect(expected.text.length).toBeGreaterThan(1000);
		expect(expected.docLength).toBeGreaterThanOrEqual(60);

		// Reset container to a clean slate. (The host element keeps its
		// original inline styles; the variant run will use the same
		// container.)
		container.innerHTML = "";
		observedTargets.length = 0;

		// 2. Variant run: identical burst, but mid-burst fire the
		// ResizeObserver to simulate the Android soft-keyboard opening.
		// We fire it twice — once mid-burst (keyboard opening animation)
		// and once near the end (keyboard settled at final height) — to
		// exercise both the coalesced-burst and post-burst paths.
		term = createTerminal({ cols: 40, rows: 10 });
		term.open?.(container);

		const third = Math.floor(burst.length / 3);
		const twoThirds = Math.floor((burst.length * 2) / 3);
		for (let i = 0; i < burst.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: burst[i] is in range
			term.write(burst[i]!);
			if (i === third) {
				// Simulate soft keyboard starting to open: host shrinks.
				triggerResize(container, { width: 800, height: 350 });
			}
			if (i === twoThirds) {
				// Keyboard fully open: host shrinks further.
				triggerResize(container, { width: 800, height: 300 });
			}
		}

		// Drain everything: write-burst rAF + observer-coalesced rAF +
		// any Ace internal scheduleRender chains. settleFrames(3) is
		// enough for happy-dom; if the observer was wired to a longer
		// chain, the equality assertion below would surface the drift.
		await settleFrames(5);

		const actual = snapshotDocument(term);

		// 3. Full equality: a resize that lands mid-burst must not
		// duplicate, lose, or interleave any row. The document state
		// must match the no-resize reference run exactly.
		expect(actual).toEqual(expected);

		// Defensive spot check — every output line appears exactly once.
		// Match with a word boundary so "output line 1" does not also
		// match "output line 10".
		const lines = actual.text.split("\n");
		for (let i = 0; i < 60; i++) {
			const needle = `output line ${i}`;
			const re = new RegExp(`\\boutput line ${i}\\b`);
			const occurrences = lines.filter((l) => re.test(l)).length;
			expect(occurrences, `"${needle}" should appear exactly once`).toBe(1);
		}
	});
});
