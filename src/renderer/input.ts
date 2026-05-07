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
	 * Handle keydown events
	 */
	private handleKeyDown = (event: KeyboardEvent): void => {
		const sequence = keyboardEventToSequence(event);
		if (sequence && this.onDataCallback) {
			event.preventDefault();
			this.onDataCallback(sequence);
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
		if (text && this.onDataCallback) {
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
	}
}
