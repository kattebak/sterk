/**
 * Contract tests — Public API surface
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21
 * Gap-matrix rows covered: 5, 6, 38, 39, 46
 *
 * One test per gap-matrix row. Parity / Improved rows assert real
 * behavior and must pass. Missing rows are listed as `it.todo()` so
 * the future Phase A/B/C PR that fills them flips todo → it.
 *
 * Per-row breakdown (this file):
 * - Row  5 (+):  `Terminal.refresh()` — race-safe async Promise API.
 * - Row  6 (Pa): `write(data, cb)` — working: cb fires after parser; missing:
 *                cb must fire only after the document is synced (the original
 *                mobux STERK_GAPS item 1).
 * - Row 38 (+):  explicit `dispose()` on Terminal + Renderer + Input +
 *                Mouse + Link (aceterm had no dispose at all).
 * - Row 39 (+):  full TypeScript types (aceterm had none).
 * - Row 46 (M):  Playwright real-Chromium visual regression as a CI gate
 *                (the DoD harness from D1 covers parts of this; rows-as-
 *                CI-gates is the longer-term contract).
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";

describe("contract: public API", () => {
	// ── Row 5 (+) — Race-safe refresh() Promise API ──────────────────
	describe("row 5 [+] Terminal.refresh() returns a Promise (PR #16, race-safe)", () => {
		it("exposes refresh() as a Promise-returning method", async () => {
			const term = createTerminal({ cols: 40, rows: 10 });
			expect(typeof term.refresh).toBe("function");
			const result = term.refresh?.();
			expect(result).toBeInstanceOf(Promise);
			await result;
			term.dispose();
		});

		it("resolves immediately in headless mode (no DOM attached)", async () => {
			const term = createTerminal({ cols: 40, rows: 10 });
			await expect(term.refresh?.()).resolves.toBeUndefined();
			term.dispose();
		});
	});

	// ── Row 6 (Pa) — write(data, cb) — working half ──────────────────
	describe("row 6 [Pa] write(data, cb) — callback fires after parser (working half)", () => {
		it("the optional callback is invoked once per write()", () => {
			const term = createTerminal({ cols: 40, rows: 10 });
			let n = 0;
			term.write("hello\n", () => n++);
			expect(n).toBe(1);
			term.dispose();
		});
	});

	// ── Row 38 (+) — Explicit dispose() ──────────────────────────────
	describe("row 38 [+] explicit dispose() chain", () => {
		it("dispose() is exposed on Terminal", () => {
			const term = createTerminal({ cols: 40, rows: 10 });
			expect(typeof term.dispose).toBe("function");
			expect(() => term.dispose()).not.toThrow();
		});

		it("dispose() is idempotent (a second call does not throw)", () => {
			const term = createTerminal({ cols: 40, rows: 10 });
			term.dispose();
			expect(() => term.dispose()).not.toThrow();
		});
	});

	// ── Row 39 (+) — Typed API surface ───────────────────────────────
	describe("row 39 [+] typed API: Terminal interface members are present", () => {
		it("exposes parser, buffer, write, resize, clear, dispose at runtime", () => {
			const term = createTerminal({ cols: 40, rows: 10 });
			// Types are erased at runtime — what we can assert here is the
			// member presence that the .d.ts contract advertises.
			expect(term.parser).toBeDefined();
			expect(term.buffer).toBeDefined();
			expect(typeof term.write).toBe("function");
			expect(typeof term.resize).toBe("function");
			expect(typeof term.clear).toBe("function");
			expect(typeof term.dispose).toBe("function");
			term.dispose();
		});
	});

	// ── Row 6 (Pa) — broken half ─────────────────────────────────────
	it.todo(
		"row 6 [Pa] write(data, cb) — cb must fire only after the AceRenderer document is fully synced, not just after parser.write() returns (mobux STERK_GAPS.md item 1; pattern `term.write(data, () => assertBuffer(...))` should be deterministic on slow CI)",
	);

	// ── Row 46 (M) — Real-Chromium visual regression as CI gate ──────
	it.todo(
		"row 46 [M] Playwright real-Chromium visual regression suite gates every PR (Pixel 7 emulation, deterministic test surface, per-theme baselines for steady-state / resize / write-burst / alt-screen / theme-swap / scrollback / cursor-blink — see plan #21 DoD)",
	);
});
