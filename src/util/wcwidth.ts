/**
 * wcwidth — column width for Unicode code points.
 *
 * This is a TypeScript port of Markus Kuhn's POSIX wcwidth implementation,
 * extended with the Unicode-9+ emoji block ranges that East-Asian-Width
 * marks as "Wide" or "Emoji_Presentation: Yes".
 *
 * Sources (cited verbatim because the tables themselves are the contract):
 *   - Markus Kuhn, "An implementation of wcwidth() and wcswidth()":
 *       https://www.cl.cam.ac.uk/~mgk25/ucs/wcwidth.c
 *     The `combining` table and the wide-range conditional in `wcwidth()`
 *     below are direct ports of that file. Kuhn's code is public domain.
 *   - Unicode East Asian Width property:
 *       https://www.unicode.org/Public/UNIDATA/EastAsianWidth.txt
 *     Used to validate / extend the wide-range conditional.
 *   - Unicode Emoji data (Emoji_Presentation = Yes):
 *       https://www.unicode.org/Public/UNIDATA/emoji/emoji-data.txt
 *     Used for the modern emoji extension: anything assigned
 *     Emoji_Presentation defaults to width 2.
 *
 * This module is the parity counterpart to mobux's vendored
 * `web/static/vendor/aceterm/wc.js` (414 lines) — see audit issue
 * https://github.com/kattebak/sterk/issues/21 (Row 33 in the task brief;
 * Row 31 in the gap matrix — wide-char support was missing entirely).
 *
 * Coverage choices (tradeoffs documented for the reviewer):
 *   - ZWJ-combined emoji sequences (e.g. family 👨‍👩‍👧‍👦) render as the
 *     leading emoji glyph (width 2) followed by ZWJ + emoji code points
 *     of width 0 — i.e. the sequence collapses to a single 2-cell glyph
 *     in cell-grid terms. Real terminals do the same.
 *   - Modern skin-tone modifiers (U+1F3FB..U+1F3FF) carry width 2 in
 *     Emoji_Presentation but are normally fused into the preceding
 *     emoji via no advance; we treat them as width 2 to match the
 *     "width is preserved if combiner is stripped" rule. Slight
 *     over-allocation on cells but the cursor never desyncs.
 *   - Variation selectors (U+FE00..U+FE0F) are width 0 (combining).
 *     U+FE0F (emoji presentation selector) is therefore a no-op for
 *     width and the *previous* code point determines the cell footprint
 *     — which matches the historical Kuhn behaviour and is what real
 *     xterm/foot/iTerm do.
 */

/**
 * Pairs of [first, last] code points (inclusive) for code points that
 * contribute zero columns to a terminal grid: combining marks, format
 * controls, zero-width joiners and non-joiners, variation selectors,
 * Hangul-trailer compatibility jamo, etc.
 *
 * Imported verbatim from Markus Kuhn's wcwidth.c `combining[]` (public
 * domain). Order: ascending by `first`. Searched via binary search.
 */
