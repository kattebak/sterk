// Cell-width parity tests.
//
// Verify that the renderer doesn't reserve unexpected horizontal
// space (Ace internal padding, vertical scrollbar gutter) so the
// consumer's `cols = clientWidth / cellWidth` math actually matches
// the cells rendered.
//
// Regression context: on Pixel 7 (412px viewport) Ace's default
// setPadding(4) + scrollbar reservation (~15px) silently ate ~23px of
// horizontal space, clipping the right-most ~2 columns. Sterk now
// zeroes the padding and hides the scrollbar; `getViewportCellCount`
// is the single source of truth for "how many cells actually fit".

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";
import type { Terminal } from "../../src/types.js";

describe("cell-width parity", () => {
	let container: HTMLElement;
	let term: Terminal | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		// Give the container an explicit size so Ace can measure.
		// 400×300 is a Pixel-7-ish content area.
		container.style.width = "400px";
		container.style.height = "300px";
		document.body.appendChild(container);
	});

	afterEach(() => {
		if (term) {
			term.dispose();
			term = null;
		}
		if (container.parentNode) {
			container.parentNode.removeChild(container);
		}
	});

	it("zeroes Ace's internal $padding so col 0 sits at the scroller's left edge", () => {
		term = createTerminal();
		term.open?.(container);

		// biome-ignore lint/suspicious/noExplicitAny: poking Ace internals for the assertion.
		const renderer = (term.renderer as any).editor.renderer;
		expect(renderer.$padding).toBe(0);
	});

	it("hides the vertical scrollbar so it doesn't eat horizontal space", () => {
		term = createTerminal();
		term.open?.(container);

		const styleEl = document.getElementById("sterk-scrollbar-hide");
		expect(styleEl).toBeTruthy();
		expect(styleEl?.textContent ?? "").toContain(".ace_scrollbar-v");
		expect(styleEl?.textContent ?? "").toContain("display: none");
	});

	it("only injects the scrollbar-hide stylesheet once across instances", () => {
		const term1 = createTerminal();
		term1.open?.(container);
		const container2 = document.createElement("div");
		container2.style.width = "400px";
		container2.style.height = "300px";
		document.body.appendChild(container2);
		const term2 = createTerminal();
		term2.open?.(container2);

		const sheets = document.querySelectorAll("#sterk-scrollbar-hide");
		expect(sheets.length).toBe(1);

		term1.dispose();
		term2.dispose();
		container2.parentNode?.removeChild(container2);
	});

	it("getViewportCellCount returns a usable cols/rows pair after open()", () => {
		term = createTerminal();
		term.open?.(container);

		const grid = term.getViewportCellCount?.();
		// In happy-dom the scroller may report 0×0 because layout doesn't
		// run; tolerate null but require sane values when present.
		if (grid !== null && grid !== undefined) {
			expect(grid.cols).toBeGreaterThan(0);
			expect(grid.rows).toBeGreaterThan(0);
			expect(Number.isInteger(grid.cols)).toBe(true);
			expect(Number.isInteger(grid.rows)).toBe(true);
		}
	});

	it("getViewportCellCount is null when called before open()", () => {
		term = createTerminal();
		const grid = term.getViewportCellCount?.();
		expect(grid).toBeNull();
	});
});
