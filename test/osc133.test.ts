/**
 * OSC 133 (shell integration) handler tests
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminal } from "../src/index.js";

describe("OSC 133 handler registration", () => {
	let term: ReturnType<typeof createTerminal>;

	beforeEach(() => {
		term = createTerminal({ cols: 80, rows: 24 });
	});

	it("allows registering OSC 133 handlers", () => {
		const handler = vi.fn();
		const disposable = term.parser.registerOscHandler(133, handler);

		expect(disposable).toBeDefined();
		expect(disposable.dispose).toBeTypeOf("function");

		disposable.dispose();
		term.dispose();
	});

	it("calls registered handler for OSC 133 sequences", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(133, handler);

		// OSC 133 ; A ST (prompt start)
		term.write("\x1b]133;A\x07");

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith("A");

		term.dispose();
	});

	it("supports OSC 133 A (prompt start)", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(133, handler);

		term.write("\x1b]133;A\x07");

		expect(handler).toHaveBeenCalledWith("A");
		term.dispose();
	});

	it("supports OSC 133 B (prompt end)", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(133, handler);

		term.write("\x1b]133;B\x07");

		expect(handler).toHaveBeenCalledWith("B");
		term.dispose();
	});

	it("supports OSC 133 C (command start)", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(133, handler);

		term.write("\x1b]133;C\x07");

		expect(handler).toHaveBeenCalledWith("C");
		term.dispose();
	});

	it("supports OSC 133 D (command end)", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(133, handler);

		term.write("\x1b]133;D;0\x07"); // With exit code

		expect(handler).toHaveBeenCalledWith("D;0");
		term.dispose();
	});

	it("calls handler multiple times for multiple sequences", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(133, handler);

		term.write("\x1b]133;A\x07"); // Prompt start
		term.write("\x1b]133;B\x07"); // Prompt end
		term.write("\x1b]133;C\x07"); // Command start
		term.write("\x1b]133;D;0\x07"); // Command end

		expect(handler).toHaveBeenCalledTimes(4);
		expect(handler).toHaveBeenNthCalledWith(1, "A");
		expect(handler).toHaveBeenNthCalledWith(2, "B");
		expect(handler).toHaveBeenNthCalledWith(3, "C");
		expect(handler).toHaveBeenNthCalledWith(4, "D;0");

		term.dispose();
	});

	it("supports multiple handlers for the same OSC id", () => {
		const handler1 = vi.fn();
		const handler2 = vi.fn();

		term.parser.registerOscHandler(133, handler1);
		term.parser.registerOscHandler(133, handler2);

		term.write("\x1b]133;A\x07");

		expect(handler1).toHaveBeenCalledTimes(1);
		expect(handler2).toHaveBeenCalledTimes(1);

		term.dispose();
	});

	it("stops propagation when handler returns true", () => {
		const handler1 = vi.fn(() => true); // Stop propagation
		const handler2 = vi.fn();

		term.parser.registerOscHandler(133, handler1);
		term.parser.registerOscHandler(133, handler2);

		term.write("\x1b]133;A\x07");

		expect(handler1).toHaveBeenCalledTimes(1);
		expect(handler2).not.toHaveBeenCalled(); // Stopped by handler1

		term.dispose();
	});

	it("continues propagation when handler returns false", () => {
		const handler1 = vi.fn(() => false); // Continue
		const handler2 = vi.fn();

		term.parser.registerOscHandler(133, handler1);
		term.parser.registerOscHandler(133, handler2);

		term.write("\x1b]133;A\x07");

		expect(handler1).toHaveBeenCalledTimes(1);
		expect(handler2).toHaveBeenCalledTimes(1);

		term.dispose();
	});

	it("continues propagation when handler returns undefined", () => {
		const handler1 = vi.fn(); // Returns undefined
		const handler2 = vi.fn();

		term.parser.registerOscHandler(133, handler1);
		term.parser.registerOscHandler(133, handler2);

		term.write("\x1b]133;A\x07");

		expect(handler1).toHaveBeenCalledTimes(1);
		expect(handler2).toHaveBeenCalledTimes(1);

		term.dispose();
	});

	it("unregisters handler via dispose", () => {
		const handler = vi.fn();
		const disposable = term.parser.registerOscHandler(133, handler);

		term.write("\x1b]133;A\x07");
		expect(handler).toHaveBeenCalledTimes(1);

		disposable.dispose();

		term.write("\x1b]133;B\x07");
		expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again

		term.dispose();
	});

	it("handles OSC termination with BEL (07)", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(133, handler);

		term.write("\x1b]133;A\x07");

		expect(handler).toHaveBeenCalledWith("A");
		term.dispose();
	});

	it("handles OSC termination with ST (ESC \\)", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(133, handler);

		term.write("\x1b]133;A\x1b\\");

		expect(handler).toHaveBeenCalledWith("A");
		term.dispose();
	});

	it("tracks cursor position for OSC 133 markers", () => {
		const markers = new Map<number, string>();

		term.parser.registerOscHandler(133, (data) => {
			const kind = data.charAt(0);
			if (kind === "A" || kind === "B" || kind === "C" || kind === "D") {
				const buffer = term.buffer.active;
				const absY = buffer.baseY + buffer.cursorY;
				markers.set(absY, kind);
			}
			return false;
		});

		term.write("$ \x1b]133;A\x07"); // Prompt start at line 0
		term.write("ls\x1b]133;B\x07"); // Prompt end
		term.write("\x1b]133;C\x07"); // Command start
		term.write("\nfile1.txt\nfile2.txt\n\x1b]133;D;0\x07"); // Output + command end

		// Markers should be recorded at different Y positions
		expect(markers.size).toBeGreaterThan(0);
		expect(Array.from(markers.values())).toContain("A");
		expect(Array.from(markers.values())).toContain("B");
		expect(Array.from(markers.values())).toContain("C");
		expect(Array.from(markers.values())).toContain("D");

		term.dispose();
	});
});

describe("Other OSC sequences", () => {
	let term: ReturnType<typeof createTerminal>;

	beforeEach(() => {
		term = createTerminal({ cols: 80, rows: 24 });
	});

	it("supports OSC 0 (set title)", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(0, handler);

		term.write("\x1b]0;My Terminal\x07");

		expect(handler).toHaveBeenCalledWith("My Terminal");
		term.dispose();
	});

	it("supports OSC 2 (set window title)", () => {
		const handler = vi.fn();
		term.parser.registerOscHandler(2, handler);

		term.write("\x1b]2;Window Title\x07");

		expect(handler).toHaveBeenCalledWith("Window Title");
		term.dispose();
	});

	it("ignores unregistered OSC sequences", () => {
		// No handler registered
		term.write("\x1b]999;custom data\x07");

		// Should not throw, should be silently ignored
		expect(true).toBe(true);
		term.dispose();
	});
});
