/**
 * Built-in fonts contract tests.
 *
 * Asserts:
 *  - All 5 vendored fonts (`jetbrains-mono`, `ibm-plex-mono`,
 *    `cascadia-mono`, `fira-mono`, `source-code-pro`) are present in
 *    `BUILTIN_FONTS`.
 *  - Each entry has a kebab-case id matching its registry key, a non-empty
 *    `family`, and a `url` ending in `.woff2`.
 *  - `getBuiltinFont(id)` round-trips and surfaces a helpful error on miss.
 *  - The `Terminal` constructor defaults to JetBrains Mono and injects the
 *    `@font-face` rule into a single shared `<style id="sterk-fonts">`.
 *  - `Terminal.setFont(id)` swaps the renderer family AND idempotently
 *    extends the shared stylesheet (never duplicates rules across swaps).
 *  - `setFont` throws on an unknown id.
 */

import { describe, expect, it } from "vitest";
import {
	BUILTIN_FONTS,
	type BuiltinFont,
	createTerminal,
	DEFAULT_FONT_ID,
	getBuiltinFont,
} from "../src/index.js";

const EXPECTED_IDS = [
	"jetbrains-mono",
	"ibm-plex-mono",
	"cascadia-mono",
	"fira-mono",
	"source-code-pro",
] as const;

const ALL: BuiltinFont[] = EXPECTED_IDS.map(
	(id) => BUILTIN_FONTS[id] as BuiltinFont,
);

describe("built-in fonts", () => {
	it("BUILTIN_FONTS exposes exactly the 5 vendored ids", () => {
		expect(Object.keys(BUILTIN_FONTS).sort()).toEqual([...EXPECTED_IDS].sort());
	});

	it("DEFAULT_FONT_ID resolves to JetBrains Mono", () => {
		expect(DEFAULT_FONT_ID).toBe("jetbrains-mono");
		expect(BUILTIN_FONTS[DEFAULT_FONT_ID]).toBeDefined();
	});

	for (const id of EXPECTED_IDS) {
		describe(id, () => {
			const font = BUILTIN_FONTS[id] as BuiltinFont;

			it("has a kebab-case id matching the registry key", () => {
				expect(font.id).toBe(id);
				expect(font.id).toMatch(/^[a-z][a-z0-9-]*$/);
			});

			it("has a non-empty family name", () => {
				expect(font.family.length).toBeGreaterThan(0);
			});

			it("has a .woff2 asset URL", () => {
				expect(font.url).toMatch(/\.woff2($|\?)/);
			});
		});
	}

	describe("getBuiltinFont()", () => {
		it("returns the font by id for every built-in", () => {
			for (const font of ALL) {
				expect(getBuiltinFont(font.id)).toBe(font);
			}
		});

		it("throws a helpful error on unknown id", () => {
			expect(() => getBuiltinFont("does-not-exist")).toThrowError(
				/does-not-exist/,
			);
			// The error message must list the known ids so consumers can
			// debug typos without grepping source.
			expect(() => getBuiltinFont("foo")).toThrowError(/jetbrains-mono/);
		});
	});

	describe("Terminal constructor default font", () => {
		it("defaults to JetBrains Mono and injects @font-face", () => {
			// Clean slate so prior tests don't influence this assertion.
			document.getElementById("sterk-fonts")?.remove();

			const term = createTerminal();
			expect(term.options.font).toBe(DEFAULT_FONT_ID);
			expect(term.options.fontFamily).toContain("JetBrains Mono");

			const sheet = document.getElementById("sterk-fonts");
			expect(sheet).not.toBeNull();
			expect(sheet?.textContent ?? "").toContain("sterk-font:jetbrains-mono");
			expect(sheet?.textContent ?? "").toContain("@font-face");
			expect(sheet?.textContent ?? "").toContain("JetBrains Mono");
			expect(sheet?.textContent ?? "").toContain(".woff2");

			term.dispose();
		});

		it("respects an explicit `font` override at construct time", () => {
			const term = createTerminal({ font: "fira-mono" });
			expect(term.options.font).toBe("fira-mono");
			expect(term.options.fontFamily).toContain("Fira Mono");
			term.dispose();
		});

		it("falls back to consumer-supplied fontFamily when font is empty string", () => {
			const term = createTerminal({ font: "", fontFamily: "Menlo, monospace" });
			expect(term.options.fontFamily).toBe("Menlo, monospace");
			term.dispose();
		});

		it("throws on an unknown font id passed to the constructor", () => {
			expect(() => createTerminal({ font: "not-a-font" })).toThrowError(
				/not-a-font/,
			);
		});
	});

	describe("Terminal.setFont()", () => {
		it("swaps the renderer family and extends the shared stylesheet", () => {
			const container = document.createElement("div");
			document.body.appendChild(container);
			const term = createTerminal();
			term.open?.(container);

			for (const font of ALL) {
				term.setFont?.(font.id);
				expect(term.options.font).toBe(font.id);
				expect(term.options.fontFamily).toContain(font.family);

				const sheet = document.getElementById("sterk-fonts");
				expect(sheet?.textContent ?? "").toContain(`sterk-font:${font.id}`);
				expect(sheet?.textContent ?? "").toContain(font.family);
				// Single shared element, never duplicated across swaps or
				// across Terminal instances.
				expect(document.querySelectorAll("#sterk-fonts").length).toBe(1);
			}

			// Idempotency: re-applying the same font does not duplicate its
			// @font-face rule.
			const before = document.getElementById("sterk-fonts")?.textContent ?? "";
			term.setFont?.("jetbrains-mono");
			term.setFont?.("jetbrains-mono");
			const after = document.getElementById("sterk-fonts")?.textContent ?? "";
			expect(after).toBe(before);

			term.dispose();
			container.parentNode?.removeChild(container);
		});

		it("throws on unknown id (consistent with getBuiltinFont)", () => {
			const container = document.createElement("div");
			document.body.appendChild(container);
			const term = createTerminal();
			term.open?.(container);

			expect(() => term.setFont?.("not-a-font")).toThrowError(/not-a-font/);

			term.dispose();
			container.parentNode?.removeChild(container);
		});
	});
});
