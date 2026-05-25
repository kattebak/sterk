/**
 * xterm.js API parity — construction + method slice (kattebak/sterk#36).
 *
 * Covers the additive, non-breaking surface added to match `@xterm/xterm`:
 * - construction via BOTH `new Terminal(opts)` and `createTerminal(opts)`
 * - `writeln` appends CRLF
 * - `reset` clears the buffer, homes the cursor, leaves the alternate
 *   screen, and resets SGR attributes to defaults
 * - `focus` / `blur` don't throw (headless) and toggle editor focus once
 *   `open()` has wired a renderer
 * - `paste` routes through the `onData` path (plain paste — bracketed-paste
 *   mode is not tracked in this codebase)
 * - `input` aliases `send`
 *
 * Construction-time `font` resolution injects a `@font-face`; under
 * happy-dom that is harmless. `open()`-based tests attach to a detached
 * container and dispose afterwards.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal, Terminal } from "../src/index.js";
import type { Terminal as TerminalInstance } from "../src/types.js";

function firstLine(term: TerminalInstance): string {
	const line = term.buffer.active.getLine(0);
	return line ? line.translateToString(true) : "";
}

describe("xterm API parity", () => {
	describe("construction", () => {
		it("new Terminal(options) constructs an instance", () => {
			const term = new Terminal({ cols: 100, rows: 30 });
			expect(term.cols).toBe(100);
			expect(term.rows).toBe(30);
			term.dispose();
		});

		it("new Terminal() works with no options (defaults)", () => {
			const term = new Terminal();
			expect(term.cols).toBe(80);
			expect(term.rows).toBe(24);
			term.dispose();
		});

		it("createTerminal(options) still constructs an instance", () => {
			const term = createTerminal({ cols: 120, rows: 40 });
			expect(term.cols).toBe(120);
			expect(term.rows).toBe(40);
			term.dispose();
		});

		it("both constructors yield instances with the same method surface", () => {
			const a = new Terminal();
			const b = createTerminal();
			for (const m of [
				"write",
				"writeln",
				"reset",
				"focus",
				"blur",
				"paste",
				"input",
				"send",
			] as const) {
				expect(typeof (a as unknown as Record<string, unknown>)[m]).toBe(
					"function",
				);
				expect(typeof (b as unknown as Record<string, unknown>)[m]).toBe(
					"function",
				);
			}
			a.dispose();
			b.dispose();
		});
	});

	describe("writeln", () => {
		it("appends CRLF after the data", () => {
			const term = createTerminal();
			term.writeln("hello");
			// "hello" lands on row 0; the CRLF moves the cursor to a fresh row.
			expect(firstLine(term)).toBe("hello");
			const buf = term.buffer.active;
			// Cursor advanced past row 0 (CR homes column, LF advances row).
			expect(buf.cursorX).toBe(0);
			expect(buf.cursorY).toBeGreaterThan(0);
			term.dispose();
		});

		it("invokes the callback after writing", () => {
			const term = createTerminal();
			let called = false;
			term.writeln("x", () => {
				called = true;
			});
			expect(called).toBe(true);
			term.dispose();
		});

		it("accepts a Uint8Array", () => {
			const term = createTerminal();
			term.writeln(new TextEncoder().encode("bytes"));
			expect(firstLine(term)).toBe("bytes");
			term.dispose();
		});
	});

	describe("reset", () => {
		it("clears buffer content and homes the cursor", () => {
			const term = createTerminal();
			term.write("line one\r\nline two");
			expect(firstLine(term)).toBe("line one");
			term.reset();
			expect(firstLine(term)).toBe("");
			const buf = term.buffer.active;
			expect(buf.cursorX).toBe(0);
			expect(buf.cursorY).toBe(0);
			term.dispose();
		});

		it("resets SGR attributes to defaults", () => {
			const term = createTerminal();
			// Turn on bold + a palette foreground, then reset.
			term.write("\x1b[1;31m");
			term.reset();
			// Newly printed text must carry default (non-bold) attributes.
			term.write("A");
			const cell = term.buffer.active.getLine(0)?.getCell(0);
			expect(cell?.getChars()).toBe("A");
			expect(cell?.isBold()).toBe(false);
			expect(cell?.isFgDefault()).toBe(true);
			term.dispose();
		});

		it("leaves the alternate screen when active", () => {
			const term = createTerminal();
			// Enter alternate screen (DEC 1049).
			term.write("\x1b[?1049h");
			term.write("alt-content");
			term.reset();
			// After reset we are back on the normal buffer, cleared.
			expect(firstLine(term)).toBe("");
			term.dispose();
		});
	});

	describe("paste / input", () => {
		it("paste routes data through onData", () => {
			const term = createTerminal();
			const seen: string[] = [];
			term.onData((d) => seen.push(d));
			term.paste("pasted text");
			expect(seen).toEqual(["pasted text"]);
			term.dispose();
		});

		it("input aliases send (string)", () => {
			const term = createTerminal();
			const seen: string[] = [];
			term.onData((d) => seen.push(d));
			term.input("typed");
			expect(seen).toEqual(["typed"]);
			term.dispose();
		});

		it("input aliases send (Uint8Array) and accepts wasUserInput", () => {
			const term = createTerminal();
			const seen: string[] = [];
			term.onData((d) => seen.push(d));
			term.input(new TextEncoder().encode("bytes"), true);
			expect(seen).toEqual(["bytes"]);
			term.dispose();
		});
	});

	describe("focus / blur", () => {
		it("are no-ops (do not throw) in headless mode", () => {
			const term = createTerminal();
			expect(() => term.focus()).not.toThrow();
			expect(() => term.blur()).not.toThrow();
			term.dispose();
		});

		describe("with an attached renderer", () => {
			let container: HTMLElement;
			let term: TerminalInstance;

			beforeEach(() => {
				container = document.createElement("div");
				document.body.appendChild(container);
				term = createTerminal();
				term.open?.(container);
			});

			afterEach(() => {
				term.dispose();
				container.remove();
			});

			it("focus()/blur() do not throw and toggle editor focus", () => {
				expect(() => term.focus()).not.toThrow();
				const renderer = term.renderer as
					| { getEditor: () => { isFocused: () => boolean } }
					| undefined;
				// Where focus state is observable, focus() should report focused
				// and blur() should clear it. happy-dom drives Ace's textarea
				// focus, so isFocused() reflects the toggle.
				if (renderer?.getEditor) {
					const editor = renderer.getEditor();
					expect(editor.isFocused()).toBe(true);
					term.blur();
					expect(editor.isFocused()).toBe(false);
				} else {
					expect(() => term.blur()).not.toThrow();
				}
			});
		});
	});
});
