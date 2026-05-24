/**
 * Contract tests — Theme (palette, contrast, runtime swap, built-in themes)
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21
 * Gap-matrix rows covered: 20, 21, 40, 41, 42, 43, 44, 45
 *
 * One test per gap-matrix row. Parity / Improved rows assert real
 * behavior and must pass. Missing rows are listed as `it.todo()` so
 * the future Phase A/B/C PR that fills them flips todo → it.
 *
 * Per-row breakdown (this file):
 * - Row 20 (+):  runtime palette swap via per-instance CSS injection
 *                (`applyTheme()`); aceterm used per-class statics.
 * - Row 21 (M):  default-fg-on-explicit-bg luminance fallback
 *                (`Aceterm.contrastFg`) — the black-on-black bug.
 * - Row 40 (M):  built-in Solarized Dark theme shipped out-of-the-box.
 * - Row 41 (M):  built-in Solarized Light theme.
 * - Row 42 (M):  built-in Tomorrow Night theme (aceterm-via-mobux identity).
 * - Row 43 (M):  built-in Nord theme.
 * - Row 44 (M):  built-in Gruvbox Dark Soft theme.
 * - Row 45 (+):  runtime theme swap without re-instantiating Terminal.
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";
import { applyTheme, generateAceThemeCss } from "../../src/renderer/theme.js";

describe("contract: theme", () => {
	// ── Row 20 (+) — Runtime palette swap (per-instance CSS) ─────────
	describe("row 20 [+] runtime palette swap via per-instance CSS injection", () => {
		it("generateAceThemeCss emits per-instance --sterk-* variables", () => {
			const css = generateAceThemeCss({
				foreground: "#ff0000",
				background: "#000000",
				palette: ["#111111", "#cc0000"],
			});
			expect(css).toContain("--sterk-fg: #ff0000");
			expect(css).toContain("--sterk-bg: #000000");
			expect(css).toContain("--sterk-palette-0: #111111");
			expect(css).toContain("--sterk-palette-1: #cc0000");
		});
	});

	// ── Row 45 (+) — Runtime theme swap without re-instantiation ────
	describe("row 45 [+] runtime theme swap without re-instantiating Terminal", () => {
		it("applyTheme() re-injects #sterk-theme stylesheet (one element, swapped contents)", () => {
			const container = document.createElement("div");
			document.body.appendChild(container);

			const term = createTerminal({
				theme: { foreground: "#ffffff", background: "#000000" },
			});
			term.open?.(container);

			const before = document.getElementById("sterk-theme");
			expect(before?.textContent ?? "").toContain("--sterk-fg: #ffffff");

			// Swap themes at runtime — no new Terminal needed.
			applyTheme({ foreground: "#ff5555", background: "#222222" });

			const after = document.getElementById("sterk-theme");
			// Still exactly one #sterk-theme node; aceterm couldn't do this
			// without a Terminal class re-wire.
			expect(document.querySelectorAll("#sterk-theme").length).toBe(1);
			expect(after?.textContent ?? "").toContain("--sterk-fg: #ff5555");

			term.dispose();
			container.parentNode?.removeChild(container);
		});
	});

	// ── Row 21 (M) — Contrast-fg fallback (the black-on-black bug) ──
	it.todo(
		"row 21 [M] default-fg-on-explicit-bg luminance fallback: writing `\\x1b[40m` (black bg) + default-fg picks a readable fg via luminance (aceterm contrastFg; sterk: missing — caused real mobux bug pre-PR #55)",
	);

	// ── Rows 40-44 (M) — Built-in themes ─────────────────────────────
	it.todo(
		"row 40 [M] built-in theme: Solarized Dark (Ethan Schoonover) shipped as `SOLARIZED_DARK` constant + DoD baseline target",
	);
	it.todo(
		"row 41 [M] built-in theme: Solarized Light shipped as `SOLARIZED_LIGHT` constant + DoD baseline target",
	);
	it.todo(
		"row 42 [M] built-in theme: Tomorrow Night (Chris Kempson) — preserves aceterm-via-mobux visual identity, shipped as `TOMORROW_NIGHT`",
	);
	it.todo(
		"row 43 [M] built-in theme: Nord (Arctic Ice Studio) shipped as `NORD` — OLED-friendly muted palette",
	);
	it.todo(
		"row 44 [M] built-in theme: Gruvbox Dark Soft (morhetz) shipped as `GRUVBOX_DARK_SOFT` — warm earth tones, non-blue alternative",
	);
});
