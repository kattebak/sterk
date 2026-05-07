import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "../src/util/event_emitter.js";

describe("EventEmitter", () => {
	let emitter: EventEmitter;

	beforeEach(() => {
		emitter = new EventEmitter();
	});

	describe("on", () => {
		it("subscribes to events", () => {
			const listener = vi.fn();
			emitter.on("test", listener);
			emitter.emit("test");
			expect(listener).toHaveBeenCalledOnce();
		});

		it("supports multiple listeners for the same event", () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();
			emitter.on("test", listener1);
			emitter.on("test", listener2);
			emitter.emit("test");
			expect(listener1).toHaveBeenCalledOnce();
			expect(listener2).toHaveBeenCalledOnce();
		});

		it("invokes listeners in subscription order", () => {
			const order: number[] = [];
			emitter.on("test", () => order.push(1));
			emitter.on("test", () => order.push(2));
			emitter.on("test", () => order.push(3));
			emitter.emit("test");
			expect(order).toEqual([1, 2, 3]);
		});

		it("returns the emitter for chaining", () => {
			const result = emitter.on("test", () => {});
			expect(result).toBe(emitter);
		});
	});

	describe("off", () => {
		it("unsubscribes a listener", () => {
			const listener = vi.fn();
			emitter.on("test", listener);
			emitter.off("test", listener);
			emitter.emit("test");
			expect(listener).not.toHaveBeenCalled();
		});

		it("only removes the specified listener", () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();
			emitter.on("test", listener1);
			emitter.on("test", listener2);
			emitter.off("test", listener1);
			emitter.emit("test");
			expect(listener1).not.toHaveBeenCalled();
			expect(listener2).toHaveBeenCalledOnce();
		});

		it("handles removing non-existent listeners gracefully", () => {
			const listener = vi.fn();
			expect(() => emitter.off("test", listener)).not.toThrow();
		});

		it("returns the emitter for chaining", () => {
			const result = emitter.off("test", () => {});
			expect(result).toBe(emitter);
		});
	});

	describe("once", () => {
		it("invokes listener only once", () => {
			const listener = vi.fn();
			emitter.once("test", listener);
			emitter.emit("test");
			emitter.emit("test");
			expect(listener).toHaveBeenCalledOnce();
		});

		it("removes listener after first invocation", () => {
			const listener = vi.fn();
			emitter.once("test", listener);
			emitter.emit("test");
			expect(emitter.listenerCount("test")).toBe(0);
		});

		it("passes arguments to listener", () => {
			const listener = vi.fn();
			emitter.once("test", listener);
			emitter.emit("test", 1, 2, 3);
			expect(listener).toHaveBeenCalledWith(1, 2, 3);
		});

		it("returns the emitter for chaining", () => {
			const result = emitter.once("test", () => {});
			expect(result).toBe(emitter);
		});
	});

	describe("emit", () => {
		it("passes arguments to listeners", () => {
			const listener = vi.fn();
			emitter.on("test", listener);
			emitter.emit("test", "arg1", 42, { key: "value" });
			expect(listener).toHaveBeenCalledWith("arg1", 42, { key: "value" });
		});

		it("returns true if event had listeners", () => {
			emitter.on("test", () => {});
			expect(emitter.emit("test")).toBe(true);
		});

		it("returns false if event had no listeners", () => {
			expect(emitter.emit("test")).toBe(false);
		});

		it("does not throw if a listener is removed during emit", () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn(() => {
				emitter.off("test", listener1);
			});
			emitter.on("test", listener1);
			emitter.on("test", listener2);
			expect(() => emitter.emit("test")).not.toThrow();
		});

		it("does not throw if a listener is added during emit", () => {
			const listener2 = vi.fn();
			const listener1 = vi.fn(() => {
				emitter.on("test", listener2);
			});
			emitter.on("test", listener1);
			expect(() => emitter.emit("test")).not.toThrow();
			// listener2 should not be called on this emit (was added during iteration)
			expect(listener2).not.toHaveBeenCalled();
		});
	});

	describe("removeAllListeners", () => {
		it("removes all listeners for a specific event", () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();
			emitter.on("test", listener1);
			emitter.on("other", listener2);
			emitter.removeAllListeners("test");
			emitter.emit("test");
			emitter.emit("other");
			expect(listener1).not.toHaveBeenCalled();
			expect(listener2).toHaveBeenCalledOnce();
		});

		it("removes all listeners for all events when no event specified", () => {
			const listener1 = vi.fn();
			const listener2 = vi.fn();
			emitter.on("test", listener1);
			emitter.on("other", listener2);
			emitter.removeAllListeners();
			emitter.emit("test");
			emitter.emit("other");
			expect(listener1).not.toHaveBeenCalled();
			expect(listener2).not.toHaveBeenCalled();
		});

		it("returns the emitter for chaining", () => {
			const result = emitter.removeAllListeners("test");
			expect(result).toBe(emitter);
		});
	});

	describe("listenerCount", () => {
		it("returns 0 for events with no listeners", () => {
			expect(emitter.listenerCount("test")).toBe(0);
		});

		it("returns the correct count for events with listeners", () => {
			emitter.on("test", () => {});
			emitter.on("test", () => {});
			emitter.on("test", () => {});
			expect(emitter.listenerCount("test")).toBe(3);
		});

		it("updates count when listeners are removed", () => {
			const listener = () => {};
			emitter.on("test", listener);
			expect(emitter.listenerCount("test")).toBe(1);
			emitter.off("test", listener);
			expect(emitter.listenerCount("test")).toBe(0);
		});
	});

	describe("listeners", () => {
		it("returns an empty array for events with no listeners", () => {
			expect(emitter.listeners("test")).toEqual([]);
		});

		it("returns a copy of the listeners array", () => {
			const listener1 = () => {};
			const listener2 = () => {};
			emitter.on("test", listener1);
			emitter.on("test", listener2);
			const listeners = emitter.listeners("test");
			expect(listeners).toHaveLength(2);
			expect(listeners[0]).toBe(listener1);
			expect(listeners[1]).toBe(listener2);
		});

		it("returns a copy, not a reference", () => {
			const listener = () => {};
			emitter.on("test", listener);
			const listeners1 = emitter.listeners("test");
			const listeners2 = emitter.listeners("test");
			expect(listeners1).not.toBe(listeners2);
			expect(listeners1).toEqual(listeners2);
		});
	});

	describe("edge cases", () => {
		it("handles listeners that throw errors", () => {
			const listener1 = vi.fn(() => {
				throw new Error("Test error");
			});
			const listener2 = vi.fn();
			emitter.on("test", listener1);
			emitter.on("test", listener2);
			expect(() => emitter.emit("test")).toThrow("Test error");
			// listener2 should not be called because listener1 threw
			expect(listener2).not.toHaveBeenCalled();
		});

		it("handles rapid subscribe/unsubscribe cycles", () => {
			const listener = vi.fn();
			for (let i = 0; i < 100; i++) {
				emitter.on("test", listener);
				emitter.off("test", listener);
			}
			emitter.emit("test");
			expect(listener).not.toHaveBeenCalled();
		});

		it("handles many listeners efficiently", () => {
			const listeners: Array<() => void> = [];
			for (let i = 0; i < 1000; i++) {
				const listener = vi.fn();
				listeners.push(listener);
				emitter.on("test", listener);
			}
			emitter.emit("test");
			for (const listener of listeners) {
				expect(listener).toHaveBeenCalledOnce();
			}
		});
	});
});
