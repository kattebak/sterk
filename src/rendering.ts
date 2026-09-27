import {
	DEFAULT_FONT_ID,
	getBuiltinFont,
	injectFontFace,
} from "./fonts/index.js";
import { AceRenderer } from "./renderer/ace_renderer.js";
import { InputHandler } from "./renderer/input.js";
import { LinkDetector } from "./renderer/links.js";
import { MouseHandler } from "./renderer/mouse.js";
import type { TerminalRendering } from "./terminal.js";

export function loadBuiltinFont(fontId: string): {
	id: string;
	family: string;
} {
	const font = getBuiltinFont(fontId);
	injectFontFace(font);
	return { id: font.id, family: `'${font.family}', monospace` };
}

export const ACE_RENDERING: TerminalRendering = {
	defaultFont: DEFAULT_FONT_ID,
	loadFont: loadBuiltinFont,
	createRenderer: (container, buffer, fontSize, fontFamily) =>
		new AceRenderer(container, buffer, fontSize, fontFamily),
	createInputHandler: (element) => new InputHandler(element),
	createMouseHandler: (element, getCellMetrics) =>
		new MouseHandler(element, getCellMetrics),
	createLinkDetector: (element, buffer, getCellMetrics) =>
		new LinkDetector(element, buffer, getCellMetrics),
};
