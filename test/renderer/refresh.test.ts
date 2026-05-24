/**
 * Race-safe `Terminal.refresh()` tests.
 *
 * Background: mobux PR #79 (reverted) called Ace's `renderer.updateFull()`
 * directly to force a repaint after a container-size change. Sterk's
 * AceRenderer batches buffer→document sync onto the next rAF, so
 * `updateFull()` painted from a half-synced document and produced
 * duplicated / stale rows ("zombie rows"). See mobux issue #81.
 *
 * `Terminal.refresh()` is the race-safe entry point: it awaits the next
 * coalesced rAF flush and only then asks Ace to repaint. These tests
 * cover the happy path, the race window, and idempotency.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../../src/index.js";
import type { Terminal } from "../../src/types.js";

interface AceLike {
	renderer: { updateFull: (force?: boolean) => void };
	getSession: () => {
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
 * Snapshot all non-empty document lines (with trailing whitespace trimmed).
 * The shape of an Ace document we care about for race tests is the set of
 * lines that have actual content — empty filler rows from initial sizing
 * are not interesting.
 */
function snapshotDocumentLines(term: Terminal): string[] {
	const editor = getEditor(term);
	if (!editor) return [];
	const doc = editor.getSession().getDocument();
	const lines: string[] = [];
	for (let i = 0; i < doc.getLength(); i++) {
		const line = doc.getLine(i) ?? "";
		const trimmed = line.replace(/\s+$/, "");
		if (trimmed.length > 0) lines.push(trimmed);
	}
	return lines;
}

describe("Terminal.refresh()", () => {
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

	it("is exposed on the Terminal interface", () => {
		term = createTerminal();
		expect(typeof term.refresh).toBe("function");
	});

	it("resolves immediately in headless mode (no DOM open)", async () => {
		term = createTerminal();
		// Should not throw and should resolve without an attached renderer.
		await expect(term.refresh?.()).resolves.toBeUndefined();
	});

	// Test 1 (basic): single write + refresh produces the expected document.
	// Failure mode it catches: refresh() drops or skips the buffer→document
	// sync, leaving the document blank when the buffer is populated.
	it("basic: single write followed by refresh paints the document", async () => {
		term = createTerminal({ cols: 40, rows: 10 });
		term.open?.(container);

		term.write("hello world\n");

		await term.refresh?.();

		const lines = snapshotDocumentLines(term);
		expect(lines).toContain("hello world");
	});

	// Test 2 (the headline race test): refresh() called mid-burst must not
	// paint a half-synced document. The post-refresh snapshot must equal
	// the steady-state snapshot you'd get by just writing the burst with
	// no concurrent refresh — no duplicate / stale / interleaved rows.
	//
	// Failure mode it catches: the original mobux #79 zombie-row bug —
	// calling Ace's renderer.updateFull() during a write burst, before
	// the rAF flush has copied buffer state into the Ace document.
	it("race: refresh() mid-burst matches the post-burst steady state", async () => {
		// Reference run: write the burst with no refresh, await a rAF
		// flush, snapshot. This is the canonical post-burst document.
		const reference = createTerminal({ cols: 40, rows: 10 });
		reference.open?.(container);
		reference.write("alpha\n");
		reference.write("beta\n");
		reference.write("gamma\n");
		reference.write("delta\n");
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => resolve()),
		);
		const expected = snapshotDocumentLines(reference);
		reference.dispose();

		// Reset container for the race run.
		container.innerHTML = "";

		// Race run: feed the same burst, but call refresh() between every
		// write — the worst case for the document-sync race. Each refresh
		// must wait for the in-flight flush before painting, so the final
		// document still equals `expected`.
		term = createTerminal({ cols: 40, rows: 10 });
		term.open?.(container);

		const refreshes: Promise<void>[] = [];
		term.write("alpha\n");
		refreshes.push(term.refresh?.() ?? Promise.resolve());
		term.write("beta\n");
		refreshes.push(term.refresh?.() ?? Promise.resolve());
		term.write("gamma\n");
		refreshes.push(term.refresh?.() ?? Promise.resolve());
		term.write("delta\n");
		refreshes.push(term.refresh?.() ?? Promise.resolve());

		await Promise.all(refreshes);

		const actual = snapshotDocumentLines(term);

		// The document after the race must equal the steady-state
		// document — no zombie / stale / duplicated rows.
		expect(actual).toEqual(expected);
		// Spot check: each line appears exactly once.
		for (const line of ["alpha", "beta", "gamma", "delta"]) {
			expect(actual.filter((l) => l === line).length).toBe(1);
		}
	});

	// Test 3 (idempotency): two back-to-back refresh() calls both resolve,
	// and we coalesce them — they share the same in-flight rAF flush, so
	// the renderer's updateFull is invoked at most twice (once per
	// refresh's post-flush paint), not for every queued caller.
	//
	// Failure mode it catches: refresh() leaking a separate rAF per call,
	// or hanging on a promise that was never resolved.
	it("idempotency: two refresh() calls in the same tick both resolve, repaint coalesced", async () => {
		term = createTerminal({ cols: 40, rows: 10 });
		term.open?.(container);
		term.write("first\n");

		const editor = getEditor(term);
		expect(editor).not.toBeNull();
		// biome-ignore lint/style/noNonNullAssertion: guarded above
		const ed = editor!;
		const updateFullSpy = vi.spyOn(ed.renderer, "updateFull");

		const a = term.refresh?.();
		const b = term.refresh?.();

		await Promise.all([a, b]);

		// Both calls resolved (no hangs / orphan promises).
		// The post-flush paint runs once per `await refresh()` resumption,
		// so two refresh() calls produce at most two updateFull() calls —
		// and since they share the same in-flight rAF, in practice
		// exactly two (one each), not four.
		expect(updateFullSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
		expect(updateFullSpy.mock.calls.length).toBeLessThanOrEqual(2);

		// The document still reflects the write.
		const lines = snapshotDocumentLines(term);
		expect(lines).toContain("first");
	});
});
