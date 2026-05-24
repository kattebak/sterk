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
import {
	GRUVBOX_DARK_SOFT,
	NORD,
	SOLARIZED_DARK,
	SOLARIZED_LIGHT,
	THEMES,
	TOMORROW_NIGHT,
} from "../../src/themes/index.js";

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

	// ── Rows 40-44 (M) — Built-in themes (B10 + B11) ─────────────────
	// One assertion per row: the constant exists, lives in THEMES under
	// the documented id, and carries the expected palette anchor color
	// from its canonical source (cited in each theme file's JSDoc).
	it("row 40 [M] Solarized Dark shipped as `SOLARIZED_DARK` constant + registry entry", () => {
		expect(SOLARIZED_DARK.id).toBe("solarized-dark");
		expect(THEMES["solarized-dark"]).toBe(SOLARIZED_DARK);
		// Canonical Solarized base03 (#002b36) — the Solarized dark bg.
		expect(SOLARIZED_DARK.defaultBg).toBe("#002b36");
		expect(SOLARIZED_DARK.ansi.length).toBe(16);
	});

	it("row 41 [M] Solarized Light shipped as `SOLARIZED_LIGHT` constant + registry entry", () => {
		expect(SOLARIZED_LIGHT.id).toBe("solarized-light");
		expect(THEMES["solarized-light"]).toBe(SOLARIZED_LIGHT);
		// Canonical Solarized base3 (#fdf6e3) — the Solarized light bg.
		expect(SOLARIZED_LIGHT.defaultBg).toBe("#fdf6e3");
	});

	it("row 42 [M] Tomorrow Night shipped as `TOMORROW_NIGHT` constant + registry entry", () => {
		expect(TOMORROW_NIGHT.id).toBe("tomorrow-night");
		expect(THEMES["tomorrow-night"]).toBe(TOMORROW_NIGHT);
		// Chris Kempson's Tomorrow Night background.
		expect(TOMORROW_NIGHT.defaultBg).toBe("#1d1f21");
	});

	it("row 43 [M] Nord shipped as `NORD` constant + registry entry", () => {
		expect(NORD.id).toBe("nord");
		expect(THEMES.nord).toBe(NORD);
		// Polar Night nord0 — Nord background.
		expect(NORD.defaultBg).toBe("#2e3440");
	});

	it("row 44 [M] Gruvbox Dark Soft shipped as `GRUVBOX_DARK_SOFT` constant + registry entry", () => {
		expect(GRUVBOX_DARK_SOFT.id).toBe("gruvbox-dark-soft");
		expect(THEMES["gruvbox-dark-soft"]).toBe(GRUVBOX_DARK_SOFT);
		// Gruvbox bg0_s — soft-contrast dark background.
		expect(GRUVBOX_DARK_SOFT.defaultBg).toBe("#32302f");
	});
});
