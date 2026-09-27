import type { Buffer, Disposable, Terminal } from "../types.js";
import {
	type ScreenChange,
	type ScreenLine,
	type ScreenSource,
	screenLineFromCells,
} from "./screen_source.js";

const BLANK_LINE: ScreenLine = { runs: [], wrapped: false };

interface Snapshot {
	type: Buffer["type"];
	rows: number;
	cols: number;
	baseY: number;
	historyLength: number;
	screen: string[];
	cursor: string;
}

function lineKey(line: ScreenLine): string {
	return JSON.stringify(line);
}

/**
 * Reference {@link ScreenSource} over a sterk terminal, typically a
 * headless one. It diffs the terminal after each parsed write: rows
 * trimmed from the top are read off `baseY`, rows added to the history off
 * its length, and screen rows by comparing each row with the last one it
 * reported. A buffer switch, a resize or a clear is reported as `full`.
 */
export function createTerminalScreenSource(
	term: Terminal,
): ScreenSource & Disposable {
	const listeners = new Set<(change: ScreenChange) => void>();

	const historyLength = (): number =>
		Math.max(0, term.buffer.active.length - term.rows);
	const lineAt = (index: number): ScreenLine => {
		const line = term.buffer.active.getLine(index);
		return line ? screenLineFromCells(line, term.cols) : BLANK_LINE;
	};
	const cursor = (): ScreenSource["cursor"] => {
		const buffer = term.buffer.active;
		return {
			x: buffer.cursorX,
			y: buffer.cursorY - (buffer.length - term.rows),
			visible: true,
		};
	};

	const snapshot = (): Snapshot => {
		const buffer = term.buffer.active;
		const history = historyLength();
		const screen: string[] = [];
		for (let row = 0; row < term.rows; row++) {
			screen.push(lineKey(lineAt(history + row)));
		}
		return {
			type: buffer.type,
			rows: term.rows,
			cols: term.cols,
			baseY: buffer.baseY,
			historyLength: history,
			screen,
			cursor: JSON.stringify(cursor()),
		};
	};

	const describe = (before: Snapshot, after: Snapshot): ScreenChange | null => {
		const full: ScreenChange = {
			history: { removedTop: 0, appended: 0 },
			screenRows: [],
			full: true,
		};
		if (
			before.type !== after.type ||
			before.rows !== after.rows ||
			before.cols !== after.cols
		) {
			return full;
		}
		const trimmed = after.baseY - before.baseY;
		if (trimmed < 0) return full;
		const removedTop = Math.min(trimmed, before.historyLength);
		const appended = after.historyLength - (before.historyLength - removedTop);
		if (appended < 0) return full;
		const screenRows: number[] = [];
		after.screen.forEach((key, row) => {
			if (key !== before.screen[row]) screenRows.push(row);
		});
		const unchanged =
			removedTop === 0 &&
			appended === 0 &&
			screenRows.length === 0 &&
			before.cursor === after.cursor;
		if (unchanged) return null;
		return { history: { removedTop, appended }, screenRows, full: false };
	};

	let last = snapshot();
	const check = (): void => {
		const next = snapshot();
		const change = describe(last, next);
		last = next;
		if (!change) return;
		for (const listener of listeners) listener(change);
	};

	const watchers = [term.onWriteParsed(check), term.onResize(check)];

	return {
		get rows() {
			return term.rows;
		},
		get cols() {
			return term.cols;
		},
		history: {
			get length() {
				return historyLength();
			},
			line: (index: number) => lineAt(index),
		},
		screen: {
			line: (row: number) => lineAt(historyLength() + row),
		},
		get cursor() {
			return cursor();
		},
		subscribe(listener: (change: ScreenChange) => void): Disposable {
			listeners.add(listener);
			return { dispose: () => listeners.delete(listener) };
		},
		dispose(): void {
			for (const watcher of watchers) watcher.dispose();
			listeners.clear();
		},
	};
}
