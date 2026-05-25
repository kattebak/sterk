/**
 * Input handling — keyboard events → VT sequences
 *
 * Clean-room implementation from VT spec and common terminal behavior.
 * Supports:
 * - Standard ASCII characters
 * - Arrow keys (CSI A/B/C/D)
 * - Function keys F1-F12
 * - Home/End/PageUp/PageDown
 * - Ctrl combos (C0 controls)
 * - Alt prefix (ESC + key)
 * - IME composition events
 *
 * References:
 * - https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
 * - Standard terminal input behavior (bash, zsh, etc.)
 */

/**
 * Key code mappings for special keys
 */
const KEY_SEQUENCES: Record<string, string> = {
	// Arrow keys
	ArrowUp: "\x1b[A",
	ArrowDown: "\x1b[B",
	ArrowRight: "\x1b[C",
	ArrowLeft: "\x1b[D",

	// Home/End
	Home: "\x1b[H",
	End: "\x1b[F",

	// Page Up/Down
	PageUp: "\x1b[5~",
	PageDown: "\x1b[6~",

	// Insert/Delete
	Insert: "\x1b[2~",
	Delete: "\x1b[3~",

	// Function keys
	F1: "\x1bOP",
	F2: "\x1bOQ",
	F3: "\x1bOR",
	F4: "\x1bOS",
	F5: "\x1b[15~",
	F6: "\x1b[17~",
	F7: "\x1b[18~",
	F8: "\x1b[19~",
	F9: "\x1b[20~",
	F10: "\x1b[21~",
	F11: "\x1b[23~",
	F12: "\x1b[24~",

	// Tab
	Tab: "\t",

	// Enter
	Enter: "\r",

	// Backspace
	Backspace: "\x7f",

	// Escape
	Escape: "\x1b",
};

/**
 * Convert a keyboard event to a VT sequence
 *
 * @param event - Keyboard event
 * @returns VT sequence string, or null if the event should be ignored
 */
export function keyboardEventToSequence(event: KeyboardEvent): string | null {
	// Handle IME composition - ignore while composing
	if (event.isComposing) {
		return null;
	}

	const { key, ctrlKey, altKey, metaKey, shiftKey } = event;

	// Handle Ctrl combinations
	if (ctrlKey && !altKey && !metaKey) {
		// Ctrl+C → ETX (0x03)
		if (key === "c" || key === "C") {
			return "\x03";
		}
		// Ctrl+D → EOT (0x04)
		if (key === "d" || key === "D") {
			return "\x04";
		}
		// Ctrl+Z → SUB (0x1a)
		if (key === "z" || key === "Z") {
			return "\x1a";
		}
		// Ctrl+\ → FS (0x1c)
		if (key === "\\") {
			return "\x1c";
		}
		// Ctrl+A-Z → 0x01-0x1a (except special cases above)
		if (key.length === 1) {
			const lower = key.toLowerCase();
			if (lower >= "a" && lower <= "z") {
				const code = lower.charCodeAt(0) - 96; // a=1, b=2, ..., z=26
				return String.fromCharCode(code);
			}
		}
	}

	// Handle Alt combinations (prefix with ESC)
	if (altKey && !ctrlKey && !metaKey) {
		if (key.length === 1) {
			return `\x1b${key}`;
		}
		// Alt + special key
		const sequence = KEY_SEQUENCES[key];
		if (sequence) {
			return `\x1b${sequence}`;
		}
	}

	// Handle special keys
	const sequence = KEY_SEQUENCES[key];
	if (sequence) {
		// Shift+Tab → backtab
		if (key === "Tab" && shiftKey) {
			return "\x1b[Z";
		}
		return sequence;
	}

	// Handle printable characters
	if (key.length === 1 && !ctrlKey && !metaKey) {
		return key;
	}

	// Ignore other keys (modifiers, unhandled keys)
	return null;
}

/**
 * Input handler class
 * Manages keyboard event listeners and composition state
 */
export class InputHandler {
	private onDataCallback: ((data: string) => void) | null = null;
	private onKeyCallback:
		| ((ev: { key: string; domEvent: KeyboardEvent }) => void)
		| null = null;
	private customKeyHandler: ((e: KeyboardEvent) => boolean) | null = null;
	private disableStdin = false;
	private compositionData = "";

