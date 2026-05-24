/**
 * Mouse handling — mouse/touch events → VT sequences or scroll
 *
 * Implements VT mouse protocols:
 * - X10 encoding (CSI M <button> <x> <y>)
 * - SGR 1006 encoding (CSI < <button> ; <x> ; <y> M/m)
 *
 * DEC private mouse modes (driven by `Terminal.handleDecPrivateMode`):
 * - 1000 — VT200 tracking (press + release only)
 * - 1002 — Cell-motion tracking (press + release + button-held drag)
 * - 1003 — All-motion tracking (press + release + every motion event)
 * - 1006 — SGR encoding (orthogonal; controls *how* events are framed)
 *
 * Tracking modes (1000/1002/1003) are mutually exclusive — only one is
 * active at a time. The encoding (1006 vs default X10) is independent and
 * applies to whichever tracking mode is current.
 *
 * References:
 * - https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking
 */

/**
 * Mouse button codes for VT sequences
 */
enum MouseButton {
	Left = 0,
	Middle = 1,
	Right = 2,
	Release = 3,
}

/**
 * Mouse tracking mode (DEC 1000 / 1002 / 1003).
 *
 * Mutually exclusive — enabling one disables any other. See the DEC
 * private-mode handler in `terminal.ts` for the protocol wire-up.
 */
export enum MouseTrackingMode {
	/** No mouse tracking — wheel scrolls viewport. */
	Off = 0,
	/** DEC 1000 — VT200 tracking: press + release only, no motion. */
	VT200 = 1000,
	/** DEC 1002 — Cell-motion tracking: press + release + button-held drag. */
	CellMotion = 1002,
	/** DEC 1003 — All-motion tracking: every motion event, regardless of button. */
	AllMotion = 1003,
}

/**
 * Wire encoding for emitted mouse sequences (DEC 1006).
 *
 * Orthogonal to {@link MouseTrackingMode} — encoding controls *how* an
 * event is serialised, not *which* events are emitted.
 */
export enum MouseEncoding {
	/** Legacy X10 byte encoding (CSI M <Cb> <Cx> <Cy>). Default when 1006 is off. */
	Default = 0,
	/** DEC 1006 — SGR encoding (CSI < Cb ; Cx ; Cy M/m). */
	SGR = 1006,
}

/**
 * @deprecated Retained for backward compatibility with the pre-Phase-A1
 * API where tracking and encoding were conflated. New code should use
 * {@link MouseTrackingMode} and {@link MouseEncoding} via
 * `setTrackingMode` / `setEncoding`. Mapping:
 *   - `MouseMode.Off`     → tracking Off,         encoding Default
 *   - `MouseMode.X10`     → tracking VT200,       encoding Default
 *   - `MouseMode.SGR1006` → tracking VT200,       encoding SGR
 */
export enum MouseMode {
	Off = 0,
	X10 = 1,
	SGR1006 = 2,
}

/**
 * Get cell coordinates from mouse event
 */
function getCellCoordinates(
	event: MouseEvent,
	cellWidth: number,
	cellHeight: number,
	offsetX: number,
	offsetY: number,
): { col: number; row: number } {
	const x = event.clientX - offsetX;
	const y = event.clientY - offsetY;

	const col = Math.floor(x / cellWidth);
	const row = Math.floor(y / cellHeight);

	return { col: Math.max(0, col), row: Math.max(0, row) };
}

/**
 * Generate X10 mouse sequence
 */
function generateX10Sequence(
	button: MouseButton,
	col: number,
	row: number,
	modifiers: number,
): string {
	// X10 encoding: CSI M <button+32+modifiers> <x+33> <y+33>
	const cb = 32 + button + modifiers;
	const cx = 33 + col;
	const cy = 33 + row;
	return `\x1b[M${String.fromCharCode(cb)}${String.fromCharCode(cx)}${String.fromCharCode(cy)}`;
}

/**
 * Generate SGR 1006 mouse sequence
 */
function generateSGR1006Sequence(
	button: MouseButton,
	col: number,
	row: number,
	modifiers: number,
	pressed: boolean,
): string {
	// SGR 1006: CSI < button+modifiers ; x ; y M/m
	const cb = button + modifiers;
	const finalChar = pressed ? "M" : "m";
	return `\x1b[<${cb};${col + 1};${row + 1}${finalChar}`;
}

/**
 * Get modifier bits for mouse sequences
 */
function getModifiers(event: MouseEvent): number {
	let modifiers = 0;
	if (event.shiftKey) modifiers += 4;
	if (event.altKey || event.metaKey) modifiers += 8;
	if (event.ctrlKey) modifiers += 16;
	return modifiers;
}

/**
 * Mouse handler class
 */
