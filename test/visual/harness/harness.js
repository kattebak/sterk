/**
 * Sterk visual-regression harness.
 *
 * Loads sterk from the built dist/ output (so we test the shipped artifact,
 * not src) and exposes a stable `window.__sterkTest` driver API for
 * Playwright specs. The cold state is deterministic: fixed cols/rows, fixed
 * font, empty buffer, no scrollback content.
 *
 * Vite (the dev/preview server used by Playwright's webServer) resolves the
 * `ace-builds` bare specifier inside sterk's dist for the browser.
 */
import { createTerminal } from "../../../dist/index.js";

const DEFAULT_THEME = {
	foreground: "#d4d4d4",
	background: "#1e1e1e",
	palette: [
		"#000000",
		"#cd3131",
		"#0dbc79",
		"#e5e510",
		"#2472c8",
		"#bc3fbc",
		"#11a8cd",
		"#e5e5e5",
		"#666666",
		"#f14c4c",
		"#23d18b",
		"#f5f543",
		"#3b8eea",
		"#d670d6",
		"#29b8db",
		"#ffffff",
	],
};

const DEFAULT_OPTIONS = {
	cols: 80,
	rows: 24,
	scrollback: 1000,
	fontFamily: "monospace",
	fontSize: 14,
	theme: DEFAULT_THEME,
};

const container = document.getElementById("terminal");

let term = createTerminal({ ...DEFAULT_OPTIONS });
term.open(container);

/**
 * Wait until the next animation frame so that scheduled sterk repaints
 * have committed to the DOM. Used by the driver after every operation
 * that mutates buffer state so screenshots capture the post-paint result.
 */
function nextFrame() {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

function feedRaw(data) {
	return new Promise((resolve) => {
		term.write(data, async () => {
			if (typeof term.refresh === "function") {
				await term.refresh();
			}
			await nextFrame();
			resolve();
		});
	});
}

function setSize(cols, rows) {
	term.resize(cols, rows);
	return nextFrame();
}

function clear() {
	term.clear();
	return nextFrame();
}

/**
 * Emit N synthetic lines back-to-back in a single `term.write()` call so
 * the parser/renderer must coalesce them onto one rAF tick. Used by the
 * "after-write-burst" scenario to assert the rAF coalescer + refresh()
 * leave the document in a clean steady state (no zombie rows, no torn
 * paints).
 */
function feedBurst(n, prefix) {
	const tag = typeof prefix === "string" ? prefix : "line";
	const lines = [];
	for (let i = 0; i < n; i++) {
		lines.push(`${tag} ${i.toString().padStart(4, "0")}`);
	}
	return feedRaw(`${lines.join("\r\n")}\r\n`);
}

/**
 * Scroll the viewport to a specific absolute row index, relative to the
 * buffer's top (row 0 is the oldest scrollback row). Used by the
 * scrollback scenario to pin the viewport at a known offset before
 * screenshotting. Returns once the renderer has committed the scroll.
 */
async function scrollToRow(absoluteY) {
	const buffer = term.buffer.active;
	// scrollLines is relative to current viewportY. Compute the delta to
	// land on the requested absolute row.
	const delta = absoluteY - buffer.viewportY;
	term.scrollLines(delta);
	if (typeof term.refresh === "function") {
		await term.refresh();
	}
	await nextFrame();
}

async function setTheme(themeOrId) {
	// B10/B11: string ids resolve through the built-in registry via the
	// `Terminal.setTheme(id)` API. An object payload is treated as a raw
	// theme override (legacy path used by harness consumers).
	if (typeof themeOrId === "string") {
		term.setTheme(themeOrId);
	} else {
		term.options.theme = themeOrId;
	}
	if (typeof term.refresh === "function") {
		await term.refresh();
	}
	await nextFrame();
}

function dumpState() {
	const buffer = term.buffer.active;
	const lines = [];
	for (let y = 0; y < buffer.length; y++) {
		const line = buffer.getLine(y);
		if (!line) continue;
		lines.push(line.translateToString(true));
	}
	return {
		cols: term.cols,
		rows: term.rows,
		cursorX: buffer.cursorX,
		cursorY: buffer.cursorY,
		baseY: buffer.baseY,
		viewportY: buffer.viewportY,
		length: buffer.length,
		lines,
	};
}

async function reset() {
	term.dispose();
	container.innerHTML = "";
	term = createTerminal({ ...DEFAULT_OPTIONS });
	term.open(container);
	await nextFrame();
}

window.__sterkTest = {
	feedRaw,
	setSize,
	clear,
	setTheme,
	dumpState,
	reset,
	feedBurst,
	scrollToRow,
	/** Resolves once the harness is ready (terminal mounted + first frame). */
	ready: nextFrame(),
};
