/**
 * Link detection — scan buffer for URLs and file paths
 *
 * Emits hover/click events for detected links.
 * Supports:
 * - HTTP(S) URLs
 * - File paths (absolute)
 */

import type { Buffer } from "../types.js";

/**
 * URL pattern (simplified - matches http:// and https://)
 */
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

/**
 * File path pattern (absolute paths only)
 */
const FILE_PATH_PATTERN = /(?:\/[a-zA-Z0-9_.-]+)+/g;

/**
 * Link type
 */
export type LinkType = "url" | "file";

/**
 * Detected link
 */
export interface Link {
	type: LinkType;
	text: string;
	row: number;
	startCol: number;
	endCol: number;
}

/**
 * Scan a buffer line for links
 *
 * @param text - Line text
 * @param row - Line row number
 * @returns Array of detected links
 */
export function scanLineForLinks(text: string, row: number): Link[] {
	const links: Link[] = [];

	// Scan for URLs
	URL_PATTERN.lastIndex = 0; // Reset regex state
	let match = URL_PATTERN.exec(text);
	while (match !== null) {
		links.push({
			type: "url",
			text: match[0],
			row,
			startCol: match.index,
			endCol: match.index + match[0].length,
		});
		match = URL_PATTERN.exec(text);
	}

	// Scan for file paths
	FILE_PATH_PATTERN.lastIndex = 0;
	match = FILE_PATH_PATTERN.exec(text);
	while (match !== null) {
		// Skip if overlaps with a URL
		const overlaps = links.some(
			(link) =>
				link.row === row &&
				match &&
				match.index < link.endCol &&
				match.index + match[0].length > link.startCol,
		);
		if (!overlaps && match) {
			links.push({
				type: "file",
				text: match[0],
				row,
				startCol: match.index,
				endCol: match.index + match[0].length,
			});
		}
		match = FILE_PATH_PATTERN.exec(text);
	}

	return links;
}

/**
 * Scan visible buffer region for links
 *
 * @param buffer - Terminal buffer
 * @param startRow - Start row (absolute)
 * @param endRow - End row (absolute, inclusive)
 * @returns Array of detected links
 */
export function scanBufferForLinks(
	buffer: Buffer,
	startRow: number,
	endRow: number,
): Link[] {
	const links: Link[] = [];

	for (let row = startRow; row <= endRow; row++) {
		const line = buffer.getLine(row);
		if (!line) continue;

		const text = line.translateToString(true);
		const lineLinks = scanLineForLinks(text, row);
		links.push(...lineLinks);
	}

	return links;
}

/**
 * Link detector class
 * Manages hover state and emits link events
 */
export class LinkDetector {
	private links: Link[] = [];
	private hoveredLink: Link | null = null;
	private onHoverCallback: ((link: Link | null) => void) | null = null;
	private onClickCallback: ((link: Link) => void) | null = null;

	constructor(
		private element: HTMLElement,
		private buffer: () => Buffer,
		private getCellMetrics: () => { width: number; height: number } | null,
	) {
		element.addEventListener("mousemove", this.handleMouseMove);
		element.addEventListener("click", this.handleClick);
	}

	/**
	 * Set the hover callback
	 */
	onHover(callback: (link: Link | null) => void): void {
		this.onHoverCallback = callback;
	}

	/**
	 * Set the click callback
	 */
	onClick(callback: (link: Link) => void): void {
		this.onClickCallback = callback;
	}

	/**
	 * Update link cache (call after buffer changes)
	 */
	updateLinks(startRow: number, endRow: number): void {
		this.links = scanBufferForLinks(this.buffer(), startRow, endRow);
	}

	/**
	 * Handle mouse move - detect link hover
	 */
	private handleMouseMove = (event: MouseEvent): void => {
		const metrics = this.getCellMetrics();
		if (!metrics) return;

		const rect = this.element.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;

		const col = Math.floor(x / metrics.width);
		const row = Math.floor(y / metrics.height) + this.buffer().viewportY;

		// Find link at this position
		const link = this.links.find(
			(l) => l.row === row && col >= l.startCol && col < l.endCol,
		);

		if (link !== this.hoveredLink) {
			this.hoveredLink = link ?? null;
			if (this.onHoverCallback) {
				this.onHoverCallback(this.hoveredLink);
			}

			// Update cursor style
			this.element.style.cursor = link ? "pointer" : "text";
		}
	};

	/**
	 * Handle click - emit link click event
	 */
	private handleClick = (): void => {
		if (this.hoveredLink && this.onClickCallback) {
			this.onClickCallback(this.hoveredLink);
		}
	};

	/**
	 * Clean up event listeners
	 */
	dispose(): void {
		this.element.removeEventListener("mousemove", this.handleMouseMove);
		this.element.removeEventListener("click", this.handleClick);
		this.onHoverCallback = null;
		this.onClickCallback = null;
	}
}
