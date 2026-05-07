/**
 * Mouse handling — mouse/touch events → VT sequences or scroll
 *
 * Implements VT mouse protocols:
 * - X10 encoding (CSI M <button> <x> <y>)
 * - SGR 1006 encoding (CSI < <button> ; <x> ; <y> M/m)
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
 * Mouse tracking mode
 */
export enum MouseMode {
	/** No mouse tracking - wheel scrolls viewport */
	Off = 0,
	/** X10 mouse protocol */
	X10 = 1,
	/** SGR 1006 mouse protocol (preferred) */
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
	private mode = MouseMode.Off;
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
	 * Set mouse tracking mode
	 */
	setMode(mode: MouseMode): void {
		this.mode = mode;
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
	 * Handle mousedown events
	 */
	private handleMouseDown = (event: MouseEvent): void => {
		if (this.mode === MouseMode.Off) return;

		const metrics = this.getCellMetrics();
		if (!metrics) return;

		const rect = this.element.getBoundingClientRect();
		const { col, row } = getCellCoordinates(
			event,
			metrics.width,
			metrics.height,
			rect.left,
			rect.top,
		);

		let button: MouseButton;
		if (event.button === 0) button = MouseButton.Left;
		else if (event.button === 1) button = MouseButton.Middle;
		else if (event.button === 2) button = MouseButton.Right;
		else return;

		this.lastButton = button;

		const modifiers = getModifiers(event);

		if (this.mode === MouseMode.X10) {
			const sequence = generateX10Sequence(button, col, row, modifiers);
			if (this.onDataCallback) {
				this.onDataCallback(sequence);
			}
		} else if (this.mode === MouseMode.SGR1006) {
			const sequence = generateSGR1006Sequence(
				button,
				col,
				row,
				modifiers,
				true,
			);
			if (this.onDataCallback) {
				this.onDataCallback(sequence);
			}
		}

		event.preventDefault();
	};

	/**
	 * Handle mouseup events
	 */
	private handleMouseUp = (event: MouseEvent): void => {
		if (this.mode === MouseMode.Off) return;
		if (this.lastButton === null) return;

		const metrics = this.getCellMetrics();
		if (!metrics) return;

		const rect = this.element.getBoundingClientRect();
		const { col, row } = getCellCoordinates(
			event,
			metrics.width,
			metrics.height,
			rect.left,
			rect.top,
		);

		const modifiers = getModifiers(event);

		if (this.mode === MouseMode.X10) {
			const sequence = generateX10Sequence(
				MouseButton.Release,
				col,
				row,
				modifiers,
			);
			if (this.onDataCallback) {
				this.onDataCallback(sequence);
			}
		} else if (this.mode === MouseMode.SGR1006) {
			const sequence = generateSGR1006Sequence(
				this.lastButton,
				col,
				row,
				modifiers,
				false,
			);
			if (this.onDataCallback) {
				this.onDataCallback(sequence);
			}
		}

		this.lastButton = null;
		event.preventDefault();
	};

	/**
	 * Handle mousemove events (for drag tracking)
	 */
	private handleMouseMove = (event: MouseEvent): void => {
		if (this.mode === MouseMode.Off) return;
		if (this.lastButton === null) return; // Only track drags

		const metrics = this.getCellMetrics();
		if (!metrics) return;

		const rect = this.element.getBoundingClientRect();
		const { col, row } = getCellCoordinates(
			event,
			metrics.width,
			metrics.height,
			rect.left,
			rect.top,
		);

		const modifiers = getModifiers(event) + 32; // Add motion indicator

		if (this.mode === MouseMode.X10) {
			const sequence = generateX10Sequence(
				this.lastButton,
				col,
				row,
				modifiers,
			);
			if (this.onDataCallback) {
				this.onDataCallback(sequence);
			}
		} else if (this.mode === MouseMode.SGR1006) {
			const sequence = generateSGR1006Sequence(
				this.lastButton,
				col,
				row,
				modifiers,
				true,
			);
			if (this.onDataCallback) {
				this.onDataCallback(sequence);
			}
		}
	};

	/**
	 * Handle wheel events
	 */
	private handleWheel = (event: WheelEvent): void => {
		event.preventDefault();

		// When mouse tracking is off, scroll the viewport
		if (this.mode === MouseMode.Off) {
			const lines = Math.sign(event.deltaY) * 3; // Scroll 3 lines at a time
			if (this.onScrollCallback) {
				this.onScrollCallback(lines);
			}
			return;
		}

		// When mouse tracking is on, send mouse wheel sequences
		const metrics = this.getCellMetrics();
		if (!metrics) return;

		const rect = this.element.getBoundingClientRect();
		const { col, row } = getCellCoordinates(
			event,
			metrics.width,
			metrics.height,
			rect.left,
			rect.top,
		);

		// Mouse wheel buttons use special codes (64=up, 65=down)
		// Cast to MouseButton since wheel codes are outside the enum
		const button = (event.deltaY > 0 ? 65 : 64) as unknown as MouseButton;
		const modifiers = getModifiers(event);

		if (this.mode === MouseMode.SGR1006) {
			const sequence = generateSGR1006Sequence(
				button,
				col,
				row,
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
		if (this.mode !== MouseMode.Off) {
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