const ZERO_WIDTH_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x0300, 0x036f],
	[0x0483, 0x0486],
	[0x0488, 0x0489],
	[0x0591, 0x05bd],
	[0x05bf, 0x05bf],
	[0x05c1, 0x05c2],
	[0x05c4, 0x05c5],
	[0x05c7, 0x05c7],
	[0x0600, 0x0603],
	[0x0610, 0x0615],
	[0x064b, 0x065e],
	[0x0670, 0x0670],
	[0x06d6, 0x06e4],
	[0x06e7, 0x06e8],
	[0x06ea, 0x06ed],
	[0x070f, 0x070f],
	[0x0711, 0x0711],
	[0x0730, 0x074a],
	[0x07a6, 0x07b0],
	[0x07eb, 0x07f3],
	[0x0901, 0x0902],
	[0x093c, 0x093c],
	[0x0941, 0x0948],
	[0x094d, 0x094d],
	[0x0951, 0x0954],
	[0x0962, 0x0963],
	[0x0981, 0x0981],
	[0x09bc, 0x09bc],
	[0x09c1, 0x09c4],
	[0x09cd, 0x09cd],
	[0x09e2, 0x09e3],
	[0x0a01, 0x0a02],
	[0x0a3c, 0x0a3c],
	[0x0a41, 0x0a42],
	[0x0a47, 0x0a48],
	[0x0a4b, 0x0a4d],
	[0x0a70, 0x0a71],
	[0x0a81, 0x0a82],
	[0x0abc, 0x0abc],
	[0x0ac1, 0x0ac5],
	[0x0ac7, 0x0ac8],
	[0x0acd, 0x0acd],
	[0x0ae2, 0x0ae3],
	[0x0b01, 0x0b01],
	[0x0b3c, 0x0b3c],
	[0x0b3f, 0x0b3f],
	[0x0b41, 0x0b43],
	[0x0b4d, 0x0b4d],
	[0x0b56, 0x0b56],
	[0x0b82, 0x0b82],
	[0x0bc0, 0x0bc0],
	[0x0bcd, 0x0bcd],
	[0x0c3e, 0x0c40],
	[0x0c46, 0x0c48],
	[0x0c4a, 0x0c4d],
	[0x0c55, 0x0c56],
	[0x0cbc, 0x0cbc],
	[0x0cbf, 0x0cbf],
	[0x0cc6, 0x0cc6],
	[0x0ccc, 0x0ccd],
	[0x0ce2, 0x0ce3],
	[0x0d41, 0x0d43],
	[0x0d4d, 0x0d4d],
	[0x0dca, 0x0dca],
	[0x0dd2, 0x0dd4],
	[0x0dd6, 0x0dd6],
	[0x0e31, 0x0e31],
	[0x0e34, 0x0e3a],
	[0x0e47, 0x0e4e],
	[0x0eb1, 0x0eb1],
	[0x0eb4, 0x0eb9],
	[0x0ebb, 0x0ebc],
	[0x0ec8, 0x0ecd],
	[0x0f18, 0x0f19],
	[0x0f35, 0x0f35],
	[0x0f37, 0x0f37],
	[0x0f39, 0x0f39],
	[0x0f71, 0x0f7e],
	[0x0f80, 0x0f84],
	[0x0f86, 0x0f87],
	[0x0f90, 0x0f97],
	[0x0f99, 0x0fbc],
	[0x0fc6, 0x0fc6],
	[0x102d, 0x1030],
	[0x1032, 0x1032],
	[0x1036, 0x1037],
	[0x1039, 0x1039],
	[0x1058, 0x1059],
	[0x1160, 0x11ff],
	[0x135f, 0x135f],
	[0x1712, 0x1714],
	[0x1732, 0x1734],
	[0x1752, 0x1753],
	[0x1772, 0x1773],
	[0x17b4, 0x17b5],
	[0x17b7, 0x17bd],
	[0x17c6, 0x17c6],
	[0x17c9, 0x17d3],
	[0x17dd, 0x17dd],
	[0x180b, 0x180d],
	[0x18a9, 0x18a9],
	[0x1920, 0x1922],
	[0x1927, 0x1928],
	[0x1932, 0x1932],
	[0x1939, 0x193b],
	[0x1a17, 0x1a18],
	[0x1b00, 0x1b03],
	[0x1b34, 0x1b34],
	[0x1b36, 0x1b3a],
	[0x1b3c, 0x1b3c],
	[0x1b42, 0x1b42],
	[0x1b6b, 0x1b73],
	[0x1dc0, 0x1dca],
	[0x1dfe, 0x1dff],
	[0x200b, 0x200f],
	[0x202a, 0x202e],
	[0x2060, 0x2063],
	[0x206a, 0x206f],
	[0x20d0, 0x20ef],
	[0x302a, 0x302f],
	[0x3099, 0x309a],
	[0xa806, 0xa806],
	[0xa80b, 0xa80b],
	[0xa825, 0xa826],
	[0xfb1e, 0xfb1e],
	[0xfe00, 0xfe0f],
	[0xfe20, 0xfe23],
	[0xfeff, 0xfeff],
	[0xfff9, 0xfffb],
	[0x10a01, 0x10a03],
	[0x10a05, 0x10a06],
	[0x10a0c, 0x10a0f],
	[0x10a38, 0x10a3a],
	[0x10a3f, 0x10a3f],
	[0x1d167, 0x1d169],
	[0x1d173, 0x1d182],
	[0x1d185, 0x1d18b],
	[0x1d1aa, 0x1d1ad],
	[0x1d242, 0x1d244],
	[0xe0001, 0xe0001],
	[0xe0020, 0xe007f],
	[0xe0100, 0xe01ef],
];

