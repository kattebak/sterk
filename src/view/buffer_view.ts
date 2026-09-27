import { DEFAULT_FONT_ID } from "../fonts/index.js";
import { AceSurface } from "../renderer/ace_surface.js";
import { InputHandler } from "../renderer/input.js";
import { LinkDetector } from "../renderer/links.js";
import { MouseHandler } from "../renderer/mouse.js";
import {
	applyTheme,
	clearTruecolorCache,
	injectTruecolorCss,
} from "../renderer/theme.js";
import {
	buildAttrsClassName,
	createTokenMode,
	type VtToken,
} from "../renderer/vt_mode.js";
import { loadBuiltinFont } from "../rendering.js";
import { builtinThemeToTheme, getBuiltinTheme } from "../themes/index.js";
import type { Disposable, ILinkProvider, Theme } from "../types.js";
import { EventEmitter } from "../util/event_emitter.js";
import {
	type ScreenChange,
	type ScreenLine,
	type ScreenSource,
	screenLineText,
} from "./screen_source.js";

export interface BufferViewOptions {
	theme?: Theme;
	/** Built-in font id; `""` opts out in favour of `fontFamily`. */
	font?: string;
	fontFamily?: string;
	fontSize?: number;
}

/**
 * Draws a {@link ScreenSource} it does not own. Rows are addressed in one
 * space: `0 .. history.length - 1` is scrollback, the screen follows.
 */
export interface BufferView extends Disposable {
	/** Row index of the topmost visible row. */
	readonly viewportY: number;
	/** Rows drawn: history plus screen. */
	readonly length: number;
	scrollLines(amount: number): void;
	scrollPages(pageCount: number): void;
	scrollToTop(): void;
	scrollToBottom(): void;
	scrollToLine(line: number): void;
	onScroll(callback: (viewportY: number) => void): Disposable;
	onRender(
		callback: (range: { start: number; end: number }) => void,
	): Disposable;
	/** Keyboard input, translated to the bytes a terminal would send. */
	onData(callback: (data: string) => void): Disposable;
	setTheme(themeId: string): void;
	setFont(fontId: string): void;
	/** Resolves once pending changes are drawn and Ace has repainted. */
	refresh(): Promise<void>;
	focus(): void;
	blur(): void;
	getCellMetrics(): { width: number; height: number } | null;
	getViewportCellCount(): { cols: number; rows: number } | null;
	hasSelection(): boolean;
	/** The selected text; a wrapped row joins the row above without a newline. */
	getSelection(): string;
	getSelectionPosition():
		| { start: { x: number; y: number }; end: { x: number; y: number } }
		| undefined;
	clearSelection(): void;
	selectAll(): void;
	/** Select `length` cells from `column` on viewport-relative `row`. */
	select(column: number, row: number, length: number): void;
	/** Select rows `start..end` inclusive. */
	selectLines(start: number, end: number): void;
	onSelectionChange(callback: () => void): Disposable;
	/** Providers receive 1-based row numbers in the view's row space. */
	registerLinkProvider(provider: ILinkProvider): Disposable;
}

interface PendingChange {
	removedTop: number;
	appended: number;
	screenRows: Set<number>;
	full: boolean;
}

function emptyPending(): PendingChange {
	return { removedTop: 0, appended: 0, screenRows: new Set(), full: false };
}

function lineTokens(line: ScreenLine | undefined): VtToken[] {
	if (!line) return [];
	return line.runs
		.filter((run) => run.text.length > 0)
		.map((run) => ({ type: buildAttrsClassName(run.attrs), value: run.text }));
}

function injectLineColors(line: ScreenLine): void {
	for (const { attrs } of line.runs) {
		if (attrs.fgMode === "Rgb") {
			injectTruecolorCss(attrs.fg, attrs.inverse ? "bg" : "fg");
		}
		if (attrs.bgMode === "Rgb") {
			injectTruecolorCss(attrs.bg, attrs.inverse ? "fg" : "bg");
		}
	}
}

function subscription(
	emitter: EventEmitter,
	event: string,
	listener: (...args: unknown[]) => void,
): Disposable {
	emitter.on(event, listener);
	return { dispose: () => emitter.off(event, listener) };
}

class BufferViewImpl extends AceSurface implements BufferView {
	private readonly emitter = new EventEmitter();
	private lines: ScreenLine[] = [];
	private historyLength = 0;
	private drawnRows = 0;
	private drawnCols = 0;
	private top = 0;
	private pending: PendingChange = emptyPending();
	private readonly sourceSubscription: Disposable;
	private readonly inputHandler: InputHandler;
	private readonly mouseHandler: MouseHandler;
	private readonly linkDetector: LinkDetector;

