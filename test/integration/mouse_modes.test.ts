/**
 * DEC mouse-mode wiring — Phase A1 contract.
 *
 * Aceterm (the bundle sterk replaced in mobux) shipped a full xterm mouse
 * protocol, so tmux/shell mouse-enable Just Worked. Sterk has the wire
 * encoders in `MouseHandler`, but until this PR the `Terminal.handleDec
 * PrivateMode` switch only routed the 1047/1048/1049 alt-screen escapes —
 * 1000/1002/1003/1006 were silently dropped, so tmux's mouse-enable was a
 * no-op on the real device.
 *
 * This test feeds the DEC private-mode escapes through the public `write()`
 * API (so the wire-up is exercised end-to-end via the VT parser), then
 * synthesises a `mousedown` on the editor element and asserts the
 * resulting SGR 1006 sequence on the terminal's `onData` callback. The
 * reset path (`\x1b[?1000l`) is then asserted to disable emission.
 *
 * The cell-coordinate math is taken out of the equation by stubbing the
 * MouseEvent's `clientX/Y` and the editor element's `getBoundingClientRect`
 * to a known origin, plus monkey-patching the Ace renderer's
 * `getCellMetrics()` (happy-dom does not measure font metrics, so the
 * underlying Ace value is 0). This isolates the test to the wiring
 * contract — encoder correctness is covered by the unit suite.
 *
 * Plan reference: https://github.com/kattebak/sterk/issues/21 (row 10).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";
import type { Terminal } from "../../src/types.js";

interface RendererWithMetrics {
	getCellMetrics: () => { width: number; height: number } | null;
	getElement?: () => HTMLElement;
}

/**
 * Replace the renderer's `getCellMetrics` with a fixed-value stub so the
 * MouseHandler resolves cell coordinates deterministically under
 * happy-dom (which does not measure font metrics natively, leaving Ace
 * with charWidth/lineHeight = 0).
 */
function stubCellMetrics(term: Terminal, width: number, height: number): void {
	const renderer = term.renderer as RendererWithMetrics | undefined;
	if (!renderer) throw new Error("terminal has no renderer (open not called)");
	renderer.getCellMetrics = () => ({ width, height });
}

/**
 * Locate the DOM element that MouseHandler attached its listeners to.
 * `term.open()` wires MouseHandler to `aceRenderer.getElement()`.
 */
function getEditorElement(term: Terminal): HTMLElement {
	const renderer = term.renderer as RendererWithMetrics | undefined;
	const el = renderer?.getElement?.();
	if (!el) throw new Error("no editor element (open not called)");
	return el;
}

/**
 * Pin `getBoundingClientRect` to the origin so `event.clientX/Y` maps
 * directly to cell coordinates via the stubbed metrics.
 */
function pinClientRect(el: HTMLElement): void {
	const rect = {
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		right: 1000,
		bottom: 1000,
		width: 1000,
		height: 1000,
		toJSON: () => ({}),
	} as DOMRect;
	el.getBoundingClientRect = () => rect;
}

describe("DEC mouse modes — Terminal.handleDecPrivateMode (Phase A1)", () => {
	let container: HTMLElement;
	let term: Terminal;
	let dataLog: string[];

	beforeEach(() => {
		container = document.createElement("div");
		container.style.width = "800px";
		container.style.height = "600px";
		document.body.appendChild(container);

		term = createTerminal({ cols: 80, rows: 24 });
		term.open?.(container);

		// Provide deterministic cell geometry (10×20 px cells, origin (0,0)).
		stubCellMetrics(term, 10, 20);
		pinClientRect(getEditorElement(term));

		dataLog = [];
		term.onData((data) => {
			dataLog.push(data);
		});
	});

	afterEach(() => {
		term.dispose();
		container.remove();
	});

	it("emits SGR 1006 mousedown after `?1000h?1006h`", () => {
		// tmux's typical mouse-enable sequence: VT200 tracking + SGR encoding.
		term.write("\x1b[?1000h\x1b[?1006h");

		// Synthesize a left-button press at cell (col=5, row=3).
		// clientX = col * cellWidth + half = 5 * 10 + 5 = 55 → floor → col 5
		// clientY = row * cellHeight + half = 3 * 20 + 10 = 70 → floor → row 3
		const el = getEditorElement(term);
		const ev = new MouseEvent("mousedown", {
			clientX: 55,
			clientY: 70,
			button: 0,
			bubbles: true,
		});
		el.dispatchEvent(ev);

		// SGR 1006 format: CSI < Cb ; Cx ; Cy M
		//   Cb = button + modifiers; left = 0, no modifiers → "0"
		//   Cx = col + 1 = 6, Cy = row + 1 = 4
		//   trailing "M" → press
		expect(dataLog).toEqual(["\x1b[<0;6;4M"]);
	});

	it("disables emission after `?1000l` reset", () => {
		term.write("\x1b[?1000h\x1b[?1006h");

		const el = getEditorElement(term);
		el.dispatchEvent(
			new MouseEvent("mousedown", {
				clientX: 55,
				clientY: 70,
				button: 0,
				bubbles: true,
			}),
		);
		expect(dataLog).toEqual(["\x1b[<0;6;4M"]);
		dataLog.length = 0;

		// Disable tracking. After this the mouse handler should drop events
		// silently — no onData callback fires.
		term.write("\x1b[?1000l");

		el.dispatchEvent(
			new MouseEvent("mousedown", {
				clientX: 55,
				clientY: 70,
				button: 0,
				bubbles: true,
			}),
		);
		expect(dataLog).toEqual([]);
	});
});
