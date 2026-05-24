/**
 * B10 + B11 — Built-in themes contract tests
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (rows 40-46).
 *
 * Asserts:
 *  - All 5 themes (`SOLARIZED_DARK`, `SOLARIZED_LIGHT`, `TOMORROW_NIGHT`,
 *    `NORD`, `GRUVBOX_DARK_SOFT`) are present in `THEMES`.
 *  - Every theme has a 16-entry ANSI palette of valid `#rrggbb` strings.
 *  - `generateAceThemeCss(builtinThemeToTheme(t))` produces no `undefined`
 *    / `null` markers and contains the theme's bg as `--sterk-bg`.
 *  - `Terminal.setTheme(id)` swaps the live `#sterk-theme` stylesheet for
 *    every built-in id, and throws on an unknown id.
 *  - `getBuiltinTheme(id)` is the single lookup point and surfaces a
 *    helpful error on miss.
 */

import { describe, expect, it } from "vitest";
import { createTerminal } from "../src/index.js";
import { generateAceThemeCss } from "../src/renderer/theme.js";
import {
	builtinThemeToTheme,
	DEFAULT_BUILTIN_THEME_ID,
	GRUVBOX_DARK_SOFT,
	getBuiltinTheme,
	NORD,
	SOLARIZED_DARK,
	SOLARIZED_LIGHT,
	THEMES,
	TOMORROW_NIGHT,
} from "../src/themes/index.js";
import type { BuiltinTheme } from "../src/types.js";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const ALL: BuiltinTheme[] = [
	SOLARIZED_DARK,
	SOLARIZED_LIGHT,
	TOMORROW_NIGHT,
	NORD,
	GRUVBOX_DARK_SOFT,
];

describe("built-in themes (B10 + B11)", () => {
	it("THEMES exposes exactly the 5 built-in ids", () => {
		expect(Object.keys(THEMES).sort()).toEqual(
			[
				"gruvbox-dark-soft",
				"nord",
				"solarized-dark",
				"solarized-light",
				"tomorrow-night",
			].sort(),
		);
	});

	it("DEFAULT_BUILTIN_THEME_ID resolves to a real theme (Solarized Dark — safe neutral default)", () => {
		expect(THEMES[DEFAULT_BUILTIN_THEME_ID]).toBeDefined();
		// Solarized Dark is the documented safe neutral default. Consumers
		// that want it explicitly call `setTheme(DEFAULT_BUILTIN_THEME_ID)`
		// or pass `builtinThemeToTheme(SOLARIZED_DARK)` to createTerminal.
		expect(DEFAULT_BUILTIN_THEME_ID).toBe("solarized-dark");
	});

	for (const theme of ALL) {
		describe(theme.id, () => {
			it("has a kebab-case id matching the registry key", () => {
				expect(theme.id).toMatch(/^[a-z][a-z0-9-]*$/);
				expect(THEMES[theme.id]).toBe(theme);
			});

			it("has a non-empty display name", () => {
				expect(theme.name.length).toBeGreaterThan(0);
			});

			it("has exactly 16 ANSI entries, all valid #rrggbb hex", () => {
				expect(theme.ansi.length).toBe(16);
				for (const hex of theme.ansi) {
					expect(hex).toMatch(HEX_RE);
				}
			});

			it("has valid defaultFg / defaultBg / cursor hex strings", () => {
				expect(theme.defaultFg).toMatch(HEX_RE);
				expect(theme.defaultBg).toMatch(HEX_RE);
				expect(theme.cursor).toMatch(HEX_RE);
			});

			it("has a non-empty selectionBg CSS color", () => {
				expect(theme.selectionBg.length).toBeGreaterThan(0);
			});

			it("generates CSS that contains the theme's bg + every palette entry, with no undefined", () => {
				const css = generateAceThemeCss(builtinThemeToTheme(theme));
				expect(css).not.toContain("undefined");
				expect(css).not.toContain("null");
				expect(css).toContain(`--sterk-bg: ${theme.defaultBg}`);
				expect(css).toContain(`--sterk-fg: ${theme.defaultFg}`);
				// Each of the 16 ANSI colors lands in --sterk-palette-N
				for (let i = 0; i < 16; i++) {
					expect(css).toContain(`--sterk-palette-${i}: ${theme.ansi[i]}`);
				}
			});
		});
	}

	describe("getBuiltinTheme()", () => {
		it("returns the theme by id for every built-in", () => {
			for (const theme of ALL) {
				expect(getBuiltinTheme(theme.id)).toBe(theme);
			}
		});

		it("throws a helpful error on unknown id", () => {
			expect(() => getBuiltinTheme("does-not-exist")).toThrowError(
				/does-not-exist/,
			);
			// The error message must list the known ids so consumers can
			// debug typos without grepping source.
			expect(() => getBuiltinTheme("foo")).toThrowError(/solarized-dark/);
		});
	});

	describe("Terminal.setTheme()", () => {
		it("swaps the #sterk-theme stylesheet for every built-in id", () => {
			const container = document.createElement("div");
			document.body.appendChild(container);
			const term = createTerminal();
			term.open?.(container);

			for (const theme of ALL) {
				term.setTheme?.(theme.id);
				const sheet = document.getElementById("sterk-theme");
				expect(sheet?.textContent ?? "").toContain(
					`--sterk-bg: ${theme.defaultBg}`,
				);
				expect(sheet?.textContent ?? "").toContain(
					`--sterk-fg: ${theme.defaultFg}`,
				);
				// Still exactly one node — never duplicated across swaps.
				expect(document.querySelectorAll("#sterk-theme").length).toBe(1);
			}

			term.dispose();
			container.parentNode?.removeChild(container);
		});

		it("throws on unknown id (consistent with getBuiltinTheme)", () => {
			const container = document.createElement("div");
			document.body.appendChild(container);
			const term = createTerminal();
			term.open?.(container);

			expect(() => term.setTheme?.("not-a-theme")).toThrowError(/not-a-theme/);

			term.dispose();
			container.parentNode?.removeChild(container);
		});
	});
});
