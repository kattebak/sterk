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
	// Opt out of the bundled-font default so the existing visual baselines
	// (themes, scroll, alt-screen, etc.) remain pinned to the platform's
	// generic `monospace` glyphs they were captured against. The
	// font-rendering scenario explicitly switches in via `setFont(id)`.
	font: "",
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

/**
 * Swap the active terminal font and wait for the woff2 asset to finish
 * loading before resolving. We block on `document.fonts.load(...)` so the
 * Playwright screenshot captures glyphs rendered with the requested
 * typeface — not the `monospace` fallback that Ace paints during the
 * font-load handshake. Without this wait, every baseline would look
 * identical because the swap-in would happen after the screenshot.
 */
async function setFont(fontId) {
	term.setFont(fontId);
	const family = term.options?.fontFamily;
	if (family && document.fonts?.load) {
		// Use the actual font size for the load probe so the browser picks
		// the right face variant.
		const size = term.options?.fontSize ?? 14;
		try {
			await document.fonts.load(`${size}px ${family}`);
		} catch {
			// best-effort; the load() promise rejects if the URL 404s,
			// which is itself a meaningful test failure visible in the
			// screenshot.
		}
	}
	if (typeof term.refresh === "function") {
		await term.refresh();
	}
	await nextFrame();
}

/**
 * Read the ACTUAL rendered Ace DOM and return, per visible `.ace_line` in
 * document order: the concatenated textContent and the list of styled spans
 * `{ text, className }`. This is what the user actually sees on screen — the
 * counterpart to `dumpState()` (which reads the proven-correct buffer).
 *
 * Defensive: returns an empty list if the text layer hasn't mounted yet.
 *
 * Ace renders each visible row as a `.ace_line` element inside
 * `.ace_text-layer`. A run of cells with identical attributes is one child
 * span whose className is `ace_<seg>` (joined by spaces for each `.`-segment
 * of the token type). Default (unstyled) runs are plain text nodes with no
 * wrapping span — those carry an empty className in the dump.
 */
function dumpDom() {
	const layer = container.querySelector(".ace_text-layer");
	if (!layer) return { lines: [] };
	const lineEls = Array.from(layer.querySelectorAll(".ace_line"));
	const lines = lineEls.map((lineEl) => {
		const spans = [];
		for (const node of Array.from(lineEl.childNodes)) {
			if (node.nodeType === Node.TEXT_NODE) {
				// Unstyled run (default attrs) — no wrapping span.
				const text = node.textContent ?? "";
				if (text.length > 0) spans.push({ text, className: "" });
			} else if (node.nodeType === Node.ELEMENT_NODE) {
				const el = /** @type {Element} */ (node);
				spans.push({
					text: el.textContent ?? "",
					className: el.getAttribute("class") ?? "",
				});
			}
		}
		return {
			text: lineEl.textContent ?? "",
			spans,
		};
	});
	return { lines };
}

/**
 * Write an array of frames sequentially, each through the same
 * write+refresh+nextFrame path as `feedRaw`, so in-place animations can be
 * driven to a known final state deterministically. Resolves after the last
 * frame's paint commits.
 */
async function feedFrames(frames) {
	for (const f of frames) {
		await feedRaw(f);
	}
}

function dumpState() {
	const buffer = term.buffer.active;
	const lines = [];
	const linesRaw = [];
	for (let y = 0; y < buffer.length; y++) {
		const line = buffer.getLine(y);
		if (!line) continue;
		// `lines` keeps the historical fully-trimmed form (existing specs
		// depend on it). `linesRaw` is the UNTRIMMED line text — needed for
		// DOM/buffer parity, where the DOM keeps leading spaces but
		// translateToString(true) strips them.
		lines.push(line.translateToString(true));
		linesRaw.push(line.translateToString(false));
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
		linesRaw,
	};
}

async function reset() {
	term.dispose();
	container.innerHTML = "";
	term = createTerminal({ ...DEFAULT_OPTIONS });
	term.open(container);
	await nextFrame();
}

/**
 * Returns the computed `font-family` of the first Ace text layer cell —
 * i.e. the `font-family` the renderer would draw a glyph with right now.
 *
 * Used by the font-coverage assertion test to confirm that after
 * `setFont(id)` the rendered cells actually inherit the requested family
 * (e.g. `'JetBrains Mono', monospace`) and have NOT silently fallen back
 * to the bare `monospace` system fallback because the woff2 failed to
 * load or the @font-face never resolved.
 *
 * Pixel-diff thresholds can mask a font substitution at small sizes
 * (system monospace and JetBrains Mono look ALMOST identical for plain
 * ASCII); this DOM probe is the assertion that catches the gap. Same
 * pattern as today's color/bold regression — the screenshot looked fine
 * but the DOM said otherwise.
 */
