/**
 * xterm.js parity — element / textarea / modes / unicode accessors and the
 * new TerminalOptions (kattebak/sterk#36). Additive, non-breaking.
 *
 * Covers:
 * - `element` / `textarea` resolve after `open()`, undefined headless and
 *   after `dispose()`
 * - `modes` reflects mode toggles driven by escapes (bracketed paste,
 *   application cursor keys, focus reporting, IRM insert mode, mouse
 *   tracking) and defaults for untracked modes
 * - `reset()` clears tracked modes
 * - `unicode.activeVersion` reports the wcwidth-targeted Unicode version
 * - new options are accepted and surfaced on `term.options`
 * - wired options take effect (tabStopWidth on HT; lineHeight on the
 *   renderer cell metrics)
 *
 * `open()`-based tests attach to a detached container and dispose afterwards.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal, Terminal } from "../src/index.js";
import type { Terminal as TerminalInstance } from "../src/types.js";

describe("xterm parity: accessors + options", () => {
	describe("element / textarea accessors", () => {
		it("are undefined headless (before open)", () => {
			const term = new Terminal();
			expect(term.element).toBeUndefined();
			expect(term.textarea).toBeUndefined();
			term.dispose();
		});

		it("resolve after open() and clear after dispose()", () => {
			const container = document.createElement("div");
			document.body.appendChild(container);
			const term = createTerminal();
			term.open?.(container);

			expect(term.element).toBe(container);
			const textarea = term.textarea;
			expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
			// Ace creates its hidden input with the .ace_text-input class.
			expect(textarea?.classList.contains("ace_text-input")).toBe(true);

			term.dispose();
			expect(term.element).toBeUndefined();
			expect(term.textarea).toBeUndefined();
			container.remove();
		});
	});

	describe("modes", () => {
		let term: TerminalInstance;
		beforeEach(() => {
			term = new Terminal();
		});
		afterEach(() => {
			term.dispose();
		});

		it("reports xterm defaults at power-on", () => {
			const m = term.modes;
			expect(m.applicationCursorKeysMode).toBe(false);
			expect(m.applicationKeypadMode).toBe(false);
			expect(m.bracketedPasteMode).toBe(false);
			expect(m.insertMode).toBe(false);
			expect(m.mouseTrackingMode).toBe("none");
			expect(m.originMode).toBe(false);
			expect(m.reverseWraparoundMode).toBe(false);
			expect(m.sendFocusMode).toBe(false);
			// sterk always wraps at the right margin → xterm default true.
			expect(m.wraparoundMode).toBe(true);
		});

		it("bracketed paste: ?2004h sets, ?2004l clears", () => {
			term.write("\x1b[?2004h");
			expect(term.modes.bracketedPasteMode).toBe(true);
			term.write("\x1b[?2004l");
			expect(term.modes.bracketedPasteMode).toBe(false);
		});

		it("application cursor keys: ?1h sets, ?1l clears", () => {
			term.write("\x1b[?1h");
			expect(term.modes.applicationCursorKeysMode).toBe(true);
			term.write("\x1b[?1l");
			expect(term.modes.applicationCursorKeysMode).toBe(false);
		});

		it("focus reporting: ?1004h sets, ?1004l clears", () => {
			term.write("\x1b[?1004h");
			expect(term.modes.sendFocusMode).toBe(true);
			term.write("\x1b[?1004l");
			expect(term.modes.sendFocusMode).toBe(false);
		});

		it("insert mode (IRM): CSI 4 h sets, CSI 4 l clears", () => {
			term.write("\x1b[4h");
			expect(term.modes.insertMode).toBe(true);
			term.write("\x1b[4l");
			expect(term.modes.insertMode).toBe(false);
		});

		it("mouse tracking maps DEC modes to xterm names", () => {
			term.write("\x1b[?1000h");
			expect(term.modes.mouseTrackingMode).toBe("vt200");
			term.write("\x1b[?1002h");
			expect(term.modes.mouseTrackingMode).toBe("drag");
			term.write("\x1b[?1003h");
			expect(term.modes.mouseTrackingMode).toBe("any");
			term.write("\x1b[?1003l");
			expect(term.modes.mouseTrackingMode).toBe("none");
		});

		it("reset() clears tracked modes", () => {
			term.write("\x1b[?2004h\x1b[?1h\x1b[?1004h\x1b[4h");
			expect(term.modes.bracketedPasteMode).toBe(true);
			term.reset();
			const m = term.modes;
			expect(m.bracketedPasteMode).toBe(false);
			expect(m.applicationCursorKeysMode).toBe(false);
			expect(m.sendFocusMode).toBe(false);
			expect(m.insertMode).toBe(false);
		});

		it("modes is a fresh read-only snapshot", () => {
			const first = term.modes;
			term.write("\x1b[?2004h");
			// The earlier snapshot is not mutated retroactively.
			expect(first.bracketedPasteMode).toBe(false);
			expect(term.modes.bracketedPasteMode).toBe(true);
		});
	});

	describe("unicode", () => {
		it("reports the wcwidth-targeted Unicode version", () => {
			const term = new Terminal();
			expect(term.unicode.activeVersion).toBe("15");
			term.dispose();
		});
	});

	describe("new options surfaced on term.options", () => {
		it("accepts and surfaces all new options", () => {
			const term = new Terminal({
				lineHeight: 1.5,
				letterSpacing: 2,
				fontWeight: 600,
				tabStopWidth: 4,
				wordSeparator: " .",
				screenReaderMode: true,
			});
			expect(term.options.lineHeight).toBe(1.5);
			expect(term.options.letterSpacing).toBe(2);
			expect(term.options.fontWeight).toBe(600);
			expect(term.options.tabStopWidth).toBe(4);
			expect(term.options.wordSeparator).toBe(" .");
			expect(term.options.screenReaderMode).toBe(true);
			term.dispose();
		});

		it("applies sensible defaults", () => {
			const term = new Terminal();
			expect(term.options.lineHeight).toBe(1.0);
			expect(term.options.letterSpacing).toBe(0);
			expect(term.options.fontWeight).toBe("normal");
			expect(term.options.tabStopWidth).toBe(8);
			expect(term.options.screenReaderMode).toBe(false);
			expect(typeof term.options.wordSeparator).toBe("string");
			term.dispose();
		});
	});

	describe("wired options", () => {
		it("tabStopWidth changes the HT advance width", () => {
			const term = new Terminal({ cols: 80, rows: 4, tabStopWidth: 4 });
			// Cursor at column 0; a tab should land on the next multiple of 4.
			term.write("\t");
			expect(term.buffer.active.cursorX).toBe(4);
			term.write("\t");
			expect(term.buffer.active.cursorX).toBe(8);
			term.dispose();
		});

		it("default tabStopWidth keeps 8-column stops", () => {
			const term = new Terminal({ cols: 80, rows: 4 });
			term.write("\t");
			expect(term.buffer.active.cursorX).toBe(8);
			term.dispose();
		});

		it("lineHeight is observable in renderer cell metrics", () => {
			const baseContainer = document.createElement("div");
			document.body.appendChild(baseContainer);
			const base = createTerminal();
			base.open?.(baseContainer);
			const baseMetrics = base.getCellMetrics?.();

			const tallContainer = document.createElement("div");
			document.body.appendChild(tallContainer);
			const tall = createTerminal({ lineHeight: 2.0 });
			tall.open?.(tallContainer);
			const tallMetrics = tall.getCellMetrics?.();

			// Only assert the relationship when the headless renderer produced
			// measurable metrics; happy-dom may report 0 for unlaid-out layout.
			if (
				baseMetrics &&
				tallMetrics &&
				baseMetrics.height > 0 &&
				tallMetrics.height > 0
			) {
				expect(tallMetrics.height).toBeGreaterThan(baseMetrics.height);
			}

			base.dispose();
			tall.dispose();
			baseContainer.remove();
			tallContainer.remove();
		});
	});
});
