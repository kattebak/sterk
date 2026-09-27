import { describe, expect, it } from "vitest";
import * as headless from "../src/headless.js";
import * as main from "../src/index.js";

const MAIN_EXPORTS_3_0_0 = [
	"ANSI_COLORS",
	"BUILTIN_FONTS",
	"DEFAULT_BUILTIN_THEME_ID",
	"DEFAULT_FONT_ID",
	"EventEmitter",
	"GRUVBOX_DARK_SOFT",
	"LUMINANCE_THRESHOLD",
	"NORD",
	"SOLARIZED_DARK",
	"SOLARIZED_LIGHT",
	"THEMES",
	"TOMORROW_NIGHT",
	"Terminal",
	"VERSION",
	"buildPalette",
	"builtinThemeToTheme",
	"contrastFg",
	"createTerminal",
	"getBuiltinFont",
	"getBuiltinTheme",
	"hexToPalette",
	"hexToRgb",
	"injectFontFace",
	"paletteToHex",
	"paletteToRgb",
	"relativeLuminance",
	"rgbToHex",
	"rgbToPalette",
];

describe("@kattebak/sterk/headless", () => {
	it("exports only the terminal constructors at runtime", () => {
		expect(Object.keys(headless).sort()).toEqual([
			"Terminal",
			"createTerminal",
		]);
	});

	it("parses into the buffer", () => {
		const term = headless.createTerminal({ cols: 20, rows: 4 });
		term.write("hello\r\n\x1b[1mbold\x1b[0m");
		const buffer = term.buffer.active;
		expect(buffer.getLine(0)?.translateToString(true)).toBe("hello");
		expect(buffer.getLine(1)?.getCell(0).isBold()).toBe(true);
		term.dispose();
	});

	it("answers device queries through onReply", () => {
		const term = new headless.Terminal({ cols: 20, rows: 4 });
		const replies: string[] = [];
		term.onReply((data) => replies.push(data));
		term.write("ab\x1b[6n\x1b[c");
		expect(replies).toEqual(["\x1b[1;3R", "\x1b[?1;2c"]);
		term.dispose();
	});

	it("tracks markers as the buffer scrolls", () => {
		const term = headless.createTerminal({ cols: 20, rows: 3, scrollback: 10 });
		term.write("first");
		const marker = term.registerMarker();
		term.write("\r\nsecond\r\nthird\r\nfourth");
		expect(marker?.line).toBe(0);
		expect(marker?.isDisposed).toBe(false);
		term.dispose();
	});

	it("has no bundled font and refuses to draw", () => {
		const term = headless.createTerminal();
		expect(term.options.font).toBe("");
		expect(() => term.open?.(document.createElement("div"))).toThrow(
			/@kattebak\/sterk\/headless/,
		);
		expect(() => term.setFont?.("fira-mono")).toThrow(/needs a renderer/);
		expect(() => headless.createTerminal({ font: "fira-mono" })).toThrow(
			/needs a renderer/,
		);
		term.dispose();
	});

	it("keeps theme colours for colour queries without touching the DOM", () => {
		const term = headless.createTerminal();
		const replies: string[] = [];
		term.onReply((data) => replies.push(data));
		term.setTheme?.("nord");
		term.write("\x1b]11;?\x07");
		expect(replies).toEqual(["\x1b]11;rgb:2e2e/3434/4040\x07"]);
		expect(document.getElementById("sterk-theme")).toBeNull();
		term.dispose();
	});
});

describe("@kattebak/sterk main entry", () => {
	it("keeps every 3.0.0 export", () => {
		const names = Object.keys(main);
		for (const name of MAIN_EXPORTS_3_0_0) expect(names).toContain(name);
	});

	it("still applies the bundled font by default", () => {
		const term = main.createTerminal();
		expect(term.options.font).toBe(main.DEFAULT_FONT_ID);
		term.dispose();
	});
});