	constructor(
		container: HTMLElement,
		private readonly source: ScreenSource,
		fontSize: number,
		fontFamily: string,
		theme: Theme,
		readonly lineAt: { current: (row: number) => ScreenLine | undefined },
	) {
		super(
			container,
			fontSize,
			fontFamily,
			createTokenMode((row) => lineTokens(lineAt.current(row))),
		);
		lineAt.current = (row) => this.lines[row];
		applyTheme(theme);

		const element = this.getElement();
		this.inputHandler = new InputHandler(element);
		this.inputHandler.onData((data) => this.emitter.emit("data", data));
		this.mouseHandler = new MouseHandler(element, () => this.getCellMetrics());
		this.mouseHandler.onScroll((lines) => this.scrollLines(lines));
		this.linkDetector = new LinkDetector(
			element,
			() => ({
				viewportY: this.top,
				getLine: (row) => {
					const line = this.lines[row];
					if (!line) return null;
					const text = screenLineText(line);
					return { translateToString: () => text };
				},
			}),
			() => this.getCellMetrics(),
		);

		this.rebuild();
		this.top = this.maxTop();
		this.updateCursor();
		this.scrollDocumentTo(this.top);
		this.sourceSubscription = source.subscribe((change) =>
			this.enqueue(change),
		);
	}

	get viewportY(): number {
		return this.top;
	}

	get length(): number {
		return this.lines.length;
	}

	private maxTop(): number {
		return Math.max(0, this.lines.length - this.drawnRows);
	}

	private enqueue(change: ScreenChange): void {
		const pending = this.pending;
		pending.full ||= change.full;
		pending.removedTop += change.history.removedTop;
		pending.appended += change.history.appended;
		for (const row of change.screenRows) pending.screenRows.add(row);
		this.scheduleUpdate();
	}

	protected flush(): void {
		const pending = this.pending;
		this.pending = emptyPending();
		const followed = this.top >= this.maxTop();
		const before = this.top;
		const removed = pending.full ? null : this.applyIncremental(pending);
		if (removed === null) this.rebuild();
		const target = followed
			? this.maxTop()
			: Math.min(this.maxTop(), Math.max(0, before - (removed ?? 0)));
		this.top = target;
		this.updateCursor();
		this.scrollDocumentTo(this.top);
		this.emitter.emit("render", {
			start: 0,
			end: Math.max(0, this.drawnRows - 1),
		});
		if (this.top !== before) this.emitter.emit("scroll", this.top);
	}

	/**
	 * Apply a merged change to the document. Returns the rows dropped from
	 * the top, or `null` when the change does not add up and the document
	 * must be rebuilt from the source.
	 */
	private applyIncremental(pending: PendingChange): number | null {
		const source = this.source;
		if (source.rows !== this.drawnRows || source.cols !== this.drawnCols) {
			return null;
		}
		const doc = this.session.getDocument();
		const removed = Math.min(this.historyLength, pending.removedTop);
		const kept = this.historyLength - removed;
		const appended = source.history.length - kept;
		const expected =
			pending.appended - Math.max(0, pending.removedTop - this.historyLength);
		if (appended !== expected) return null;

		if (removed > 0) {
			doc.removeFullLines(0, removed - 1);
			this.lines.splice(0, removed);
		}
		if (appended > 0) {
			const added: ScreenLine[] = [];
			for (let i = kept; i < source.history.length; i++) {
				added.push(source.history.line(i));
			}
			for (const line of added) injectLineColors(line);
			this.lines.splice(kept, 0, ...added);
			doc.insertFullLines(kept, added.map(screenLineText));
		}
		this.historyLength = source.history.length;

		for (const row of pending.screenRows) {
			if (row < 0 || row >= this.drawnRows) continue;
			this.replaceRow(this.historyLength + row, source.screen.line(row));
		}
		return removed;
	}

	private replaceRow(index: number, line: ScreenLine): void {
		injectLineColors(line);
		this.lines[index] = line;
		const doc = this.session.getDocument();
		const text = screenLineText(line);
		const current = doc.getLine(index) ?? "";
		if (text === current) {
			this.retokenizeRow(index);
			return;
		}
		doc.removeInLine(index, 0, current.length);
		doc.insertInLine({ row: index, column: 0 }, text);
	}

	private rebuild(): void {
		const source = this.source;
		const lines: ScreenLine[] = [];
		for (let i = 0; i < source.history.length; i++) {
			lines.push(source.history.line(i));
		}
		for (let row = 0; row < source.rows; row++) {
			lines.push(source.screen.line(row));
		}
		for (const line of lines) injectLineColors(line);
		this.lines = lines;
		this.historyLength = source.history.length;
		this.drawnRows = source.rows;
		this.drawnCols = source.cols;
		this.session.getDocument().setValue(lines.map(screenLineText).join("\n"));
	}

