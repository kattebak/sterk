import { describe, expect, it } from "vitest";
import {
	DEFAULT_THEME,
	generateAceThemeCss,
} from "../../src/renderer/theme.js";

describe("theme", () => {
	describe("DEFAULT_THEME", () => {
		it("exports default colors", () => {
			expect(DEFAULT_THEME.foreground).toBeDefined();
			expect(DEFAULT_THEME.background).toBeDefined();
			expect(DEFAULT_THEME.cursor).toBeDefined();
			expect(DEFAULT_THEME.cursorAccent).toBeDefined();
			expect(DEFAULT_THEME.selectionBackground).toBeDefined();
		});
	});

	describe("generateAceThemeCss", () => {
		it("generates CSS with default theme", () => {
			const css = generateAceThemeCss();
			expect(css).toContain(".sterk");
			expect(css).toContain("--sterk-fg:");
			expect(css).toContain("--sterk-bg:");
			expect(css).toContain("--sterk-cursor:");
			expect(css).toContain(".ace_editor");
			expect(css).toContain(".ace_cursor");
			expect(css).toContain(".ace_selection");
		});

		it("uses provided foreground color", () => {
			const css = generateAceThemeCss({ foreground: "#ff0000" });
			expect(css).toContain("--sterk-fg: #ff0000");
		});

		it("uses provided background color", () => {
			const css = generateAceThemeCss({ background: "#000000" });
			expect(css).toContain("--sterk-bg: #000000");
		});

		it("uses provided cursor color", () => {
			const css = generateAceThemeCss({ cursor: "#00ff00" });
			expect(css).toContain("--sterk-cursor: #00ff00");
		});

		it("uses provided selection color", () => {
			const css = generateAceThemeCss({
				selectionBackground: "rgba(255, 0, 0, 0.5)",
			});
			expect(css).toContain("--sterk-selection: rgba(255, 0, 0, 0.5)");
		});

		it("generates palette CSS variables", () => {
			const css = generateAceThemeCss();
			// Check for some palette colors
			expect(css).toContain("--sterk-palette-0:");
			expect(css).toContain("--sterk-palette-15:");
			expect(css).toContain("--sterk-palette-255:");
		});

		it("merges custom palette colors", () => {
			const css = generateAceThemeCss({
				palette: ["#111111", "#ff0000"], // Custom black and red
			});
			expect(css).toContain("--sterk-palette-0: #111111");
			expect(css).toContain("--sterk-palette-1: #ff0000");
		});

		it("handles individual ANSI color overrides", () => {
			const css = generateAceThemeCss({
				red: "#cc0000",
				blue: "#0000cc",
			});
			expect(css).toContain("--sterk-palette-1: #cc0000"); // red
			expect(css).toContain("--sterk-palette-4: #0000cc"); // blue
		});

		it("handles bright color overrides", () => {
			const css = generateAceThemeCss({
				brightRed: "#ff5555",
				brightBlue: "#5555ff",
			});
			expect(css).toContain("--sterk-palette-9: #ff5555"); // bright red
			expect(css).toContain("--sterk-palette-12: #5555ff"); // bright blue
		});

		it("individual overrides take precedence over palette array", () => {
			const css = generateAceThemeCss({
				palette: ["#000000", "#111111"], // palette[1] = #111111
				red: "#ff0000", // Override palette[1]
			});
			expect(css).toContain("--sterk-palette-1: #ff0000");
		});

		it("generates valid CSS", () => {
			const css = generateAceThemeCss({
				foreground: "#ffffff",
				background: "#000000",
			});

			// Should not have syntax errors (basic check)
			expect(css).not.toContain("undefined");
			expect(css).not.toContain("null");

			// Should have proper structure
			expect(css.match(/\.sterk \{/)).toBeTruthy();
			expect(css.match(/\.ace_editor \{/)).toBeTruthy();
		});

		it("handles empty theme object", () => {
			const css = generateAceThemeCss({});
			expect(css).toContain("--sterk-fg:");
			expect(css).toContain("--sterk-bg:");
			// Should use defaults
			expect(css).toContain(DEFAULT_THEME.foreground);
			expect(css).toContain(DEFAULT_THEME.background);
		});

		// ── A3: luminance contrast fallback ─────────────────────────────
		// (kattebak/sterk#21 row 21, mvhenten/mobux PR #55)
		describe("default-fg-on-explicit-bg luminance contrast (A3)", () => {
			it("emits a contrast rule for every palette bg index", () => {
				const css = generateAceThemeCss();
				// Palette covers 0-255 (see buildPalette()). One contrast
				// rule per index keeps the generated CSS deterministic.
				// Selectors carry the `ace_` prefix because Ace's text
				// layer turns each `.`-separated token type segment into
				// an `ace_`-prefixed className (see vt_mode.ts header).
				for (let i = 0; i < 256; i++) {
					expect(css).toContain(`.ace_sterk-bg-${i}.ace_sterk-fg-default`);
				}
			});

			it("dark palette bgs map to white default fg", () => {
				const css = generateAceThemeCss();
				// Palette index 0 = ANSI black (#000000) -> light fg.
				expect(css).toContain(
					".ace_editor .ace_sterk-bg-0.ace_sterk-fg-default { color: #ffffff !important; }",
				);
				// Palette index 4 = ANSI blue (#0000ee) -> light fg.
				expect(css).toContain(
					".ace_editor .ace_sterk-bg-4.ace_sterk-fg-default { color: #ffffff !important; }",
				);
			});

			it("light palette bgs map to black default fg", () => {
				const css = generateAceThemeCss();
				// Palette index 7 = ANSI white (#e5e5e5) -> dark fg.
				expect(css).toContain(
					".ace_editor .ace_sterk-bg-7.ace_sterk-fg-default { color: #000000 !important; }",
				);
				// Palette index 15 = ANSI bright white (#ffffff) -> dark fg.
				expect(css).toContain(
					".ace_editor .ace_sterk-bg-15.ace_sterk-fg-default { color: #000000 !important; }",
				);
			});

			it("contrast rules track theme palette overrides", () => {
				// Swap palette index 0 (normally black) for a near-white
				// colour. The contrast rule for index 0 must flip to dark
				// fg because the painted bg is now light.
				const css = generateAceThemeCss({
					palette: ["#f0f0f0"], // override only palette[0]
				});
				expect(css).toContain(
					".ace_editor .ace_sterk-bg-0.ace_sterk-fg-default { color: #000000 !important; }",
				);
			});
		});
	});
});
