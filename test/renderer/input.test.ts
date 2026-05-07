import { describe, expect, it } from "vitest";
import { keyboardEventToSequence } from "../../src/renderer/input.js";

describe("input", () => {
	describe("keyboardEventToSequence", () => {
		// Helper to create keyboard events
		function createKeyEvent(
			key: string,
			modifiers: Partial<{
				ctrlKey: boolean;
				altKey: boolean;
				metaKey: boolean;
				shiftKey: boolean;
			}> = {},
		): KeyboardEvent {
			return {
				key,
				ctrlKey: modifiers.ctrlKey ?? false,
				altKey: modifiers.altKey ?? false,
				metaKey: modifiers.metaKey ?? false,
				shiftKey: modifiers.shiftKey ?? false,
				isComposing: false,
			} as KeyboardEvent;
		}

		it("returns null for composing events", () => {
			const event = {
				key: "a",
				isComposing: true,
			} as KeyboardEvent;
			expect(keyboardEventToSequence(event)).toBeNull();
		});

		describe("printable characters", () => {
			it("passes through regular characters", () => {
				expect(keyboardEventToSequence(createKeyEvent("a"))).toBe("a");
				expect(keyboardEventToSequence(createKeyEvent("A"))).toBe("A");
				expect(keyboardEventToSequence(createKeyEvent("1"))).toBe("1");
				expect(keyboardEventToSequence(createKeyEvent(" "))).toBe(" ");
				expect(keyboardEventToSequence(createKeyEvent("!"))).toBe("!");
			});
		});

		describe("arrow keys", () => {
			it("generates CSI sequences for arrows", () => {
				expect(keyboardEventToSequence(createKeyEvent("ArrowUp"))).toBe(
					"\x1b[A",
				);
				expect(keyboardEventToSequence(createKeyEvent("ArrowDown"))).toBe(
					"\x1b[B",
				);
				expect(keyboardEventToSequence(createKeyEvent("ArrowRight"))).toBe(
					"\x1b[C",
				);
				expect(keyboardEventToSequence(createKeyEvent("ArrowLeft"))).toBe(
					"\x1b[D",
				);
			});
		});

		describe("home/end/page keys", () => {
			it("generates correct sequences", () => {
				expect(keyboardEventToSequence(createKeyEvent("Home"))).toBe("\x1b[H");
				expect(keyboardEventToSequence(createKeyEvent("End"))).toBe("\x1b[F");
				expect(keyboardEventToSequence(createKeyEvent("PageUp"))).toBe(
					"\x1b[5~",
				);
				expect(keyboardEventToSequence(createKeyEvent("PageDown"))).toBe(
					"\x1b[6~",
				);
			});
		});

		describe("insert/delete", () => {
			it("generates correct sequences", () => {
				expect(keyboardEventToSequence(createKeyEvent("Insert"))).toBe(
					"\x1b[2~",
				);
				expect(keyboardEventToSequence(createKeyEvent("Delete"))).toBe(
					"\x1b[3~",
				);
			});
		});

		describe("function keys", () => {
			it("generates correct sequences for F1-F4", () => {
				expect(keyboardEventToSequence(createKeyEvent("F1"))).toBe("\x1bOP");
				expect(keyboardEventToSequence(createKeyEvent("F2"))).toBe("\x1bOQ");
				expect(keyboardEventToSequence(createKeyEvent("F3"))).toBe("\x1bOR");
				expect(keyboardEventToSequence(createKeyEvent("F4"))).toBe("\x1bOS");
			});

			it("generates correct sequences for F5-F12", () => {
				expect(keyboardEventToSequence(createKeyEvent("F5"))).toBe("\x1b[15~");
				expect(keyboardEventToSequence(createKeyEvent("F6"))).toBe("\x1b[17~");
				expect(keyboardEventToSequence(createKeyEvent("F7"))).toBe("\x1b[18~");
				expect(keyboardEventToSequence(createKeyEvent("F8"))).toBe("\x1b[19~");
				expect(keyboardEventToSequence(createKeyEvent("F9"))).toBe("\x1b[20~");
				expect(keyboardEventToSequence(createKeyEvent("F10"))).toBe("\x1b[21~");
				expect(keyboardEventToSequence(createKeyEvent("F11"))).toBe("\x1b[23~");
				expect(keyboardEventToSequence(createKeyEvent("F12"))).toBe("\x1b[24~");
			});
		});

		describe("special keys", () => {
			it("generates correct sequences", () => {
				expect(keyboardEventToSequence(createKeyEvent("Tab"))).toBe("\t");
				expect(keyboardEventToSequence(createKeyEvent("Enter"))).toBe("\r");
				expect(keyboardEventToSequence(createKeyEvent("Backspace"))).toBe(
					"\x7f",
				);
				expect(keyboardEventToSequence(createKeyEvent("Escape"))).toBe("\x1b");
			});

			it("generates backtab for Shift+Tab", () => {
				expect(
					keyboardEventToSequence(createKeyEvent("Tab", { shiftKey: true })),
				).toBe("\x1b[Z");
			});
		});

		describe("Ctrl combinations", () => {
			it("generates C0 control codes", () => {
				expect(
					keyboardEventToSequence(createKeyEvent("a", { ctrlKey: true })),
				).toBe("\x01");
				expect(
					keyboardEventToSequence(createKeyEvent("b", { ctrlKey: true })),
				).toBe("\x02");
				expect(
					keyboardEventToSequence(createKeyEvent("c", { ctrlKey: true })),
				).toBe("\x03");
				expect(
					keyboardEventToSequence(createKeyEvent("d", { ctrlKey: true })),
				).toBe("\x04");
				expect(
					keyboardEventToSequence(createKeyEvent("z", { ctrlKey: true })),
				).toBe("\x1a");
			});

			it("handles Ctrl+C, Ctrl+D, Ctrl+Z specially", () => {
				expect(
					keyboardEventToSequence(createKeyEvent("c", { ctrlKey: true })),
				).toBe("\x03"); // ETX
				expect(
					keyboardEventToSequence(createKeyEvent("C", { ctrlKey: true })),
				).toBe("\x03"); // ETX
				expect(
					keyboardEventToSequence(createKeyEvent("d", { ctrlKey: true })),
				).toBe("\x04"); // EOT
				expect(
					keyboardEventToSequence(createKeyEvent("D", { ctrlKey: true })),
				).toBe("\x04"); // EOT
				expect(
					keyboardEventToSequence(createKeyEvent("z", { ctrlKey: true })),
				).toBe("\x1a"); // SUB
				expect(
					keyboardEventToSequence(createKeyEvent("Z", { ctrlKey: true })),
				).toBe("\x1a"); // SUB
			});

			it("handles Ctrl+\\ (FS)", () => {
				expect(
					keyboardEventToSequence(createKeyEvent("\\", { ctrlKey: true })),
				).toBe("\x1c");
			});

			it("works with uppercase letters", () => {
				expect(
					keyboardEventToSequence(createKeyEvent("A", { ctrlKey: true })),
				).toBe("\x01");
				expect(
					keyboardEventToSequence(createKeyEvent("Z", { ctrlKey: true })),
				).toBe("\x1a");
			});
		});

		describe("Alt combinations", () => {
			it("prefixes characters with ESC", () => {
				expect(
					keyboardEventToSequence(createKeyEvent("a", { altKey: true })),
				).toBe("\x1ba");
				expect(
					keyboardEventToSequence(createKeyEvent("A", { altKey: true })),
				).toBe("\x1bA");
				expect(
					keyboardEventToSequence(createKeyEvent("1", { altKey: true })),
				).toBe("\x1b1");
			});

			it("prefixes special keys with ESC", () => {
				expect(
					keyboardEventToSequence(createKeyEvent("ArrowUp", { altKey: true })),
				).toBe("\x1b\x1b[A");
				expect(
					keyboardEventToSequence(createKeyEvent("Home", { altKey: true })),
				).toBe("\x1b\x1b[H");
			});
		});

		describe("ignored keys", () => {
			it("returns null for modifier keys", () => {
				expect(keyboardEventToSequence(createKeyEvent("Shift"))).toBeNull();
				expect(keyboardEventToSequence(createKeyEvent("Control"))).toBeNull();
				expect(keyboardEventToSequence(createKeyEvent("Alt"))).toBeNull();
				expect(keyboardEventToSequence(createKeyEvent("Meta"))).toBeNull();
			});

			it("returns null for unhandled keys", () => {
				expect(
					keyboardEventToSequence(createKeyEvent("AudioVolumeUp")),
				).toBeNull();
				expect(keyboardEventToSequence(createKeyEvent("F13"))).toBeNull();
			});

			it("returns null for Ctrl+Alt combinations", () => {
				expect(
					keyboardEventToSequence(
						createKeyEvent("a", { ctrlKey: true, altKey: true }),
					),
				).toBeNull();
			});

			it("returns null for Meta combinations", () => {
				expect(
					keyboardEventToSequence(createKeyEvent("a", { metaKey: true })),
				).toBeNull();
			});
		});
	});
});