	private updateCursor(): void {
		const { x, y, visible } = this.source.cursor;
		const row = Math.max(
			0,
			Math.min(this.historyLength + y, this.lines.length - 1),
		);
		this.editor.moveCursorTo(row, Math.max(0, x));
		if (visible) {
			this.editor.renderer.showCursor();
			return;
		}
		this.editor.renderer.hideCursor();
	}

	private scrollTo(row: number): void {
		const target = Math.min(this.maxTop(), Math.max(0, Math.round(row)));
		if (target === this.top) return;
		this.top = target;
		this.scrollDocumentTo(target);
		this.emitter.emit("scroll", target);
	}

	scrollLines(amount: number): void {
		this.scrollTo(this.top + amount);
	}

	scrollPages(pageCount: number): void {
		this.scrollLines(pageCount * this.drawnRows);
	}

	scrollToTop(): void {
		this.scrollTo(0);
	}

	scrollToBottom(): void {
		this.scrollTo(this.maxTop());
	}

	scrollToLine(line: number): void {
		this.scrollTo(line);
	}

	onScroll(callback: (viewportY: number) => void): Disposable {
		return subscription(this.emitter, "scroll", (top) => {
			if (typeof top === "number") callback(top);
		});
	}

	onRender(
		callback: (range: { start: number; end: number }) => void,
	): Disposable {
		return subscription(this.emitter, "render", (range) => {
			callback(range as { start: number; end: number });
		});
	}

	onData(callback: (data: string) => void): Disposable {
		return subscription(this.emitter, "data", (data) => {
			if (typeof data === "string") callback(data);
		});
	}

	setTheme(themeId: string): void {
		applyTheme(builtinThemeToTheme(getBuiltinTheme(themeId)));
		clearTruecolorCache();
		for (const line of this.lines) injectLineColors(line);
		this.scheduleUpdate();
	}

	setFont(fontId: string): void {
		this.setFontFamily(loadBuiltinFont(fontId).family);
		this.scheduleUpdate();
	}

	async refresh(): Promise<void> {
		await this.scheduleUpdate();
		this.forceRepaint();
	}

	getSelection(): string {
		const range = this.getSelectionRange();
		if (!range) return "";
		const rows = this.getSelectedText().split("\n");
		let text = rows[0] ?? "";
		for (let i = 1; i < rows.length; i++) {
			const wrapped = this.lines[range.start.row + i]?.wrapped ?? false;
			text += `${wrapped ? "" : "\n"}${rows[i]}`;
		}
		return text;
	}

	getSelectionPosition():
		| { start: { x: number; y: number }; end: { x: number; y: number } }
		| undefined {
		const range = this.getSelectionRange();
		if (!range) return undefined;
		return {
			start: { x: range.start.column, y: range.start.row },
			end: { x: range.end.column, y: range.end.row },
		};
	}

	select(column: number, row: number, length: number): void {
		const index = this.top + row;
		this.setSelectionRange(index, column, index, column + length);
	}

	selectLines(start: number, end: number): void {
		const lo = Math.min(start, end);
		const hi = Math.max(start, end);
		const endRow = Math.min(hi + 1, this.getDocumentLength() - 1);
		const endColumn = endRow > hi ? 0 : Number.MAX_SAFE_INTEGER;
		this.setSelectionRange(lo, 0, endRow, endColumn);
	}

	onSelectionChange(callback: () => void): Disposable {
		const unsubscribe = this.listenSelection(callback);
		return { dispose: unsubscribe };
	}

	registerLinkProvider(provider: ILinkProvider): Disposable {
		return { dispose: this.linkDetector.addProvider(provider) };
	}

	override dispose(): void {
		if (this.disposed) return;
		this.sourceSubscription.dispose();
		this.inputHandler.dispose();
		this.mouseHandler.dispose();
		this.linkDetector.dispose();
		super.dispose();
		this.emitter.removeAllListeners();
	}
}

/**
 * Mount a view that draws `source` into `container`. The view keeps its
 * own scroll position: it follows new output while at the bottom and
 * holds the same rows in place while scrolled up, including when rows are
 * trimmed from the top of the history.
 */
export function createBufferView(
	container: HTMLElement,
	source: ScreenSource,
	options: BufferViewOptions = {},
): BufferView {
	const font = options.font ?? DEFAULT_FONT_ID;
	const fontFamily =
		font === ""
			? (options.fontFamily ?? "monospace")
			: loadBuiltinFont(font).family;
	return new BufferViewImpl(
		container,
		source,
		options.fontSize ?? 13,
		fontFamily,
		options.theme ?? {},
		{ current: () => undefined },
	);
}
