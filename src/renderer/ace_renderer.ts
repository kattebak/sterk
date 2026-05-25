/**
 * Ace renderer bridge — maps ScrollBuffer to Ace EditSession
 *
 * DOM structure:
 * ```html
 * <div class="sterk">           <!-- container -->
 *   <div class="sterk-viewport"> <!-- Ace editor container -->
 *     <div class="ace_editor">   <!-- Ace's own structure -->
 *       ...
 *     </div>
 *   </div>
 * </div>
 * ```
 *
 * Responsibilities:
 * - Incremental buffer → Ace document updates
 * - Cursor positioning
 * - Viewport scrolling
 * - Font size coordination
 * - Cell metrics calculation
 */

import type { Ace } from "ace-builds";
import ace from "ace-builds";
import type {
	BufferNamespaceImpl,
	ScrollBuffer,
} from "../buffer/scroll_buffer.js";
import type { Buffer } from "../types.js";
import { injectTruecolorCss } from "./theme.js";
import { buildCellClassName, VtMode } from "./vt_mode.js";

/**
 * Ace renderer implementation
 */
export class AceRenderer {
	private editor: Ace.Editor;
	private session: Ace.EditSession;
	private viewportDiv: HTMLElement;
	private wrapper: HTMLElement;
	/**
	 * Promise that resolves after the next coalesced rAF flush completes
	 * (buffer→document sync + cursor + scroll). Shared across all writes
	 * that land in the same tick. Becomes null again once the rAF fires.
	 *
	 * Acts as both the "is an update scheduled?" flag and the barrier that
	 * `refresh()` awaits before triggering Ace's repaint, so a forced
	 * redraw never lands on a half-synced document.
	 */
	private updatePromise: Promise<void> | null = null;
	private updateResolve: (() => void) | null = null;
	private disposed = false;
	/**
	 * Optional callback fired after a coalesced rAF flush commits a repaint,
	 * receiving the affected viewport row range. Wired by the Terminal to
	 * back `Terminal.onRender` (xterm.js parity). The range covers the live
	 * viewport rows (`0 .. rows-1`); sterk re-syncs the whole visible screen
	 * per flush, so a row-precise diff would be misleading.
	 */
	private onRenderCallback:
		| ((range: { start: number; end: number }) => void)
		| null = null;
	/**
	 * Per-row rendered-attribute signature from the LAST sync, indexed by row.
	 *
	 * `syncBufferToDocument()` only rewrites a document line when its TEXT
	 * changed — which re-tokenizes the row. But an attribute-only redraw (same
	 * glyphs, new SGR colour/dim — e.g. a pulsing busy indicator that redraws
	 * "Transfiguring…" each frame with a different colour) leaves the text
	 * identical, so without this we never re-tokenize and the DOM keeps the
	 * STALE span classes. We compare each row's attribute signature against the
	 * previous sync; if it changed but the text did not, we force a re-tokenize
	 * + repaint of just that row. The signature is derived from the SAME
	 * `buildCellClassName` the tokenizer uses, so it can't drift from what
	 * actually renders. Reset on resize / buffer switch (see those methods).
	 */
	private lineSignatures: string[] = [];
	private resizeObserver: ResizeObserver | null = null;
	private resizeFrameHandle: number | null = null;
	private lastObservedSize: { width: number; height: number } | null = null;

	/**
	 * Get the active buffer (normal or alternate).
	 * This getter ensures the renderer always reads from the current active buffer,
	 * not a fixed reference set at construction time.
	 */
	private get buffer(): ScrollBuffer {
		return this.bufferNamespace._getScrollBuffer();
	}