function probeRenderedFontFamily() {
	const layer = container.querySelector(".ace_text-layer .ace_line");
	if (!layer) return null;
	return globalThis.getComputedStyle(layer).fontFamily;
}

/**
 * Probe `document.fonts.check()` for the requested code point under the
 * active terminal family. Returns `true` only if a loaded face under
 * that family claims the glyph (primary OR the symbol-fallback face
 * sterk injects alongside). When this returns `true` for box-drawing
 * AND a dingbat that the primary woff2 demonstrably lacks (e.g. ✱
 * U+2731), we have proven that the symbol-fallback unicode-range face
 * is wired up correctly.
 *
 * `document.fonts.check(font, text)` is the spec-defined way to ask
 * "would the font system serve this string from a loaded face?". It
 * returns `false` if any code point in `text` would fall through to the
 * generic `monospace` system font — which is the exact failure mode
 * PR #31's latin-only subsets exhibited for box-drawing characters.
 */
function probeFontHasGlyph(text) {
	const family = term.options?.fontFamily;
	if (!family || !globalThis.document?.fonts?.check) return false;
	const size = term.options?.fontSize ?? 14;
	return globalThis.document.fonts.check(`${size}px ${family}`, text);
}

/**
 * Returns the offset width of the n-th character cell on the row that
 * contains `marker`. We render the payload such that each row begins
 * with a 3-char ASCII marker so the spec can locate the right line
 * without depending on Ace's internal coordinates.
 *
 * Used as a secondary signal: if a glyph fell back to system monospace
 * (different x-advance), the cell offsetWidth differs from the ASCII
 * cells around it. Combined with `probeFontHasGlyph` this lets the
 * spec catch fallback even when getComputedStyle reports the right
 * family.
 */
function probeRowCellWidths(marker) {
	const layer = container.querySelector(".ace_text-layer");
	if (!layer) return null;
	const lines = Array.from(layer.querySelectorAll(".ace_line"));
	const row = lines.find((el) => (el.textContent ?? "").startsWith(marker));
	if (!row) return null;
	const rect = row.getBoundingClientRect();
	const chars = (row.textContent ?? "").length;
	if (chars === 0) return null;
	return { width: rect.width, chars, perChar: rect.width / chars };
}

/**
 * Shrink the host container by `pxFromBottom` pixels (sets its CSS
 * `height` to `100vh - pxFromBottom`) and then SYNCHRONOUSLY call
 * `getViewportCellCount()` followed by `resize(cols, rows)` using the
 * result. Returns the new grid the terminal was resized to.
 *
 * This reproduces the mobux Pixel-7 "bottom-cut-off" scenario where a
 * flex sibling (the mobile input bar) appears, shrinks the terminal's
 * box, fires a synchronous resize event, and the consumer must
 * immediately answer "how many rows fit now?". Without the
 * `editor.resize(true)` inside `getViewportCellCount()`, that question
 * is answered against the stale pre-shrink `$size` and the bottom rows
 * end up off-screen.
 *
 * The test that drives this method captures the post-call screenshot:
 * if the API is correct, the LAST visible row in the buffer is the
 * last row that actually fits, with no overflow below the scroller.
 */
function shrinkAndResyncGrid(pxFromBottom) {
	container.style.height = `calc(100vh - ${pxFromBottom}px)`;
	// NOTE: deliberately no `await nextFrame()` here — the whole point is
	// to call `getViewportCellCount()` SYNCHRONOUSLY after the CSS change
	// so we exercise the timing path. happy-dom's ResizeObserver hasn't
	// fired yet either way.
	const grid = term.getViewportCellCount?.();
	if (grid) {
		term.resize(grid.cols, grid.rows);
	}
	return Promise.resolve(grid ?? null);
}

window.__sterkTest = {
	feedRaw,
	setSize,
	clear,
	setTheme,
	setFont,
	dumpState,
	dumpDom,
	feedFrames,
	reset,
	feedBurst,
	scrollToRow,
	shrinkAndResyncGrid,
	probeRenderedFontFamily,
	probeFontHasGlyph,
	probeRowCellWidths,
	/** Resolves once the harness is ready (terminal mounted + first frame). */
	ready: nextFrame(),
};