	constructor(private element: HTMLElement) {
		// Keyboard events
		element.addEventListener("keydown", this.handleKeyDown);
		element.addEventListener("keypress", this.handleKeyPress);

		// Composition events (IME)
		element.addEventListener("compositionstart", this.handleCompositionStart);
		element.addEventListener("compositionupdate", this.handleCompositionUpdate);
		element.addEventListener("compositionend", this.handleCompositionEnd);

		// Prevent default behavior on certain keys
		element.addEventListener("keydown", (e: Event) => {
			// Prevent browser shortcuts that would interfere
			const keyEvent = e as KeyboardEvent;
			if (
				keyEvent.key === "Tab" ||
				(keyEvent.ctrlKey && ["c", "v", "a"].includes(keyEvent.key))
			) {
				keyEvent.preventDefault();
			}
		});
	}

	/**
	 * Set the data callback (called when input is generated)
	 */
	onData(callback: (data: string) => void): void {
		this.onDataCallback = callback;
	}

	/**
	 * Set the key callback (called alongside onData for each key input,
	 * carrying both the translated VT sequence and the originating DOM event).
	 */
	onKey(
		callback: (ev: { key: string; domEvent: KeyboardEvent }) => void,
	): void {
		this.onKeyCallback = callback;
	}

	/**
	 * Attach a custom key event handler. Returning `false` suppresses all
	 * terminal processing of the event (no VT translation, no onData/onKey).
	 * Only one handler is active at a time; attaching replaces the previous.
	 */
	attachCustomKeyEventHandler(handler: (e: KeyboardEvent) => boolean): void {
		this.customKeyHandler = handler;
	}

	/**
	 * Toggle stdin suppression. When true, input events are still received
	 * (and default browser behavior is still prevented for handled keys) but
	 * no data is emitted to the host via onData/onKey.
	 */
	setDisableStdin(disabled: boolean): void {
		this.disableStdin = disabled;
	}

	/**
	 * Handle keydown events
	 */
	private handleKeyDown = (event: KeyboardEvent): void => {
		// Custom handler veto (xterm semantics): a `false` return means the
		// terminal must not process this event at all.
		if (this.customKeyHandler && this.customKeyHandler(event) === false) {
			return;
		}

		const sequence = keyboardEventToSequence(event);
		if (sequence) {
			event.preventDefault();
			if (this.disableStdin) return;
			this.onKeyCallback?.({ key: sequence, domEvent: event });
			this.onDataCallback?.(sequence);
		}
	};

	/**
	 * Handle keypress events (fallback for printable characters)
	 */
	private handleKeyPress = (_event: KeyboardEvent): void => {
		// KeyPress is deprecated but some browsers still use it
		// We primarily rely on keydown + key property
	};

	/**
	 * Handle composition start (IME)
	 */
	private handleCompositionStart = (): void => {
		this.compositionData = "";
	};

	/**
	 * Handle composition update (IME)
	 */
	private handleCompositionUpdate = (event: CompositionEvent): void => {
		this.compositionData = event.data;
	};

	/**
	 * Handle composition end (IME) - emit the composed text
	 */
	private handleCompositionEnd = (event: CompositionEvent): void => {
		const text = event.data || this.compositionData;
		// IME composition is user input — suppressed by disableStdin, same as
		// keydown-derived sequences.
		if (text && !this.disableStdin && this.onDataCallback) {
			this.onDataCallback(text);
		}
		this.compositionData = "";
	};

	/**
	 * Clean up event listeners
	 */
	dispose(): void {
		this.element.removeEventListener("keydown", this.handleKeyDown);
		this.element.removeEventListener("keypress", this.handleKeyPress);
		this.element.removeEventListener(
			"compositionstart",
			this.handleCompositionStart,
		);
		this.element.removeEventListener(
			"compositionupdate",
			this.handleCompositionUpdate,
		);
		this.element.removeEventListener(
			"compositionend",
			this.handleCompositionEnd,
		);
		this.onDataCallback = null;
		this.onKeyCallback = null;
		this.customKeyHandler = null;
	}
}
