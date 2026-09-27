/**
 * Ace surface shared by the terminal renderer and the buffer view: the
 * editor set-up, the container resize observer, cell metrics, fonts,
 * selection passthroughs and the coalesced rAF flush. Subclasses decide
 * what a flush writes into the document.
 */

import type { Ace } from "ace-builds";
import ace from "ace-builds";

export abstract class AceSurface {
	protected editor: Ace.Editor;
	protected session: Ace.EditSession;
	private viewportDiv: HTMLElement;
	private wrapper: HTMLElement;
	/**
	 * Promise that resolves after the next coalesced rAF flush completes.
	 * Shared across all writes that land in the same tick. Becomes null
	 * again once the rAF fires.
	 *
	 * Acts as both the "is an update scheduled?" flag and the barrier that
	 * `refresh()` awaits before triggering Ace's repaint, so a forced
	 * redraw never lands on a half-synced document.
	 */
	private updatePromise: Promise<void> | null = null;
	private updateResolve: (() => void) | null = null;
	protected disposed = false;
	private resizeObserver: ResizeObserver | null = null;
	private resizeFrameHandle: number | null = null;
	private lastObservedSize: { width: number; height: number } | null = null;

	constructor(
		protected readonly container: HTMLElement,
		fontSize: number,
		fontFamily: string,
		mode: Ace.SyntaxMode,
	) {
		// Create wrapper with sterk class
		this.wrapper = document.createElement("div");
		this.wrapper.classList.add("sterk");
		// Establish a positioning context so absolutely-positioned decoration
		// overlays (appended to this wrapper) anchor to the grid origin rather
		// than to some distant positioned ancestor in the consumer's layout.
		this.wrapper.style.position = "relative";
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

		// Custom VT mode for SGR rendering
		this.session.setMode(mode);

		// Force editor to measure layout (critical when container is pre-sized)
		this.editor.resize(true);

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
	 * The `.sterk` wrapper element (positioned container that holds the Ace
	 * viewport). Decoration overlays are appended here so they sit above the
	 * grid and scroll with the wrapper. The wrapper is `position: relative`
	 * via the sterk stylesheet; if a consumer's CSS leaves it static the
	 * overlay still anchors to the nearest positioned ancestor.
	 */
	getWrapper(): HTMLElement {
		return this.wrapper;
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

	// ── Selection passthroughs ───────────────────────────────────────
	//
	// These map the xterm.js `Terminal` selection surface onto Ace's
	// `editor.selection`. The renderer keeps Ace document rows 1:1 with
	// buffer ABSOLUTE rows (see `syncBufferToDocument`), so callers that
	// already hold absolute-row Ace coordinates pass them through here
	// unchanged. Viewport-relative ↔ absolute translation is the
	// terminal's responsibility (it owns the buffer offsets).

	/**
	 * True when the editor has a non-empty selection.
	 */
	hasSelection(): boolean {
		return !this.editor.selection.isEmpty();
	}

	/**
	 * The currently selected text (empty string when nothing is selected).
	 */
	getSelectedText(): string {
		return this.editor.getSelectedText();
	}

	/**
	 * The current selection range in Ace document coordinates
	 * (`{ start: { row, column }, end: { row, column } }`), or `undefined`
	 * when the selection is empty. Ace rows equal buffer absolute rows.
	 */
	getSelectionRange():
		| {
				start: { row: number; column: number };
				end: { row: number; column: number };
		  }
		| undefined {
		if (this.editor.selection.isEmpty()) return undefined;
		const range = this.editor.selection.getRange();
		return {
			start: { row: range.start.row, column: range.start.column },
			end: { row: range.end.row, column: range.end.column },
		};
	}

	/**
	 * Clear the current selection (collapses to the cursor).
	 */
	clearSelection(): void {
		this.editor.clearSelection();
	}

	/**
	 * Select all document content.
	 */
	selectAll(): void {
		this.editor.selectAll();
	}

	/**
	 * Set the selection to the given Ace document range (absolute rows).
	 * Coordinates are clamped to the document by Ace.
	 */
	setSelectionRange(
		startRow: number,
		startColumn: number,
		endRow: number,
		endColumn: number,
	): void {
		this.editor.selection.setSelectionRange({
			start: { row: startRow, column: startColumn },
			end: { row: endRow, column: endColumn },
		});
	}

	/**
	 * Subscribe to Ace selection-change events. Returns an unsubscribe fn.
	 */
	listenSelection(callback: () => void): () => void {
		const wrapper = () => callback();
		this.editor.selection.on("changeSelection", wrapper);
		return () => {
			this.editor.selection.off("changeSelection", wrapper);
		};
	}

	/**
	 * The number of document lines (== buffer length). Used by the terminal
	 * to clamp selection rows when the renderer is the source of truth.
	 */
	getDocumentLength(): number {
		return this.session.getDocument().getLength();
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

			this.flush();
			resolve?.();
		});

		return promise;
	}

	protected abstract flush(): void;

	/** Pin the top of the visible area to document row `row`. */
	protected scrollDocumentTo(row: number): void {
		const lineHeight = this.editor.renderer.lineHeight;
		if (lineHeight > 0) {
			this.session.setScrollTop(row * lineHeight);
			return;
		}
		// Pre-measure fallback (e.g. before first paint). scrollToLine is
		// harmless here because the document and viewport are both
		// effectively zero-height.
		this.editor.scrollToLine(row, false, false, () => {});
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
	 * Force Ace to re-tokenize and repaint a single row whose rendered
	 * attributes changed without its text changing.
	 *
	 * Ace caches tokens per row in its `BackgroundTokenizer`; a no-op document
	 * edit (same text) does not reliably bust that cache. We invalidate the
	 * tokenizer's cached line directly and ask the renderer to repaint just
	 * that row (`updateLines(row, row)`), keeping the work O(changed rows).
	 */
	protected retokenizeRow(row: number): void {
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