	constructor(
		private container: HTMLElement,
		private bufferNamespace: BufferNamespaceImpl,
		fontSize: number,
		fontFamily: string = "monospace",
	) {
		// Create wrapper with sterk class
		this.wrapper = document.createElement("div");
		this.wrapper.classList.add("sterk");
		container.appendChild(this.wrapper);

		// Create viewport inside wrapper
		this.viewportDiv = document.createElement("div");
		this.viewportDiv.classList.add("sterk-viewport");
		this.wrapper.appendChild(this.viewportDiv);

		// Create Ace editor
		this.editor = ace.edit(this.viewportDiv);
		this.session = this.editor.getSession();

		// Stop Ace's text layer from mangling zero-width joiners into "·".
		// Must run before the first paint so no row is rendered with the
		// stock (joiner-eating) $renderToken. Instance-scoped — see method.
		this.patchTextLayerJoinerRendering();

		// Configure editor
		this.editor.setOptions({
			fontSize,
			fontFamily,
			showPrintMargin: false,
			showGutter: false,
			highlightActiveLine: false,
			highlightGutterLine: false,
			displayIndentGuides: false,
		});

		// Drop Ace's default 4px content padding. Terminals deliver text
		// at exact cell coordinates (col 0 == first column); any non-zero
		// padding shifts the grid sideways and eats horizontal cells the
		// consumer thinks it has. The default `setPadding(4)` is meant
		// for code editors where readability beats parity.
		this.editor.renderer.setPadding(0);

		// Hide Ace's vertical scrollbar. The terminal has its own scroll
		// model (consumer wires gestures / keys to `scrollLines()`), and
		// the reserved scrollbar gutter (~15px on most browsers) is the
		// largest source of horizontal cell-fit drift on small screens.
		// Mobile consumers in particular expect the right-most cell to
		// sit at the container's right edge — leaving the scrollbar in
		// place clips characters or forces a `cols - N` fudge factor.
		this.injectScrollbarHideCss();

		// Set read-only (terminal is not an editor)
		this.editor.setReadOnly(true);

		// Disable Ace's built-in behaviors
		this.session.setUseWrapMode(false);
		this.session.setUseSoftTabs(false);

		// Set custom VT mode for SGR rendering
		const vtMode = new VtMode(this.bufferNamespace);
		this.session.setMode(vtMode.getMode());

		// Force editor to measure layout (critical when container is pre-sized)
		this.editor.resize(true);

		// Initialize with buffer content
		this.syncBufferToDocument();

		// Observe the host container so we re-measure Ace whenever its
		// content-box pixels change — independent of `window.resize`.
		//
		// Why: on Android Chrome the soft keyboard only mutates
		// `visualViewport.height`; `window` `resize` never fires. The host
		// element shrinks (via consumer flex layout / viewport units), but
		// Ace's `VirtualRenderer` caches `$size.height` and only invalidates
		// on `window.resize` or an explicit `editor.resize()`. Without this
		// observer Ace keeps painting into the pre-keyboard viewport box and
		// the bottom rows render behind the keyboard. See kattebak/sterk#14.
		this.installResizeObserver();
	}