export class MouseHandler {
	private tracking: MouseTrackingMode = MouseTrackingMode.Off;
	private encoding: MouseEncoding = MouseEncoding.Default;
	private onDataCallback: ((data: string) => void) | null = null;
	private onScrollCallback: ((lines: number) => void) | null = null;
	private lastButton: MouseButton | null = null;

	constructor(
		private element: HTMLElement,
		private getCellMetrics: () => { width: number; height: number } | null,
	) {
		// Mouse events
		element.addEventListener("mousedown", this.handleMouseDown);
		element.addEventListener("mouseup", this.handleMouseUp);
		element.addEventListener("mousemove", this.handleMouseMove);
		element.addEventListener("wheel", this.handleWheel, { passive: false });

		// Touch events (basic scroll support)
		element.addEventListener("touchstart", this.handleTouchStart, {
			passive: true,
		});
		element.addEventListener("touchmove", this.handleTouchMove, {
			passive: false,
		});
		element.addEventListener("touchend", this.handleTouchEnd, {
			passive: true,
		});
	}

	/**
	 * Set the tracking mode (DEC 1000 / 1002 / 1003). Mutually exclusive —
	 * enabling one disables any other. Use {@link MouseTrackingMode.Off} to
	 * disable tracking entirely.
	 */
	setTrackingMode(mode: MouseTrackingMode): void {
		this.tracking = mode;
	}

	/**
	 * Get the current tracking mode. Primarily useful for tests and
	 * `handleDecPrivateMode` reset semantics (e.g. only clear tracking on
	 * `?1000l` when the currently-active tracking mode is VT200).
	 */
	getTrackingMode(): MouseTrackingMode {
		return this.tracking;
	}

	/**
	 * Set the wire encoding (DEC 1006). Orthogonal to tracking mode.
	 */
	setEncoding(encoding: MouseEncoding): void {
		this.encoding = encoding;
	}

	/** Get the current wire encoding. Primarily useful for tests. */
	getEncoding(): MouseEncoding {
		return this.encoding;
	}

	/**
	 * @deprecated Use {@link setTrackingMode} and {@link setEncoding}.
	 * Kept for back-compat with the conflated pre-Phase-A1 API.
	 */
	setMode(mode: MouseMode): void {
		switch (mode) {
			case MouseMode.Off:
				this.tracking = MouseTrackingMode.Off;
				this.encoding = MouseEncoding.Default;
				break;
			case MouseMode.X10:
				this.tracking = MouseTrackingMode.VT200;
				this.encoding = MouseEncoding.Default;
				break;
			case MouseMode.SGR1006:
				this.tracking = MouseTrackingMode.VT200;
				this.encoding = MouseEncoding.SGR;
				break;
		}
	}

	/**
	 * Set the data callback (called when mouse sequences are generated)
	 */
	onData(callback: (data: string) => void): void {
		this.onDataCallback = callback;
	}

	/**
	 * Set the scroll callback (called when wheel should scroll viewport)
	 */
	onScroll(callback: (lines: number) => void): void {
		this.onScrollCallback = callback;
	}

	/**
	 * Emit a mouse sequence via the configured encoding.
	 *
	 * `pressed=false` produces a release event. In legacy X10 encoding,
	 * release is represented by button=3 (the protocol does not distinguish
	 * which button was released); in SGR 1006 the original button is kept
	 * and the trailing `m` marks the event as a release.
	 */
	private emitEvent(
		button: MouseButton,
		col: number,
		row: number,
		modifiers: number,
		pressed: boolean,
	): void {
		if (!this.onDataCallback) return;
		if (this.encoding === MouseEncoding.SGR) {
			this.onDataCallback(
				generateSGR1006Sequence(button, col, row, modifiers, pressed),
			);
		} else {
			const b = pressed ? button : MouseButton.Release;
			this.onDataCallback(generateX10Sequence(b, col, row, modifiers));
		}
	}

	private cellFor(event: MouseEvent): { col: number; row: number } | null {
		const metrics = this.getCellMetrics();
		if (!metrics) return null;
		const rect = this.element.getBoundingClientRect();
		return getCellCoordinates(
			event,
			metrics.width,
			metrics.height,
			rect.left,
			rect.top,
		);
	}

	/**
	 * Handle mousedown events
	 */
	private handleMouseDown = (event: MouseEvent): void => {
		if (this.tracking === MouseTrackingMode.Off) return;

		const pos = this.cellFor(event);
		if (!pos) return;

		let button: MouseButton;
		if (event.button === 0) button = MouseButton.Left;
		else if (event.button === 1) button = MouseButton.Middle;
		else if (event.button === 2) button = MouseButton.Right;
		else return;

		this.lastButton = button;

		this.emitEvent(button, pos.col, pos.row, getModifiers(event), true);
		event.preventDefault();
	};

