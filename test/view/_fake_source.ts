import type {
	ScreenAttrs,
	ScreenChange,
	ScreenLine,
	ScreenSource,
} from "../../src/index.js";

export const PLAIN: ScreenAttrs = {
	fgMode: "Default",
	fg: -1,
	bgMode: "Default",
	bg: -1,
	bold: false,
	italic: false,
	underline: false,
	dim: false,
	inverse: false,
	invisible: false,
	strikethrough: false,
	blink: false,
};

export function line(
	text: string,
	attrs: Partial<ScreenAttrs> = {},
	wrapped = false,
): ScreenLine {
	return { runs: [{ text, attrs: { ...PLAIN, ...attrs } }], wrapped };
}

export class FakeSource implements ScreenSource {
	historyLines: ScreenLine[] = [];
	screenLines: ScreenLine[];
	cursor = { x: 0, y: 0, visible: true };
	private listeners = new Set<(change: ScreenChange) => void>();

	constructor(
		public rows: number,
		public cols = 20,
	) {
		this.screenLines = Array.from({ length: rows }, (_, i) =>
			line(`screen ${i}`),
		);
	}

	get history(): ScreenSource["history"] {
		const lines = this.historyLines;
		return {
			length: lines.length,
			line: (index: number): ScreenLine => lines[index] ?? line(""),
		};
	}

	readonly screen = {
		line: (row: number): ScreenLine => this.screenLines[row] ?? line(""),
	};

	subscribe(listener: (change: ScreenChange) => void) {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	}

	emit(
		change: Partial<ScreenChange> & { history?: ScreenChange["history"] },
	): void {
		const full: ScreenChange = {
			history: change.history ?? { removedTop: 0, appended: 0 },
			screenRows: change.screenRows ?? [],
			full: change.full ?? false,
		};
		for (const listener of this.listeners) listener(full);
	}

	appendHistory(texts: string[]): void {
		for (const text of texts) this.historyLines.push(line(text));
		this.emit({ history: { removedTop: 0, appended: texts.length } });
	}

	trimHistory(count: number): void {
		this.historyLines.splice(0, count);
		this.emit({ history: { removedTop: count, appended: 0 } });
	}

	get listenerCount(): number {
		return this.listeners.size;
	}
}

export function numbered(prefix: string, count: number, from = 0): string[] {
	return Array.from({ length: count }, (_, i) => `${prefix} ${from + i}`);
}
