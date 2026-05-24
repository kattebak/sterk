import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";
import type { Terminal } from "../../src/types.js";

describe("renderer viewport scroll pinning", () => {
	let container: HTMLElement;
	let term: Terminal | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		// Give the container a concrete pixel size; without this Ace
		// can refuse to measure and lineHeight stays 0 in jsdom.
		container.style.width = "800px";
		container.style.height = "400px";
		document.body.appendChild(container);
	});

	afterEach(() => {
		if (term) {
			term.dispose();
			term = null;
		}
		if (container.parentNode) container.parentNode.removeChild(container);
	});

	it("pins viewportY to the live screen as the buffer grows past rows", () => {
		term = createTerminal({ cols: 40, rows: 5 });
		term.open?.(container);

		// Write past the active screen height to force the buffer to
		// retain scrollback. viewportY should auto-pin to the bottom of
		// the buffer (= lines.length - rows).
		for (let i = 0; i < 20; i++) {
			term.write(`line ${i}\r\n`);
		}

		return new Promise<void>((resolve) => {
			requestAnimationFrame(() => {
				requestAnimationFrame(() => {
					const t = term as unknown as {
						buffer: { active: { length: number; viewportY: number } };
						rows: number;
					};
					const { length, viewportY } = t.buffer.active;

					// Buffer must have grown past one screen of content.
					expect(length).toBeGreaterThan(t.rows);
					// Regression: previously this stayed pinned to 1 (or to
					// baseY=0) as soon as the buffer exceeded `rows`,
					// because the auto-scroll-on-insert check compared
					// viewportY to baseY (which only advances when the
					// scrollback ring is full). The renderer then showed
					// old scrollback at the top and clipped the active
					// screen below the visible area. After the fix
					// viewportY tracks the bottom of the buffer so the
					// renderer (which scrolls Ace to viewportY*lineHeight)
					// keeps the live screen visible.
					expect(viewportY).toBe(length - t.rows);
					expect(viewportY).toBeGreaterThan(0);
					resolve();
				});
			});
		});
	});
});