	/**
	 * Handle mouseup events
	 */
	private handleMouseUp = (event: MouseEvent): void => {
		if (this.tracking === MouseTrackingMode.Off) return;
		if (this.lastButton === null) return;

		const pos = this.cellFor(event);
		if (!pos) return;

		this.emitEvent(
			this.lastButton,
			pos.col,
			pos.row,
			getModifiers(event),
			false,
		);

		this.lastButton = null;
		event.preventDefault();
	};

	/**
	 * Handle mousemove events.
	 *
	 * Emission rules per tracking mode:
	 *   - VT200 (1000): never emit on motion.
	 *   - CellMotion (1002): emit only while a button is held (drag).
	 *   - AllMotion (1003): emit on every motion, button or no button.
	 */
	private handleMouseMove = (event: MouseEvent): void => {
		if (this.tracking === MouseTrackingMode.Off) return;
		if (this.tracking === MouseTrackingMode.VT200) return;
		if (
			this.tracking === MouseTrackingMode.CellMotion &&
			this.lastButton === null
		) {
			return;
		}

		const pos = this.cellFor(event);
		if (!pos) return;

		// Motion indicator bit (32) is added to the button code, matching
		// the legacy xterm convention. For AllMotion with no button held,
		// xterm reports button code 3 (release) + motion-bit, which is the
		// value `MouseButton.Release` (3) — same as the encoder sees on
		// release. Drag-with-button uses the active button code.
		const baseButton: MouseButton = this.lastButton ?? MouseButton.Release;
		const modifiers = getModifiers(event) + 32;
		this.emitEvent(baseButton, pos.col, pos.row, modifiers, true);
	};

	/**
	 * Handle wheel events
	 */
	private handleWheel = (event: WheelEvent): void => {
		event.preventDefault();

		// When mouse tracking is off, scroll the viewport
		if (this.tracking === MouseTrackingMode.Off) {
			const lines = Math.sign(event.deltaY) * 3; // Scroll 3 lines at a time
			if (this.onScrollCallback) {
				this.onScrollCallback(lines);
			}
			return;
		}

		// When mouse tracking is on, send mouse wheel sequences
		const pos = this.cellFor(event);
		if (!pos) return;

		// Mouse wheel buttons use special codes (64=up, 65=down)
		// Cast to MouseButton since wheel codes are outside the enum
		const button = (event.deltaY > 0 ? 65 : 64) as unknown as MouseButton;
		const modifiers = getModifiers(event);

		if (this.encoding === MouseEncoding.SGR) {
			const sequence = generateSGR1006Sequence(
				button,
				pos.col,
				pos.row,
				modifiers,
				true,
			);
			if (this.onDataCallback) {
				this.onDataCallback(sequence);
			}
		}
	};

	// Touch support (minimal - just scrolling)
	// biome-ignore lint/correctness/noUnusedPrivateClassMembers: used in touch handlers
	private touchStartY = 0;
	private touchLastY = 0;

	private handleTouchStart = (event: TouchEvent): void => {
		const touch = event.touches[0];
		if (touch) {
			this.touchStartY = touch.clientY;
			this.touchLastY = touch.clientY;
		}
	};

	private handleTouchMove = (event: TouchEvent): void => {
		if (this.tracking !== MouseTrackingMode.Off) {
			// Don't scroll when mouse tracking is on
			event.preventDefault();
			return;
		}

		const touch = event.touches[0];
		if (touch) {
			const deltaY = this.touchLastY - touch.clientY;
			this.touchLastY = touch.clientY;

			// Scroll if moved enough
			if (Math.abs(deltaY) > 10) {
				const lines = Math.sign(deltaY) * 1; // Scroll 1 line at a time for touch
				if (this.onScrollCallback) {
					this.onScrollCallback(lines);
				}
				event.preventDefault();
			}
		}
	};

	private handleTouchEnd = (): void => {
		this.touchStartY = 0;
		this.touchLastY = 0;
	};

	/**
	 * Clean up event listeners
	 */
	dispose(): void {
		this.element.removeEventListener("mousedown", this.handleMouseDown);
		this.element.removeEventListener("mouseup", this.handleMouseUp);
		this.element.removeEventListener("mousemove", this.handleMouseMove);
		this.element.removeEventListener("wheel", this.handleWheel);
		this.element.removeEventListener("touchstart", this.handleTouchStart);
		this.element.removeEventListener("touchmove", this.handleTouchMove);
		this.element.removeEventListener("touchend", this.handleTouchEnd);
		this.onDataCallback = null;
		this.onScrollCallback = null;
	}
}
