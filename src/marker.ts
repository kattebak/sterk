/**
 * Marker and decoration implementations (xterm.js-compatible).
 *
 * A {@link MarkerImpl} anchors to a buffer line via the {@link ScrollBuffer}'s
 * marker-anchor registry, so its `line` follows the buffer as scrollback
 * accrues and it auto-disposes when the anchored line scrolls out (see
 * `ScrollBuffer.registerMarkerAnchor` / `pruneScrolledOutMarkers`).
 *
 * A {@link DecorationImpl} attaches to a marker; its lifecycle is faithful to
 * xterm.js (`onRender` / `onDispose` / `dispose`, disposes with its marker).
 * The visible overlay is a minimal absolutely-positioned box anchored over
 * the marker's row — see the rendering-fidelity note on
 * `Terminal.registerDecoration` in `types.ts`.
 */

import type { MarkerAnchor, ScrollBuffer } from "./buffer/scroll_buffer.js";
import type {
	Disposable,
	IDecoration,
	IDecorationOptions,
	IMarker,
} from "./types.js";
import { EventEmitter } from "./util/event_emitter.js";

let nextMarkerId = 1;

/**
 * Concrete {@link IMarker}. Backed by a {@link MarkerAnchor} the buffer keeps
 * in lock-step with line shifts.
 */
export class MarkerImpl implements IMarker {
	readonly id: number;
	private emitter = new EventEmitter();
	private _isDisposed = false;
	private anchor: MarkerAnchor;

	constructor(
		private buffer: ScrollBuffer,
		absoluteRow: number,
	) {
		this.id = nextMarkerId++;
		// Register the anchor; the buffer fires onScrolledOut exactly once when
		// the anchored line is dropped from the ring.
		this.anchor = this.buffer.registerMarkerAnchor(absoluteRow, () => {
			this.dispose();
		});
	}

	get line(): number {
		if (this._isDisposed) return -1;
		return this.anchor.absoluteRow;
	}

	get isDisposed(): boolean {
		return this._isDisposed;
	}

	onDispose(callback: () => void): Disposable {
		this.emitter.on("dispose", callback);
		return {
			dispose: () => {
				this.emitter.off("dispose", callback);
			},
		};
	}

	dispose(): void {
		if (this._isDisposed) return;
		this._isDisposed = true;
		// Remove the anchor from the buffer (idempotent — already gone if this
		// dispose was triggered BY the buffer pruning the anchor).
		this.buffer.unregisterMarkerAnchor(this.anchor);
		this.emitter.emit("dispose");
		this.emitter.removeAllListeners();
	}
}

/**
 * Renderer hooks a decoration needs to position its overlay. Supplied by the
 * Terminal once `open()` has wired a renderer; absent in headless mode.
 */
export interface DecorationRenderContext {
	/** The wrapper element overlays are appended to (renderer-owned). */
	getOverlayParent(): HTMLElement | null;
	/** Cell metrics in CSS pixels, or null before first measure. */
	getCellMetrics(): { width: number; height: number } | null;
	/** Absolute row index of the topmost visible row. */
	getViewportTop(): number;
}

/**
 * Concrete {@link IDecoration}. Disposes with its marker; positions a minimal
 * overlay element over the marker's row when a render context is available.
 */
export class DecorationImpl implements IDecoration {
	readonly marker: IMarker;
	private emitter = new EventEmitter();
	private _isDisposed = false;
	private _element: HTMLElement | undefined;
	private markerDisposeSub: Disposable;
	private renderCtx: DecorationRenderContext | null;

	constructor(
		private options: IDecorationOptions,
		renderCtx: DecorationRenderContext | null,
	) {
		this.marker = options.marker;
		this.renderCtx = renderCtx;
		// A decoration cannot outlive its marker.
		this.markerDisposeSub = this.marker.onDispose(() => this.dispose());
		// Attempt an initial render if a DOM context exists.
		this.render();
	}

	get element(): HTMLElement | undefined {
		return this._element;
	}

	get isDisposed(): boolean {
		return this._isDisposed;
	}

	onRender(callback: (element: HTMLElement) => void): Disposable {
		this.emitter.on("render", callback as (...args: unknown[]) => void);
		// If the element already exists, fire immediately so a late subscriber
		// still learns about it (xterm.js fires onRender on each paint).
		if (this._element) callback(this._element);
		return {
			dispose: () => {
				this.emitter.off("render", callback as (...args: unknown[]) => void);
			},
		};
	}

	onDispose(callback: () => void): Disposable {
		this.emitter.on("dispose", callback);
		return {
			dispose: () => {
				this.emitter.off("dispose", callback);
			},
		};
	}

	/**
	 * Provide (or replace) the render context. Called by the Terminal when a
	 * renderer is attached after the decoration was created in headless mode.
	 */
	setRenderContext(ctx: DecorationRenderContext): void {
		if (this._isDisposed) return;
		this.renderCtx = ctx;
		this.render();
	}

	/**
	 * Create/position the overlay element and fire `onRender`. No-op (and no
	 * `onRender`) when there is no DOM context — honest about the headless
	 * limitation rather than faking the event.
	 */
	render(): void {
		if (this._isDisposed) return;
		const ctx = this.renderCtx;
		if (!ctx) return;
		const parent = ctx.getOverlayParent();
		const metrics = ctx.getCellMetrics();
		if (!parent || !metrics) return;
		if (this.marker.isDisposed) return;

		if (!this._element) {
			const el = document.createElement("div");
			el.className = "sterk-decoration";
			el.style.position = "absolute";
			el.style.pointerEvents = "none";
			el.style.zIndex = this.options.layer === "top" ? "10" : "1";
			parent.appendChild(el);
			this._element = el;
		}

		const el = this._element;
		const rowFromTop = this.marker.line - ctx.getViewportTop();
		const x = this.options.x ?? 0;
		const widthCells = this.options.width ?? 1;
		const heightRows = this.options.height ?? 1;

		el.style.top = `${rowFromTop * metrics.height}px`;
		el.style.left = `${x * metrics.width}px`;
		el.style.width = `${widthCells * metrics.width}px`;
		el.style.height = `${heightRows * metrics.height}px`;
		if (this.options.backgroundColor) {
			el.style.backgroundColor = this.options.backgroundColor;
		}
		if (this.options.foregroundColor) {
			el.style.color = this.options.foregroundColor;
		}

		this.emitter.emit("render", el);
	}

	dispose(): void {
		if (this._isDisposed) return;
		this._isDisposed = true;
		this.markerDisposeSub.dispose();
		if (this._element?.parentNode) {
			this._element.parentNode.removeChild(this._element);
		}
		this._element = undefined;
		this.emitter.emit("dispose");
		this.emitter.removeAllListeners();
	}
}
