/**
 * Alternate screen renderer tests
 *
 * Verifies that switching between normal and alternate buffers
 * correctly updates the rendered DOM content.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTerminal } from "../../src/index.js";
import type { Terminal } from "../../src/types.js";

/**
 * Helper to get text content from the Ace editor
 * (walks the document lines rather than scraping DOM)
 */
function getRenderedText(term: Terminal): string {
	const renderer = term.renderer as unknown as {
		getEditor?: () => {
			getSession: () => {
				getDocument: () => {
					getLength: () => number;
					getLine: (i: number) => string;
				};
			};
		};
	};
	if (!renderer) return "";

	const editor = renderer.getEditor?.();
	if (!editor) return "";

	const session = editor.getSession();
	const doc = session.getDocument();
	const lines: string[] = [];

	for (let i = 0; i < doc.getLength(); i++) {
		lines.push(doc.getLine(i) || "");
	}

	return lines.join("\n");
}

/**
 * Helper to get cursor position from the Ace editor
 */
function getCursorPosition(term: Terminal): { row: number; column: number } {
	const renderer = term.renderer as unknown as {
		getEditor?: () => {
			getCursorPosition: () => { row: number; column: number };
		};
	};
	if (!renderer) return { row: 0, column: 0 };

	const editor = renderer.getEditor?.();
	if (!editor) return { row: 0, column: 0 };

	const pos = editor.getCursorPosition();
	return pos;
}

describe("Alternate screen renderer", () => {
	let container: HTMLElement;
	let term: Terminal | null = null;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		if (term) {
			term.dispose?.();
			term = null;
		}
		if (container.parentNode) {
			container.parentNode.removeChild(container);
		}
	});

	it("renders alternate buffer content, not normal buffer", () => {
		term = createTerminal({ cols: 40, rows: 5 });
		term.open?.(container);

		// Write to normal buffer
		term.write("Normal buffer content");

		// Wait for render
		return new Promise<void>((resolve) => {
			setTimeout(() => {
				const normalText = getRenderedText(term!);
				expect(normalText).toContain("Normal buffer content");

				// Switch to alternate screen
				term?.write("\x1b[?1049h");

				// Write to alternate buffer
				term?.write("Alternate buffer content");

				setTimeout(() => {
					const altText = getRenderedText(term!);
					expect(altText).toContain("Alternate buffer content");
					expect(altText).not.toContain("Normal buffer content");

					// Switch back to normal
					term?.write("\x1b[?1049l");

					setTimeout(() => {
						const backToNormalText = getRenderedText(term!);
						expect(backToNormalText).toContain("Normal buffer content");
						expect(backToNormalText).not.toContain("Alternate buffer content");

						resolve();
					}, 50);
				}, 50);
			}, 50);
		});
	});

	it("renders cursor position from active buffer", () => {
		term = createTerminal({ cols: 20, rows: 5 });
		term.open?.(container);

		// Write some text and position cursor
		term.write("Line 1\nLine 2");
		term.write("\x1b[2;5H"); // Move to row 2, col 5 (1-indexed)

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				let cursor = getCursorPosition(term!);
				expect(cursor.row).toBe(1); // 0-indexed
				expect(cursor.column).toBe(4); // 0-indexed

				// Switch to alternate screen
				term?.write("\x1b[?1049h");

				// Cursor should be at (0, 0) after clear
				setTimeout(() => {
					cursor = getCursorPosition(term!);
					expect(cursor.row).toBe(0);
					expect(cursor.column).toBe(0);

					// Write and move cursor in alt buffer
					term?.write("Alt text");
					term?.write("\x1b[1;4H"); // Row 1, col 4

					setTimeout(() => {
						cursor = getCursorPosition(term!);
						expect(cursor.row).toBe(0); // 0-indexed
						expect(cursor.column).toBe(3); // 0-indexed

						// Switch back to normal
						term?.write("\x1b[?1049l");

						setTimeout(() => {
							// Cursor should be restored to (1, 4) from saved state
							cursor = getCursorPosition(term!);
							expect(cursor.row).toBe(1);
							expect(cursor.column).toBe(4);

							resolve();
						}, 50);
					}, 50);
				}, 50);
			}, 50);
		});
	});

	it("simulates vim usage with full-screen rewrite", () => {
		term = createTerminal({ cols: 40, rows: 10 });
		term.open?.(container);

		// Shell prompt
		term.write("$ vim file.txt\n");

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				const shellText = getRenderedText(term!);
				expect(shellText).toContain("$ vim file.txt");

				// Enter vim (alt screen)
				term?.write("\x1b[?1049h");

				// Clear and write vim UI
				term?.write("\x1b[2J\x1b[H"); // Clear screen, home cursor
				term?.write("~\n~\n~\n~\n~\n");
				term?.write("file.txt                            \n");
				term?.write('"file.txt" [New File]               ');

				setTimeout(() => {
					const vimText = getRenderedText(term!);
					expect(vimText).toMatch(/~/);
					expect(vimText).toContain("file.txt");
					expect(vimText).not.toContain("$ vim file.txt");

					// Exit vim
					term?.write("\x1b[?1049l");

					setTimeout(() => {
						const backToShellText = getRenderedText(term!);
						expect(backToShellText).toContain("$ vim file.txt");
						expect(backToShellText).not.toContain("[New File]");

						resolve();
					}, 50);
				}, 50);
			}, 50);
		});
	});

	it("preserves normal buffer content across multiple switches", () => {
		term = createTerminal({ cols: 30, rows: 5 });
		term.open?.(container);

		// Write to normal buffer
		term.write("Persistent normal content\n");
		term.write("Line 2\n");

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				// Switch to alt and back multiple times
				term?.write("\x1b[?1047h"); // Enter alt
				term?.write("Alt content 1");

				setTimeout(() => {
					term?.write("\x1b[?1047l"); // Back to normal

					setTimeout(() => {
						const text1 = getRenderedText(term!);
						expect(text1).toContain("Persistent normal content");

						// Switch again
						term?.write("\x1b[?1047h");
						term?.write("Alt content 2");

						setTimeout(() => {
							term?.write("\x1b[?1047l");

							setTimeout(() => {
								const text2 = getRenderedText(term!);
								expect(text2).toContain("Persistent normal content");
								expect(text2).toContain("Line 2");

								resolve();
							}, 50);
						}, 50);
					}, 50);
				}, 50);
			}, 50);
		});
	});

	it("handles DECSET 1047 (switch without save/restore)", () => {
		term = createTerminal({ cols: 25, rows: 5 });
		term.open?.(container);

		term.write("Normal screen");

		return new Promise<void>((resolve) => {
			setTimeout(() => {
				term?.write("\x1b[?1047h"); // Switch to alt (no cursor save)
				term?.write("Alt screen");

				setTimeout(() => {
					const altText = getRenderedText(term!);
					expect(altText).toContain("Alt screen");
					expect(altText).not.toContain("Normal screen");

					term?.write("\x1b[?1047l"); // Switch back

					setTimeout(() => {
						const normalText = getRenderedText(term!);
						expect(normalText).toContain("Normal screen");

						resolve();
					}, 50);
				}, 50);
			}, 50);
		});
	});
});