	/**
	 * Instance-scoped monkeypatch of Ace's text-layer `$renderToken` so that a
	 * small set of zero-width JOINER code points survive rendering instead of
	 * being mangled into middle-dots ("·").
	 *
	 * Shadows: ace-builds 1.43.6,
	 *   node_modules/ace-builds/src-noconflict/ace.js
	 *   `Text.prototype.$renderToken` (~line 17492); its "control character"
	 *   regex group (~line 17494) and the matching branch (~line 17529).
	 *
	 * WHY: that branch UNCONDITIONALLY substitutes every code point in the
	 * control-character class with `self.SPACE_CHAR` ("\xb7", ·) inside a
	 * `ace_invisible ace_invisible_space ace_invalid` span. The class spans
	 * ` -‏`, `⁠`, `﻿`, … — which sweeps up legitimate
	 * width-0 joiners. For a terminal this corrupts real content: the ZWJ
	 * family emoji 👨‍👩‍👧‍👦 (U+1F468 200D 1F469 200D 1F467 200D 1F466) renders
	 * as 👨·👩·👧·👦. No public Ace setting gates this substitution.
	 *
	 * APPROACH — wrapper, not a regex/body copy. We pre-map the exempt joiners
	 * in `value` to a Private-Use-Area sentinel that the control-char regex
	 * does NOT match, call the ORIGINAL `$renderToken` (so Ace renders the
	 * sentinel as ordinary text inside the normal token span — NOT
	 * `ace_invalid`), then walk the DOM nodes Ace just appended to `parent`
	 * and restore the sentinel back to the real joiner in their textContent.
	 * Chosen over copying Ace's `$renderToken` body because that body
	 * references module-private helpers (`lang`, `isTextToken`, `nls`) and
	 * spans tab / space / CJK / fold logic — copying it is far more fragile
	 * across Ace upgrades. The wrapper depends only on the public method
	 * signature.
	 *
	 * EXEMPTION SET (narrowest safe — width-0 joiners carrying real text
	 * meaning; everything else stays mangled): U+200B ZWSP, U+200C ZWNJ,
	 * U+200D ZWJ, U+2060 WORD JOINER, U+FEFF ZWNBSP. Deliberately NOT exempt:
	 * C0/C1 controls, bidi overrides, line/para separators, en/em spaces, and
	 * LRM/RLM (U+200E/200F) — those still render as "·" so the narrowing is
	 * surgical.
	 *
	 * RE-VERIFY ON ACE UPGRADE — covered by
	 * test/visual/corpus-dom-parity.spec.ts (emoji-mixed parity + the
	 * over-exemption negative check).
	 *
	 * TODO(https://github.com/kattebak/sterk/issues/34): track upstreaming / removing this
	 * monkeypatch if Ace gains a setting to gate control-char substitution.
	 */
	private patchTextLayerJoinerRendering(): void {
		// biome-ignore lint/suspicious/noExplicitAny: Ace's $textLayer / $renderToken are internal, not in the public typings.
		const textLayer = (this.editor.renderer as any).$textLayer;
		if (!textLayer || typeof textLayer.$renderToken !== "function") return;

		// Exempt width-0 joiners.
		const EXEMPT = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]);
		// Private-Use-Area sentinel base. The regex's control-char class never
		// includes the PUA (U+E000–U+F8FF), so a sentinel there passes through
		// as ordinary text. We offset each exempt code point into a distinct
		// sentinel so restoration is unambiguous.
		const SENTINEL_BASE = 0xe000;
		const exemptList = Array.from(EXEMPT);
		const toSentinel = new Map<string, string>();
		const fromSentinel = new Map<string, string>();
		exemptList.forEach((cp, idx) => {
			const real = String.fromCodePoint(cp);
			const sentinel = String.fromCodePoint(SENTINEL_BASE + idx);
			toSentinel.set(real, sentinel);
			fromSentinel.set(sentinel, real);
		});
		// Single regex matching any exempt joiner / any sentinel.
		const exemptRe = new RegExp(
			`[${exemptList.map((cp) => `\\u${cp.toString(16).padStart(4, "0")}`).join("")}]`,
			"g",
		);
		const sentinelRe = new RegExp(
			`[${exemptList.map((_, idx) => `\\u${(SENTINEL_BASE + idx).toString(16).padStart(4, "0")}`).join("")}]`,
			"g",
		);

		const original = textLayer.$renderToken.bind(textLayer);

		// Restore sentinels → real joiners in every text node at/under `node`.
		const restore = (node: Node): void => {
			if (node.nodeType === Node.TEXT_NODE) {
				const text = node.textContent;
				if (text && sentinelRe.test(text)) {
					sentinelRe.lastIndex = 0;
					node.textContent = text.replace(
						sentinelRe,
						(ch) => fromSentinel.get(ch) ?? ch,
					);
				}
				sentinelRe.lastIndex = 0;
				return;
			}
			for (const child of Array.from(node.childNodes)) restore(child);
		};

		textLayer.$renderToken = (
			parent: Node,
			screenColumn: number,
			token: unknown,
			value: string,
		): number => {
			// Fast path: nothing to protect.
			exemptRe.lastIndex = 0;
			if (!exemptRe.test(value)) {
				return original(parent, screenColumn, token, value);
			}
			exemptRe.lastIndex = 0;
			const mapped = value.replace(exemptRe, (ch) => toSentinel.get(ch) ?? ch);
			// Track which nodes Ace appends so we only walk the new ones.
			const startIndex = parent.childNodes.length;
			const result = original(parent, screenColumn, token, mapped);
			for (let i = startIndex; i < parent.childNodes.length; i++) {
				const added = parent.childNodes[i];
				if (added) restore(added);
			}
			return result;
		};
	}

	/**
	 * Install a `ResizeObserver` on the host container so that any change in
	 * content-box dimensions triggers `editor.resize(true)` — forcing Ace to
	 * re-measure its cached `$size` before the next paint.
	 *
	 * Callbacks are coalesced via `requestAnimationFrame` so a burst of
	 * resize events (e.g. visualViewport scroll while the soft keyboard
	 * animates) does not thrash the renderer.
	 */
	private installResizeObserver(): void {
		// Guard for environments without ResizeObserver (e.g. older test
		// runtimes). The consumer can still call `resize()` manually.
		if (typeof ResizeObserver === "undefined") return;

		// Seed the cached size so the very first observer callback (which
		// fires synchronously on observe() in real browsers) is a no-op
		// when dimensions haven't actually changed.
		const initialRect = this.container.getBoundingClientRect();
		this.lastObservedSize = {
			width: initialRect.width,
			height: initialRect.height,
		};

		this.resizeObserver = new ResizeObserver((entries) => {
			// Always trust the latest entry. contentRect is the content-box
			// in CSS pixels — what Ace actually cares about for laying out
			// visible rows.
			const entry = entries[entries.length - 1];
			if (!entry) return;

			const { width, height } = entry.contentRect;

			// Skip if dimensions are identical to the last observed value
			// (some browsers fire spurious entries on layout reads).
			if (
				this.lastObservedSize &&
				this.lastObservedSize.width === width &&
				this.lastObservedSize.height === height
			) {
				return;
			}
			this.lastObservedSize = { width, height };

			// Coalesce: one rAF per burst. cancelAnimationFrame is a no-op
			// for stale handles, but we keep the guard for clarity.
			if (this.resizeFrameHandle !== null) return;

			const raf =
				typeof requestAnimationFrame === "function"
					? requestAnimationFrame
					: (cb: FrameRequestCallback): number => {
							// Fallback for environments without rAF.
							return setTimeout(
								() => cb(performance.now()),
								16,
							) as unknown as number;
						};

			this.resizeFrameHandle = raf(() => {
				this.resizeFrameHandle = null;
				// Force Ace to re-measure its cached $size before the next paint.
				this.editor.resize(true);
			});
		});

		this.resizeObserver.observe(this.container);
	}

	/**
	 * Get the Ace editor instance (for consumers needing direct access)
	 */
	getEditor(): Ace.Editor {
		return this.editor;
	}

	/**
	 * Get cell metrics (character width/height in pixels)
	 */
	getCellMetrics(): { width: number; height: number } | null {
		const renderer = this.editor.renderer;
		const lineHeight = renderer.lineHeight;
		const charWidth = renderer.characterWidth;

		if (lineHeight > 0 && charWidth > 0) {
			return { width: charWidth, height: lineHeight };
		}

		return null;
	}

	/**
	 * Compute how many terminal cells fit in the current scroller area.
	 *
	 * Reads Ace's already-measured scroller size (post-padding,
	 * post-scrollbar-reservation) plus the live cell metrics, so the
	 * answer is the *actual* grid the renderer can paint without
	 * clipping — not the container size divided by cell width.
	 *
	 * Returns `null` until the editor has measured itself at least once
	 * (e.g. before `open()` has run, or before the first rAF flush).
	 *
	 * Use this in preference to `clientWidth / cellWidth` math: it
	 * already accounts for Ace's internal padding (we zero it but a
	 * future change could re-introduce it) and any reserved scrollbar
	 * gutter, so the consumer's `cols` matches what is rendered.
	 *
	 * Sync semantics: this method calls `editor.resize(true)` before
	 * reading `$size` so the returned grid reflects the host container's
	 * CURRENT content-box, not whatever Ace measured at the last paint.
	 * Without this, a consumer that fires a synchronous `resize` event
	 * after a layout change (flex sibling shown/hidden, visualViewport
	 * shrink, etc.) would race the container `ResizeObserver` — the
	 * observer schedules its `editor.resize()` for the next rAF, so a
	 * synchronous `getViewportCellCount()` call right after the layout
	 * change reads the STALE pre-change `$size` and over-reports rows
	 * that no longer fit. The downstream effect is the bottom rows of
	 * the terminal getting clipped under whatever appeared (input bar,
	 * keyboard ribbon, status panel, etc.). Forcing the re-measurement
	 * here is the single source of truth: any caller that asks "how
	 * many cells fit RIGHT NOW" gets an answer consistent with the DOM
	 * at the call instant.
	 */
	getViewportCellCount(): { cols: number; rows: number } | null {
		// Force Ace to re-measure its cached `$size` against the host
		// container's current bounding box BEFORE we read scrollerWidth /
		// scrollerHeight (or even read cell metrics, since some Ace
		// versions defer character measurement until the first resize).
		// This makes the method self-consistent with the DOM at call
		// time, independent of whether the ResizeObserver callback has
		// run yet. The `true` argument bypasses Ace's "size unchanged"
		// short-circuit; when nothing actually changed this is a no-op
		// aside from a single measurement.
		this.editor.resize(true);

		// biome-ignore lint/suspicious/noExplicitAny: Ace's internal $size and $padding aren't in the public typings.
		const r = this.editor.renderer as any;
		const metrics = this.getCellMetrics();
		if (!metrics) return null;

		const size = r.$size as
			| { scrollerWidth?: number; scrollerHeight?: number }
			| undefined;
		const padding = typeof r.$padding === "number" ? r.$padding : 0;
		const scrollerWidth = size?.scrollerWidth ?? 0;
		const scrollerHeight = size?.scrollerHeight ?? 0;

		if (scrollerWidth <= 0 || scrollerHeight <= 0) return null;

		const usableWidth = Math.max(0, scrollerWidth - 2 * padding);
		const cols = Math.max(1, Math.floor(usableWidth / metrics.width));
		const rows = Math.max(1, Math.floor(scrollerHeight / metrics.height));
		return { cols, rows };
	}

	/**
	 * Inject the CSS that hides Ace's vertical scrollbar inside this
	 * renderer's wrapper. Scoped to `.sterk .ace_scrollbar-v` so it
	 * doesn't affect other Ace instances on the page (e.g. an editor
	 * embedded next to a terminal). Idempotent across instances.
	 */
	private injectScrollbarHideCss(): void {
		const id = "sterk-scrollbar-hide";
		if (typeof document === "undefined") return;
		if (document.getElementById(id)) return;
		const style = document.createElement("style");
		style.id = id;
		style.textContent = `
.sterk .ace_scrollbar-v { display: none !important; }
.sterk .ace_scrollbar-h { display: none !important; }
`.trim();
		document.head.appendChild(style);
	}

	/**
	 * Set font size
	 */
	setFontSize(size: number): void {
		this.editor.setFontSize(size);
	}

	/**
	 * Set font family. Pass a fully-formed CSS `font-family` value (the
	 * caller is responsible for the fallback chain, e.g.
	 * `"'JetBrains Mono', monospace"`). Ace re-measures character width on
	 * the next paint, so a follow-up `scheduleUpdate()` is enough to land
	 * the new metrics — no explicit `editor.resize()` needed because
	 * Ace's `setOption('fontFamily', ...)` triggers an internal
	 * `$measureSizes` recompute.
	 */
	setFontFamily(family: string): void {
		this.editor.setOption("fontFamily", family);
	}

	/**
	 * Get the DOM element for attaching input/mouse handlers
	 */
	getElement(): HTMLElement {
		return this.editor.container;
	}

	/**
	 * Focus the underlying Ace editor (moves keyboard focus to its hidden
	 * textarea). Passthrough for `Terminal.focus()`.
	 */
	focus(): void {
		this.editor.focus();
	}

	/**
	 * Blur the underlying Ace editor (removes keyboard focus from its
	 * hidden textarea). Passthrough for `Terminal.blur()`.
	 */
	blur(): void {
		this.editor.blur();
	}

	/**
	 * Handle buffer switch (normal ↔ alternate screen)
	 * Called when terminal switches between buffers
	 */
	/**
	 * Drop all per-row attribute signatures. Called when buffer content is
	 * reset wholesale (clear) so a signature from before the reset can never
	 * suppress a needed attribute-only re-render afterwards.
	 */
	resetLineSignatures(): void {
		this.lineSignatures = [];
	}

	onBufferSwitch(): void {
		// The active buffer (normal ↔ alternate) changed wholesale, so every
		// row's content AND attributes may differ. Clear the per-row attribute
		// signatures so a row index that happens to keep the same text across
		// the switch but carries different attrs is not suppressed.
		this.lineSignatures = [];
		// Force a full re-render
		this.scheduleUpdate();
	}

	/**
	 * Schedule a buffer → document sync.
	 *
	 * Uses `requestAnimationFrame` to coalesce a burst of `write()` calls
	 * into a single flush. The returned promise resolves once that flush
	 * has applied buffer state to the Ace document (cursor + scroll
	 * included). All callers in the same tick share the same promise.
	 *
	 * Promise-returning is additive — existing code that ignores the
	 * return value (most call sites) is unaffected. `refresh()` uses the
	 * promise to wait for an in-flight write burst before painting.
	 */
	scheduleUpdate(): Promise<void> {
		if (this.updatePromise) return this.updatePromise;

		this.updatePromise = new Promise<void>((resolve) => {
			this.updateResolve = resolve;
		});
		const promise = this.updatePromise;

		requestAnimationFrame(() => {
			const resolve = this.updateResolve;
			this.updatePromise = null;
			this.updateResolve = null;

			if (this.disposed) {
				resolve?.();
				return;
			}

			this.syncBufferToDocument();
			this.updateCursor();
			this.updateScroll();
			this.emitRender();
			resolve?.();
		});

		return promise;
	}

	/**
	 * Register the onRender callback (backs `Terminal.onRender`). Fired after
	 * each committed rAF flush with the repainted viewport row range.
	 */
	onRender(callback: (range: { start: number; end: number }) => void): void {
		this.onRenderCallback = callback;
	}

	/**
	 * Notify the onRender subscriber of a committed repaint. Sterk re-syncs
	 * the whole visible screen per flush, so the reported range spans the
	 * live viewport rows (`0 .. visibleRows-1`).
	 */
	private emitRender(): void {
		if (!this.onRenderCallback) return;
		// Derive the visible row count from Ace's ALREADY-measured cache —
		// never force a resize here (that would inflate resize-observer
		// coalescing counts and run on every flush). Fall back to the buffer
		// length when no measurement exists yet (pre-first-paint).
		const end = Math.max(0, this.visibleRowCount() - 1);
		this.onRenderCallback({ start: 0, end });
	}

	/**
	 * Best-effort visible row count from Ace's cached layout (no re-measure).
	 * Used by {@link emitRender}; falls back to the buffer length before the
	 * first paint has measured the scroller.
	 */
	private visibleRowCount(): number {
		// biome-ignore lint/suspicious/noExplicitAny: Ace's $size / lineHeight aren't in the public typings.
		const r = this.editor.renderer as any;
		const lineHeight = typeof r.lineHeight === "number" ? r.lineHeight : 0;
		const scrollerHeight =
			typeof r.$size?.scrollerHeight === "number" ? r.$size.scrollerHeight : 0;
		if (lineHeight > 0 && scrollerHeight > 0) {
			return Math.max(1, Math.floor(scrollerHeight / lineHeight));
		}
		return this.buffer.length;
	}

	/**
	 * Force Ace to re-paint every visible row from the current document.
	 *
	 * IMPORTANT: callers must only invoke this AFTER the buffer→document
	 * sync has completed (i.e. after the rAF flush). Calling it mid-burst
	 * paints a half-synced document and produces zombie rows. The public
	 * entry point that enforces that ordering is `Terminal.refresh()`.
	 */
	forceRepaint(): void {
		if (this.disposed) return;
		// Ace's VirtualRenderer.updateFull(force) re-paints every visible
		// row. We pass `true` to force a layer-rebuild even if Ace thinks
		// nothing changed (e.g. a theme swap or font change). Behind the
		// scenes Ace schedules the actual paint on its own internal
		// rAF — see updateFull → scheduleRender.
		this.editor.renderer.updateFull(true);
	}

	/**
	 * Sync buffer content to Ace document (incremental)
	 */
	private syncBufferToDocument(): void {
		const document = this.session.getDocument();
		const buffer = this.buffer;

		// Get current document line count
		const docLines = document.getLength();
		const bufferLines = buffer.length;

		// Pre-inject truecolor CSS for all cells in the buffer
		this.injectTruecolorStyles();

		// Ensure document has correct number of lines
		if (docLines < bufferLines) {
			// Add missing lines
			const linesToAdd: string[] = [];
			for (let i = docLines; i < bufferLines; i++) {
				linesToAdd.push("");
			}
			if (linesToAdd.length > 0) {
				document.insert(
					{ row: docLines, column: 0 },
					`${linesToAdd.join("\n")}\n`,
				);
			}
		} else if (docLines > bufferLines) {
			// Remove extra lines
			document.removeLines(bufferLines, docLines - 1);
		}

		// Drop signatures for rows that no longer exist so a future row reusing
		// that index can't be suppressed by a stale entry.
		if (this.lineSignatures.length > bufferLines) {
			this.lineSignatures.length = bufferLines;
		}

		// Update each line.
		//
		// Two independent triggers for re-rendering a row:
		//   1. TEXT changed  → removeInLine/insertInLine. The document delta
		//      fires Ace's change event, which re-tokenizes the row. (existing)
		//   2. ATTRIBUTES changed but text did not (attribute-only redraw, e.g.
		//      a pulsing busy indicator recolouring identical glyphs). The text
		//      diff above is a no-op, so we must explicitly re-tokenize +
		//      repaint the row, else the DOM keeps stale span classes.
		// A static screen changes neither, so this loop performs ZERO Ace
		// mutations frame-over-frame — the incremental design is preserved.
		for (let i = 0; i < bufferLines; i++) {
			const line = buffer.getLine(i);
			if (!line) continue;

			const text = this.renderLine(line);
			const currentText = document.getLine(i) ?? "";
			const signature = this.computeLineSignature(i);
			const prevSignature = this.lineSignatures[i];

			if (text !== currentText) {
				// Text changed — the document round-trip re-tokenizes the row.
				document.removeInLine(i, 0, currentText.length);
				document.insertInLine({ row: i, column: 0 }, text);
			} else if (signature !== prevSignature) {
				// Attribute-only change: text is identical so the document was
				// not touched and Ace would otherwise keep the stale tokens.
				// Force a re-tokenize + repaint of just this row.
				this.retokenizeRow(i);
			}

			this.lineSignatures[i] = signature;
		}
	}

	/**
	 * Compute a compact rendered-attribute signature for buffer row `i` by
	 * walking its cells and joining each cell's `buildCellClassName` — the SAME
	 * class string the tokenizer emits. Two syncs whose rows render identically
	 * produce identical signatures; any change to a rendered class (fg/bg mode
	 * or value, bold/italic/underline/dim, inverse) changes the signature by
	 * construction, so it can never miss a class change the DOM would show.
	 */
	private computeLineSignature(row: number): string {
		const buffer = this.buffer;
		const line = buffer.getLine(row);
		if (!line) return "";
		const cols = buffer.cols;
		const parts: string[] = [];
		for (let col = 0; col < cols; col++) {
			// "|" separates cells so e.g. a class shift between adjacent cells
			// can't alias with the same classes packed differently.
			parts.push(buildCellClassName(line.getCell(col)));
		}
		return parts.join("|");
	}

	/**
	 * Force Ace to re-tokenize and repaint a single row whose rendered
	 * attributes changed without its text changing.
	 *
	 * Ace caches tokens per row in its `BackgroundTokenizer`; a no-op document
	 * edit (same text) does not reliably bust that cache. We invalidate the
	 * tokenizer's cached line directly and ask the renderer to repaint just
	 * that row (`updateLines(row, row)`), keeping the work O(changed rows).
	 */
	private retokenizeRow(row: number): void {
		// biome-ignore lint/suspicious/noExplicitAny: bgTokenizer is an internal Ace field not in the public typings.
		const session = this.session as any;
		const bgTokenizer = session.bgTokenizer;
		if (bgTokenizer) {
			// Drop the cached tokens for this row so the next paint re-runs the
			// VT tokenizer (which reads the live buffer attrs).
			if (Array.isArray(bgTokenizer.lines)) {
				bgTokenizer.lines[row] = null;
			}
			if (Array.isArray(bgTokenizer.states)) {
				bgTokenizer.states[row] = null;
			}
			// Some Ace versions expose an explicit start() to re-run tokenizing
			// from a given row; call it defensively if present.
			if (typeof bgTokenizer.start === "function") {
				bgTokenizer.start(row);
			}
		}
		this.editor.renderer.updateLines(row, row);
	}

	/**
	 * Render a buffer line to text (SGR styling is handled by VtMode tokenizer)
	 */
	private renderLine(
		line: Buffer extends { getLine(y: number): infer L } ? L : never,
	): string {
		if (!line) return "";
		return line.translateToString(false);
	}

	/**
	 * Pre-inject CSS for all truecolor colors in the buffer.
	 *
	 * Walks the cell grid (not the line-text character stream), since
	 * wide-char placeholders contribute zero characters to the joined
	 * line text but still hold an entry in the cells array (see
	 * `scroll_buffer.ts` cell encoding for the wcwidth contract).
	 * Iterating `cols` instead of `text.length` keeps the scan
	 * deterministic across CJK / emoji content.
	 */
	private injectTruecolorStyles(): void {
		const buffer = this.buffer;
		const cols = buffer.cols;
		for (let row = 0; row < buffer.length; row++) {
			const line = buffer.getLine(row);
			if (!line) continue;

			for (let col = 0; col < cols; col++) {
				const cell = line.getCell(col);

				// Check for truecolor foreground
				if (cell.isFgRGB()) {
					const rgb = cell.getFgColor();
					injectTruecolorCss(rgb, "fg");
				}

				// Check for truecolor background
				if (cell.isBgRGB()) {
					const rgb = cell.getBgColor();
					injectTruecolorCss(rgb, "bg");
				}
			}
		}
	}

	/**
	 * Update cursor position
	 */
	private updateCursor(): void {
		const buffer = this.buffer;
		const cursorY = buffer.baseY + buffer.cursorY;
		const cursorX = buffer.cursorX;

		// Clamp to valid range
		const row = Math.max(0, Math.min(cursorY, buffer.length - 1));
		const col = Math.max(0, cursorX);

		this.editor.moveCursorTo(row, col);
	}

	/**
	 * Update viewport scroll position.
	 *
	 * We use Ace's session.setScrollTop(pixels) directly rather than
	 * editor.scrollToLine(row, ...). scrollToLine is a no-op when the
	 * target row is already inside Ace's visible range — which is the
	 * case for terminal use, where the document is only marginally
	 * larger than the viewport (active rows + a few lines of
	 * scrollback). The result was that as soon as the buffer grew past
	 * `rows` lines, the active screen (which sits at the bottom of the
	 * document) was clipped below the visible area while the older
	 * scrollback continued to occupy the top.
	 *
	 * Pixel-anchoring scrollTop to viewportY * lineHeight forces the
	 * top of the visible area to align with the top of the active
	 * screen on every update, which is exactly the terminal semantic.
	 */
	private updateScroll(): void {
		const viewportY = this.buffer.viewportY;
		const lineHeight = this.editor.renderer.lineHeight;
		if (lineHeight > 0) {
			this.session.setScrollTop(viewportY * lineHeight);
		} else {
			// Pre-measure fallback (e.g. before first paint). scrollToLine
			// is harmless here because the document and viewport are both
			// effectively zero-height.
			this.editor.scrollToLine(viewportY, false, false, () => {});
		}
	}

	/**
	 * Scroll viewport by lines
	 */
	scrollLines(lines: number): void {
		this.buffer.scrollViewport(lines);
		this.updateScroll();
	}

	/**
	 * Scroll to bottom
	 */
	scrollToBottom(): void {
		this.buffer.scrollToBottom();
		this.updateScroll();
	}

	/**
	 * Resize the terminal
	 */
	resize(cols: number, rows: number): void {
		this.buffer.resize(cols, rows);
		// Column count changed → per-cell layout differs, so old per-row
		// signatures are no longer comparable. Clear them; the next sync
		// recomputes against the new geometry.
		this.lineSignatures = [];
		this.scheduleUpdate();
	}

	/**
	 * Clean up
	 */
	dispose(): void {
		this.disposed = true;

		// Tear down the resize observer first so no callback can race the
		// editor destruction.
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (
			this.resizeFrameHandle !== null &&
			typeof cancelAnimationFrame === "function"
		) {
			cancelAnimationFrame(this.resizeFrameHandle);
			this.resizeFrameHandle = null;
		}
		this.lastObservedSize = null;

		// Resolve any pending update promise so awaiters (e.g. a
		// `refresh()` blocked on the next rAF flush) don't dangle.
		const pending = this.updateResolve;
		this.updateResolve = null;
		this.updatePromise = null;
		this.onRenderCallback = null;
		pending?.();

		this.editor.destroy();
		if (this.viewportDiv.parentNode) {
			this.viewportDiv.parentNode.removeChild(this.viewportDiv);
		}
		if (this.wrapper.parentNode) {
			this.wrapper.parentNode.removeChild(this.wrapper);
		}
	}
}
