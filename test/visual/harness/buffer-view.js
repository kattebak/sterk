/**
 * Buffer-view harness: a headless sterk terminal (no Ace) feeds a
 * ScreenSource, and the buffer view draws it. Exposes
 * `window.__bufferViewTest` for the Playwright spec.
 */
import { createTerminal } from "../../../dist/headless.js";
import {
	createBufferView,
	createTerminalScreenSource,
} from "../../../dist/index.js";

const container = document.getElementById("view");
let term;
let source;
let view;

function nextFrame() {
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
	});
}

async function settle() {
	await view.refresh();
	await nextFrame();
}

async function mount({ cols = 40, rows = 24, scrollback = 1000 } = {}) {
	view?.dispose();
	source?.dispose();
	term?.dispose();
	container.innerHTML = "";
	term = createTerminal({ cols, rows, scrollback });
	source = createTerminalScreenSource(term);
	view = createBufferView(container, source, {
		font: "",
		fontFamily: "monospace",
		fontSize: 14,
		theme: { foreground: "#d4d4d4", background: "#1e1e1e" },
	});
	await nextFrame();
	const metrics = view.getCellMetrics();
	if (metrics) container.style.height = `${metrics.height * rows}px`;
	await settle();
}

async function write(data) {
	term.write(data);
	await settle();
}

async function feedLines(count, from = 0) {
	const lines = [];
	for (let i = from; i < from + count; i++) {
		lines.push(`line ${i.toString().padStart(3, "0")}`);
	}
	await write(`${lines.join("\r\n")}\r\n`);
}

async function paintStatus(text) {
	await write(`\x1b7\x1b[${term.rows};1H\x1b[7m${text}\x1b[0m\x1b8`);
}

async function scrollLines(amount) {
	view.scrollLines(amount);
	await settle();
}

async function scrollToBottom() {
	view.scrollToBottom();
	await settle();
}

function renderedRows() {
	const layer = container.querySelector(".ace_text-layer");
	if (!layer) return [];
	const scroller = container.querySelector(".ace_scroller");
	const box = scroller?.getBoundingClientRect();
	const top = box?.top ?? Number.NEGATIVE_INFINITY;
	const bottom = box?.bottom ?? Number.POSITIVE_INFINITY;
	return Array.from(layer.querySelectorAll(".ace_line"))
		.filter((el) => {
			const lineTop = el.getBoundingClientRect().top;
			return lineTop >= top - 1 && lineTop < bottom - 1;
		})
		.sort(
			(a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
		)
		.map((el) => (el.textContent ?? "").trimEnd());
}

function state() {
	const buffer = term.buffer.active;
	const sourceRows = [];
	for (let i = view.viewportY; i < view.viewportY + term.rows; i++) {
		sourceRows.push(
			(buffer.getLine(i)?.translateToString(false) ?? "").trimEnd(),
		);
	}
	return {
		viewportY: view.viewportY,
		length: view.length,
		rows: term.rows,
		baseY: buffer.baseY,
		sourceRows,
	};
}

window.__bufferViewTest = {
	mount,
	feedLines,
	paintStatus,
	scrollLines,
	scrollToBottom,
	renderedRows,
	state,
	ready: mount(),
};
