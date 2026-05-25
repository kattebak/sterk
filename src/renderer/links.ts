/**
 * Link detection — scan buffer for URLs and file paths
 *
 * Emits hover/click events for detected links.
 * Supports:
 * - HTTP(S) URLs
 * - File paths (absolute)
 */

import type { Buffer, ILinkProvider, IProvidedLink } from "../types.js";

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
	/**
	 * Optional activation handler for provider-supplied links. When present,
	 * the link detector invokes it on click (in addition to emitting the
	 * generic click event), passing the originating mouse event.
	 */
	activate?: (event: MouseEvent | undefined, text: string) => void;
}

/** A provider-supplied link source. */
export type LinkProvider = ILinkProvider;

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
	/** Registered external link providers (xterm.js parity). */
	private providers: ILinkProvider[] = [];

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
	 * Register an external link provider. Returns an unregister function.
	 * Provider links are consulted lazily per-row during hover hit-testing
	 * (see {@link queryProviderLinksForRow}), so the provider is honoured
	 * whether registered before or after the renderer is attached.
	 */
	addProvider(provider: ILinkProvider): () => void {
		this.providers.push(provider);
		return () => {
			const idx = this.providers.indexOf(provider);
			if (idx !== -1) this.providers.splice(idx, 1);
		};
	}

	/**
	 * Query all registered providers for links on a given ABSOLUTE buffer row
	 * and map the provider's 1-based buffer coordinates onto the detector's
	 * 0-based absolute-row / column model. Providers may invoke their callback
	 * synchronously or asynchronously; only synchronously-delivered links are
	 * available for the current hover hit-test (matching the synchronous
	 * nature of mouse-move dispatch). xterm.js link providers in practice
	 * resolve synchronously for already-rendered buffer content.
	 */
	private queryProviderLinksForRow(absRow: number): Link[] {
		if (this.providers.length === 0) return [];
		const collected: Link[] = [];
		// xterm.js buffer line numbers are 1-based.
		const bufferLineNumber = absRow + 1;
		for (const provider of this.providers) {
			provider.provideLinks(bufferLineNumber, (links) => {
				if (!links) return;
				for (const link of links) {
					collected.push(this.providedLinkToLink(link));
				}
			});
		}
		return collected;
	}

	/**
	 * Convert an xterm.js-style provided link (1-based buffer coords) into the
	 * detector's internal {@link Link} (0-based absolute row, 0-based
	 * half-open column range). Single-line links are assumed (the common
	 * case); for a multi-line range we clamp to the start line's span.
	 */
	private providedLinkToLink(link: IProvidedLink): Link {
		const row = link.range.start.y - 1;
		const startCol = Math.max(0, link.range.start.x - 1);
		// endCol is half-open (exclusive). xterm.js end.x is the inclusive
		// 1-based last column, so the exclusive 0-based end is end.x.
		const endCol =
			link.range.end.y === link.range.start.y
				? Math.max(startCol + 1, link.range.end.x)
				: startCol + link.text.length;
		return {
			type: "url",
			text: link.text,
			row,
			startCol,
			endCol,
			activate: link.activate,
		};
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

		// Find a built-in detected link at this position, falling back to any
		// provider-supplied link for the hovered row. Provider links take
		// precedence (consumers register them to override / augment detection).
		const providerLinks = this.queryProviderLinksForRow(row);
		const link =
			providerLinks.find(
				(l) => l.row === row && col >= l.startCol && col < l.endCol,
			) ??
			this.links.find(
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
	private handleClick = (event: MouseEvent): void => {
		if (!this.hoveredLink) return;
		// Provider-supplied links carry their own activation handler — invoke
		// it (xterm.js semantics) in addition to the generic click event so
		// existing consumers of onClick still fire.
		this.hoveredLink.activate?.(event, this.hoveredLink.text);
		if (this.onClickCallback) {
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
		this.providers = [];
	}
}