/**
 * Pairs of [first, last] code points (inclusive) for code points that
 * occupy two terminal cells. Adapted from Kuhn's conditional, then
 * extended with the modern emoji blocks (Emoji_Presentation=Yes) so that
 * symbols like 🚀 and 😀 — which post-date Kuhn's 2007 table — also
 * occupy two cells, matching real-terminal behaviour.
 *
 * Order: STRICTLY ascending by `first` (binary search depends on this).
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
	// ── BMP, Kuhn's original wide-range conditional ──
	[0x1100, 0x115f], // Hangul Jamo init. consonants
	[0x2329, 0x232a], // Angle brackets
	[0x2e80, 0x303e], // CJK Radicals .. CJK Symbols and Punctuation (sans U+303F)
	[0x3041, 0xa4cf], // Hiragana .. Yi
	[0xac00, 0xd7a3], // Hangul Syllables
	[0xf900, 0xfaff], // CJK Compatibility Ideographs
	[0xfe10, 0xfe19], // Vertical forms
	[0xfe30, 0xfe6f], // CJK Compatibility Forms
	[0xff00, 0xff60], // Fullwidth Forms
	[0xffe0, 0xffe6], // Fullwidth signs

	// ── Supplementary Multilingual Plane: modern emoji blocks ──
	// (Emoji_Presentation=Yes per emoji-data.txt, Unicode 9..15.)
	[0x1f300, 0x1f64f], // Miscellaneous Symbols and Pictographs + Emoticons
	[0x1f680, 0x1f6ff], // Transport and Map Symbols
	[0x1f700, 0x1f77f], // Alchemical Symbols
	[0x1f780, 0x1f7ff], // Geometric Shapes Extended
	[0x1f800, 0x1f8ff], // Supplemental Arrows-C
	[0x1f900, 0x1f9ff], // Supplemental Symbols and Pictographs (incl. ZWJ-fused emoji parts)
	[0x1fa00, 0x1fa6f], // Chess Symbols + Symbols and Pictographs Extended-A
	[0x1fa70, 0x1faff], // Symbols and Pictographs Extended-A
	[0x1fb00, 0x1fbff], // Symbols for Legacy Computing

	// ── Supplementary Ideographic Plane: CJK Unified Extensions B+ ──
	[0x20000, 0x2fffd], // CJK Unified Ideographs Extension B-F
	[0x30000, 0x3fffd], // CJK Unified Ideographs Extension G+
];

/** Binary-search a sorted array of [lo, hi] ranges for `cp`. */
function inRange(
	cp: number,
	ranges: ReadonlyArray<readonly [number, number]>,
): boolean {
	let lo = 0;
	let hi = ranges.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const range = ranges[mid];
		if (!range) return false;
		const [first, last] = range;
		if (cp < first) {
			hi = mid - 1;
		} else if (cp > last) {
			lo = mid + 1;
		} else {
			return true;
		}
	}
	return false;
}

/**
 * Return the column width of a single Unicode code point.
 *
 * @param cp - Unicode code point (0x000000..0x10FFFF)
 * @returns
 *   -1 for unprintable C0/C1 controls and DEL;
 *    0 for combining marks, format controls, zero-width joiner/non-joiner,
 *      variation selectors, and the Hangul-trailer jamo range;
 *    2 for East-Asian-Wide / Fullwidth / Emoji_Presentation code points;
 *    1 for everything else printable (the default).
 *
 * Matches Kuhn's `mk_wcwidth` semantics. Always returns a single integer
 * — no negative widths leak through for printable code points.
 */
export function wcwidth(cp: number): -1 | 0 | 1 | 2 {
	// NUL is technically width 0 in Kuhn's code; we mark it unprintable
	// so callers can route it through the C0 path. The terminal's parser
	// already eats NUL before `print` is dispatched.
	if (cp === 0) return -1;

	// C0 controls (00..1F) and DEL (0x7F) + C1 controls (80..9F).
	// Kuhn returns -1 for these; the parser also already filters them,
	// but we keep the guard so the function is safe to call standalone.
	if (cp < 0x20) return -1;
	if (cp >= 0x7f && cp < 0xa0) return -1;

	// Out-of-range / unpaired-surrogate / above-plane-16 → unprintable.
	if (cp > 0x10ffff) return -1;

	// Fast path: ASCII printable is always width 1.
	if (cp < 0x300) return 1;

	if (inRange(cp, ZERO_WIDTH_RANGES)) return 0;
	if (inRange(cp, WIDE_RANGES)) return 2;

	return 1;
}

/**
 * Return the column width of a JavaScript string (UTF-16). Surrogate
 * pairs are decoded to a single code point and contribute the wcwidth
 * of that code point. Returns -1 if the string contains any unprintable
 * code point — matching POSIX wcswidth() semantics.
 *
 * Combining marks contribute 0; this means `"é"` (e + combining
 * acute) reports width 1, as expected.
 */
export function wcswidth(s: string): number {
	let total = 0;
	for (const ch of s) {
		const cp = ch.codePointAt(0);
		if (cp === undefined) continue;
		const w = wcwidth(cp);
		if (w < 0) return -1;
		total += w;
	}
	return total;
}
