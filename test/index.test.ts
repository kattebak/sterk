import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type Buffer,
	type BufferCell,
	type BufferLine,
	createTerminal,
	type Disposable,
	type OscHandler,
	type Parser,
	type Terminal,
	type TerminalOptions,
	type Theme,
	VERSION,
} from "../src/index.js";

describe("@kattebak/sterk", () => {
	it("exports VERSION", () => {
		expect(VERSION).toBeDefined();
		expect(typeof VERSION).toBe("string");
		expect(VERSION).toBe("0.0.0");
	});

	describe("type exports", () => {
		it("exports Terminal interface", () => {
			expectTypeOf<Terminal>().toHaveProperty("cols");
			expectTypeOf<Terminal>().toHaveProperty("rows");
			expectTypeOf<Terminal>().toHaveProperty("write");
			expectTypeOf<Terminal>().toHaveProperty("resize");
			expectTypeOf<Terminal>().toHaveProperty("buffer");
			expectTypeOf<Terminal>().toHaveProperty("parser");
			expectTypeOf<Terminal>().toHaveProperty("options");
			expectTypeOf<Terminal>().toHaveProperty("scrollLines");
			expectTypeOf<Terminal>().toHaveProperty("scrollToBottom");
			expectTypeOf<Terminal>().toHaveProperty("clear");
			expectTypeOf<Terminal>().toHaveProperty("onWriteParsed");
			expectTypeOf<Terminal>().toHaveProperty("onData");
			expectTypeOf<Terminal>().toHaveProperty("dispose");
		});

		it("exports Buffer interface", () => {
			expectTypeOf<Buffer>().toHaveProperty("length");
			expectTypeOf<Buffer>().toHaveProperty("cursorX");
			expectTypeOf<Buffer>().toHaveProperty("cursorY");
			expectTypeOf<Buffer>().toHaveProperty("baseY");
			expectTypeOf<Buffer>().toHaveProperty("viewportY");
			expectTypeOf<Buffer>().toHaveProperty("getLine");
		});

		it("exports BufferLine interface", () => {
			expectTypeOf<BufferLine>().toHaveProperty("isWrapped");
			expectTypeOf<BufferLine>().toHaveProperty("translateToString");
			expectTypeOf<BufferLine>().toHaveProperty("getCell");
		});

		it("exports BufferCell interface", () => {
			expectTypeOf<BufferCell>().toHaveProperty("getChars");
			expectTypeOf<BufferCell>().toHaveProperty("getCode");
			expectTypeOf<BufferCell>().toHaveProperty("getFgColor");
			expectTypeOf<BufferCell>().toHaveProperty("getBgColor");
			expectTypeOf<BufferCell>().toHaveProperty("isFgDefault");
			expectTypeOf<BufferCell>().toHaveProperty("isBgDefault");
			expectTypeOf<BufferCell>().toHaveProperty("isBold");
			expectTypeOf<BufferCell>().toHaveProperty("isItalic");
			expectTypeOf<BufferCell>().toHaveProperty("isUnderline");
			expectTypeOf<BufferCell>().toHaveProperty("isInverse");
			expectTypeOf<BufferCell>().toHaveProperty("isDim");
		});

		it("exports Parser interface", () => {
			expectTypeOf<Parser>().toHaveProperty("registerOscHandler");
		});

		it("exports TerminalOptions interface", () => {
			expectTypeOf<TerminalOptions>().toMatchTypeOf<{
				cols?: number;
				rows?: number;
				scrollback?: number;
				theme?: Theme;
				fontFamily?: string;
				fontSize?: number;
				allowSelection?: boolean;
			}>();
		});

		it("exports Theme interface", () => {
			expectTypeOf<Theme>().toMatchTypeOf<{
				foreground?: string;
				background?: string;
				palette?: string[];
			}>();
		});

		it("exports Disposable interface", () => {
			expectTypeOf<Disposable>().toHaveProperty("dispose");
		});

		it("OscHandler is a function type", () => {
			expectTypeOf<OscHandler>().toBeFunction();
			expectTypeOf<OscHandler>().parameters.toMatchTypeOf<[string]>();
		});
	});

	describe("createTerminal", () => {
		it("is a function", () => {
			expect(typeof createTerminal).toBe("function");
		});

		it("throws with a clear error message", () => {
			expect(() => createTerminal()).toThrow(
				/not yet implemented.*ROADMAP\.md/i,
			);
		});

		it("accepts optional TerminalOptions", () => {
			expect(() => createTerminal({ cols: 80, rows: 24 })).toThrow();
		});

		it("return type is Terminal", () => {
			expectTypeOf(createTerminal).returns.toMatchTypeOf<Terminal>();
		});

		it("accepts theme configuration", () => {
			expect(() =>
				createTerminal({
					theme: {
						foreground: "#f0f0f0",
						background: "#1e1e1e",
						palette: [
							"#000000",
							"#cd0000",
							"#00cd00",
							"#cdcd00",
							"#0000ee",
							"#cd00cd",
							"#00cdcd",
							"#e5e5e5",
						],
					},
				}),
			).toThrow();
		});
	});

	describe("API contract validation", () => {
		it("Terminal.write accepts string or Uint8Array", () => {
			type WriteParam = Parameters<Terminal["write"]>[0];
			expectTypeOf<WriteParam>().toEqualTypeOf<string | Uint8Array>();
		});

		it("Terminal.onWriteParsed returns Disposable", () => {
			type OnWriteParsedReturn = ReturnType<Terminal["onWriteParsed"]>;
			expectTypeOf<OnWriteParsedReturn>().toMatchTypeOf<Disposable>();
		});

		it("Terminal.onData callback receives string", () => {
			type CallbackParam = Parameters<Parameters<Terminal["onData"]>[0]>[0];
			expectTypeOf<CallbackParam>().toEqualTypeOf<string>();
		});

		it("Parser.registerOscHandler accepts id and handler", () => {
			type Params = Parameters<Parser["registerOscHandler"]>;
			expectTypeOf<Params>().toMatchTypeOf<[number, OscHandler]>();
		});

		it("Buffer.getLine returns BufferLine or null", () => {
			type GetLineReturn = ReturnType<Buffer["getLine"]>;
			expectTypeOf<GetLineReturn>().toEqualTypeOf<BufferLine | null>();
		});

		it("BufferCell color accessors return numbers", () => {
			expectTypeOf<BufferCell["getFgColor"]>().returns.toBeNumber();
			expectTypeOf<BufferCell["getBgColor"]>().returns.toBeNumber();
		});

		it("BufferCell style accessors return booleans", () => {
			expectTypeOf<BufferCell["isBold"]>().returns.toBeBoolean();
			expectTypeOf<BufferCell["isItalic"]>().returns.toBeBoolean();
			expectTypeOf<BufferCell["isUnderline"]>().returns.toBeBoolean();
			expectTypeOf<BufferCell["isInverse"]>().returns.toBeBoolean();
		});
	});
});
