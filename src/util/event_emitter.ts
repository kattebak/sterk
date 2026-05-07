/**
 * Minimal EventEmitter implementation for browser compatibility.
 *
 * Provides a Node.js-style EventEmitter API for the browser environment.
 * This is a standard pattern, not specific to any particular implementation.
 *
 * Supports:
 * - on(event, listener) — subscribe to events
 * - off(event, listener) — unsubscribe from events
 * - once(event, listener) — subscribe to a single event occurrence
 * - emit(event, ...args) — trigger event listeners
 *
 * This implementation is intentionally minimal and does not include advanced
 * features like listener count limits, prepend, or error event handling.
 */

type EventListener = (...args: unknown[]) => void;

interface EventMap {
	[event: string]: EventListener[];
}

/**
 * Minimal EventEmitter for browser environments.
 * Provides a Node.js-compatible event subscription API.
 */
export class EventEmitter {
	private events: EventMap = {};

	/**
	 * Subscribe to an event.
	 *
	 * @param event - Event name
	 * @param listener - Callback function
	 * @returns This emitter (for chaining)
	 */
	on(event: string, listener: EventListener): this {
		if (!this.events[event]) {
			this.events[event] = [];
		}
		this.events[event]?.push(listener);
		return this;
	}

	/**
	 * Unsubscribe from an event.
	 *
	 * @param event - Event name
	 * @param listener - Callback function to remove
	 * @returns This emitter (for chaining)
	 */
	off(event: string, listener: EventListener): this {
		const listeners = this.events[event];
		if (!listeners) return this;

		const index = listeners.indexOf(listener);
		if (index !== -1) {
			listeners.splice(index, 1);
		}

		// Clean up empty listener arrays
		if (listeners.length === 0) {
			delete this.events[event];
		}

		return this;
	}

	/**
	 * Subscribe to an event for a single occurrence.
	 * The listener is automatically removed after it fires once.
	 *
	 * @param event - Event name
	 * @param listener - Callback function
	 * @returns This emitter (for chaining)
	 */
	once(event: string, listener: EventListener): this {
		const onceWrapper = (...args: unknown[]) => {
			this.off(event, onceWrapper);
			listener(...args);
		};
		return this.on(event, onceWrapper);
	}

	/**
	 * Emit an event, invoking all subscribed listeners.
	 *
	 * @param event - Event name
	 * @param args - Arguments to pass to listeners
	 * @returns True if the event had listeners, false otherwise
	 */
	emit(event: string, ...args: unknown[]): boolean {
		const listeners = this.events[event];
		if (!listeners || listeners.length === 0) {
			return false;
		}

		// Clone the listeners array to avoid issues if listeners modify subscriptions
		const listenersCopy = [...listeners];
		for (const listener of listenersCopy) {
			listener(...args);
		}

		return true;
	}

	/**
	 * Remove all listeners for a specific event, or all events if no event is specified.
	 *
	 * @param event - Optional event name. If omitted, removes all listeners.
	 * @returns This emitter (for chaining)
	 */
	removeAllListeners(event?: string): this {
		if (event) {
			delete this.events[event];
		} else {
			this.events = {};
		}
		return this;
	}

	/**
	 * Get the number of listeners for a specific event.
	 *
	 * @param event - Event name
	 * @returns Number of listeners
	 */
	listenerCount(event: string): number {
		const listeners = this.events[event];
		return listeners ? listeners.length : 0;
	}

	/**
	 * Get a copy of the listeners array for a specific event.
	 *
	 * @param event - Event name
	 * @returns Array of listeners
	 */
	listeners(event: string): EventListener[] {
		const listeners = this.events[event];
		return listeners ? [...listeners] : [];
	}
}
