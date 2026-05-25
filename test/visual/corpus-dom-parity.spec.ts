import { expect, test } from "@playwright/test";
import { CORPUS } from "../../src/demo/corpus.js";

/**
 * Phase-2 DOM/buffer parity gate (assertion-based, NOT screenshots).
 *
 * The buffer layer is proven correct by the vitest gates (Phase 1). This gate
 * runs the SAME corpus through the real browser and compares the ACTUAL Ace
 * DOM (`dumpDom`) against the buffer (`dumpState`). Where they disagree, the
 * bug is in the render layer (ace_renderer.ts / vt_mode.ts), not the buffer.
 *
 * Three checks:
 *   (a) static unicode/sgr entries — text parity per row.
 *   (b) in-place entries — text parity at the final frame AND frame-by-frame
 *       for the rapid-redraw suspects (busy-spinner-single, busy-multiline).
 *   (c) attribute-only staleness repro — same glyphs, new SGR colour; the DOM
 *       span class must reflect the new colour (the syncBufferToDocument
 *       "only rewrite when text changed" suspect).
 *
 * If parity fails, the failure message carries entry/frame/row + buffer-vs-DOM
 * so the bug is pinpointed. Do NOT weaken these assertions.
 */

interface DomLine {
	text: string;
	spans: { text: string; className: string }[];
}
interface HarnessWindow {
	__sterkTest: {
		ready: Promise<void>;
		feedRaw: (s: string) => Promise<void>;
		feedFrames: (frames: string[]) => Promise<void>;
		clear: () => Promise<void>;
		reset: () => Promise<void>;
		dumpState: () => { lines: string[]; linesRaw: string[]; cursorY: number };
		dumpDom: () => { lines: DomLine[] };
	};
}

const rstrip = (s: string) => s.replace(/\s+$/u, "");

// Built from explicit codepoints so editor NFC normalization can't silently
// alter the invisible joiners we are asserting on.
const ZWJ = String.fromCodePoint(0x200d);
const LRM = String.fromCodePoint(0x200e);
// "hi 🚀 ok 👨<ZWJ>👩<ZWJ>👧<ZWJ>👦 done"
const FAMILY_EMOJI_LINE = `hi \u{1f680} ok \u{1f468}${ZWJ}\u{1f469}${ZWJ}\u{1f467}${ZWJ}\u{1f466} done`;
// "A<LRM>B" — LRM is a NON-exempt invisible and must stay mangled.
const LRM_LINE = `A${LRM}B`;

async function boot(page: import("@playwright/test").Page) {
	await page.goto("/test/visual/harness/index.html");
	await page.waitForFunction(
		() =>
			typeof (window as unknown as { __sterkTest?: unknown }).__sterkTest ===
			"object",
	);
	await page.evaluate(
		() => (window as unknown as HarnessWindow).__sterkTest.ready,
	);
}

const feedRaw = (page: import("@playwright/test").Page, s: string) =>
	page.evaluate(
		(data) => (window as unknown as HarnessWindow).__sterkTest.feedRaw(data),
		s,
	);
const feedFrames = (page: import("@playwright/test").Page, frames: string[]) =>
	page.evaluate(
		(f) => (window as unknown as HarnessWindow).__sterkTest.feedFrames(f),
		frames,
	);
const dumpState = (page: import("@playwright/test").Page) =>
	page.evaluate(() =>
		(window as unknown as HarnessWindow).__sterkTest.dumpState(),
	);
const dumpDom = (page: import("@playwright/test").Page) =>
	page.evaluate(() =>
		(window as unknown as HarnessWindow).__sterkTest.dumpDom(),
	);

/**
 * Assert DOM text === buffer text for every non-empty buffer row that is also
 * visible in the DOM. DOM only renders the visible viewport rows, so we align
 * by matching the buffer's visible window to the DOM lines.
 */
async function assertTextParity(
	page: import("@playwright/test").Page,
	ctx: string,
) {
	const state = await dumpState(page);
	const dom = await dumpDom(page);

	// The DOM text layer renders the visible rows in order. The buffer's
	// non-empty content for our single-screen corpus sits at rows 0..N. Compare
	// each buffer row that has content against the same-index DOM line.
	//
	// IMPORTANT: compare against `linesRaw` (untrimmed) — translateToString(true)
	// LEFT-trims too, so leading spaces a frame legitimately printed (e.g. the
	// indented "  steps:" lines in busy-multiline) would otherwise look like a
	// DOM/buffer mismatch when they actually agree. We rstrip both sides only.
	const failures: string[] = [];
	for (let row = 0; row < state.linesRaw.length; row++) {
		const bufText = rstrip(state.linesRaw[row] ?? "");
		if (bufText === "") continue;
		const domLine = dom.lines[row];
		const domText = rstrip(domLine?.text ?? "");
		if (domText !== bufText) {
			failures.push(
				`${ctx} row ${row}:\n    buffer=${JSON.stringify(bufText)}\n    dom   =${JSON.stringify(domText)}\n    spans =${JSON.stringify(domLine?.spans ?? null)}`,
			);
		}
	}
	expect(failures, failures.join("\n")).toEqual([]);
}

// ── (a) static unicode / sgr entries ───────────────────────────────────────

const STATIC_ENTRIES = CORPUS.filter(
	(e) =>
		!e.inPlace &&
		[
			"cjk",
			"combining",
			"emoji",
			"sgr",
			"box-drawing",
			"block-shading",
		].includes(e.category),
);

test.describe("DOM/buffer text parity \u2014 static entries", () => {
	for (const entry of STATIC_ENTRIES) {
		test(`${entry.category}: ${entry.id}`, async ({ page }) => {
			// emoji-mixed (Bug 2, FIXED): the ZWJ family sequence used to render
			// with middle-dots because Ace's Text.$renderToken substitutes U+200D
			// (in its control-char regex range) with the SPACE_CHAR "\u00b7".
			// AceRenderer now instance-patches $renderToken to exempt the width-0
			// joiners, so DOM/buffer text parity holds and this is enforced as a
			// normal assertion (no test.fail()).
			await boot(page);
			await feedRaw(page, entry.bytes);
			await assertTextParity(page, `[${entry.id}]`);
		});
	}
});

/**
 * Bug-2 lock-in: the ZWJ family emoji renders with REAL joiners, not
 * middle-dots, and is not tagged invalid.
 */
test.describe("emoji ZWJ rendering (Bug-2 lock-in)", () => {
	test("family emoji keeps U+200D joiners, no U+00B7, not ace_invalid", async ({
		page,
	}) => {
		await boot(page);
		await feedRaw(page, FAMILY_EMOJI_LINE);
		const dom = await dumpDom(page);
		const line = dom.lines[0];
		const text = rstrip(line?.text ?? "");

		const codepoints = Array.from(text).map((c) => c.codePointAt(0) ?? 0);
		// The joiner (U+200D) must be present...
		expect(
			codepoints.includes(0x200d),
			`expected U+200D joiners in DOM text; codepoints=${JSON.stringify(codepoints.map((c) => c.toString(16)))}`,
		).toBe(true);
		// ...and the middle-dot substitution (U+00B7) must be ABSENT.
		expect(
			codepoints.includes(0x00b7),
			`DOM still contains U+00B7 middle-dot (joiner mangled); text=${JSON.stringify(text)}`,
		).toBe(false);

		// No span on this line may be tagged ace_invalid (Ace's mangle marker).
		const hasInvalid = (line?.spans ?? []).some((s) =>
			s.className.includes("ace_invalid"),
		);
		expect(
			hasInvalid,
			`a span was tagged ace_invalid; spans=${JSON.stringify(line?.spans ?? null)}`,
		).toBe(false);
	});

	test("over-exemption negative: LRM (U+200E) is STILL substituted", async ({
		page,
	}) => {
		// Proves the narrowing is surgical: LRM is a non-exempt invisible, so
		// Ace must still replace it with the middle-dot. If this regresses to
		// keeping the LRM, the exemption set was widened too far.
		await boot(page);
		await feedRaw(page, LRM_LINE);
		const dom = await dumpDom(page);
		const line = dom.lines.find((l) => l.text.includes("A"));
		const text = rstrip(line?.text ?? "");
		const codepoints = Array.from(text).map((c) => c.codePointAt(0) ?? 0);
		expect(
			codepoints.includes(0x200e),
			`LRM (U+200E) should NOT survive (not exempt); text=${JSON.stringify(text)}`,
		).toBe(false);
		expect(
			codepoints.includes(0x00b7),
			`expected LRM substituted with U+00B7; text=${JSON.stringify(text)}`,
		).toBe(true);
	});
});

// ── (b) in-place entries ────────────────────────────────────────────────────

const INPLACE_IDS = [
	"busy-spinner-single",
	"busy-shrinking-tail",
	"progress-bar-inplace",
	"busy-multiline",
];

test.describe("DOM/buffer text parity — in-place final frame", () => {
	for (const id of INPLACE_IDS) {
		test(`${id} (whole animation → final frame)`, async ({ page }) => {
			const entry = CORPUS.find((e) => e.id === id);
			if (!entry?.frames) throw new Error(`missing in-place entry ${id}`);
			await boot(page);
			await feedFrames(page, entry.frames);
			await assertTextParity(page, `[${id} final]`);
		});
	}
});

test.describe("DOM/buffer text parity — in-place frame-by-frame", () => {
	for (const id of ["busy-spinner-single", "busy-multiline"]) {
		test(`${id} (parity after EVERY frame)`, async ({ page }) => {
			const entry = CORPUS.find((e) => e.id === id);
			if (!entry?.frames) throw new Error(`missing in-place entry ${id}`);
			await boot(page);
			const frames = entry.frames;
			for (let i = 0; i < frames.length; i++) {
				const f = frames[i];
				if (f === undefined) continue;
				await feedRaw(page, f);
				await assertTextParity(page, `[${id} frame ${i}]`);
			}
		});
	}
});

/**
 * Locks in the Bug-1 fix on the real pulsing-indicator path: the gerund word
 * recolours every frame WITHOUT its text changing, which used to leave the DOM
 * span class frozen at frame 0. We drive busy-spinner-single frame-by-frame and
 * assert the DOM span className of the word reflects the buffer's attrs LIVE:
 *   - even frames: a 256-colour grey-ramp fg `sterk-fg-(240 + i%16)`, NO dim.
 *   - odd frames:  `sterk-dim`, and NO stale `sterk-fg-*` colour carried over.
 */
test.describe("busy-spinner-single: live pulse renders (Bug-1 lock-in)", () => {
	test("word span className tracks the buffer pulse every frame", async ({
		page,
	}) => {
		const entry = CORPUS.find((e) => e.id === "busy-spinner-single");
		if (!entry?.frames) throw new Error("missing busy-spinner-single");
		await boot(page);
		const frames = entry.frames;

		for (let i = 0; i < frames.length; i++) {
			const f = frames[i];
			if (f === undefined) continue;
			await feedRaw(page, f);
			const dom = await dumpDom(page);
			const spans = dom.lines[0]?.spans ?? [];
			// The word is the span whose text is exactly the gerund.
			const wordSpan = spans.find((s) => s.text === "Transfiguring…");
			expect(
				wordSpan,
				`frame ${i}: no word span found; spans=${JSON.stringify(spans)}`,
			).toBeTruthy();
			const cls = wordSpan?.className ?? "";

			if (i % 2 === 1) {
				// Odd frame: dim pulse, no colour.
				expect(
					cls.includes("ace_sterk-dim"),
					`frame ${i}: expected dim word, className=${JSON.stringify(cls)}`,
				).toBe(true);
				expect(
					cls.includes("sterk-fg-"),
					`frame ${i}: dim frame must NOT carry a stale fg colour, className=${JSON.stringify(cls)}`,
				).toBe(false);
			} else {
				// Even frame: 256-colour grey-ramp fg, no dim.
				const grey = 240 + (i % 16);
				expect(
					cls.includes(`ace_sterk-fg-${grey}`),
					`frame ${i}: expected ace_sterk-fg-${grey}, className=${JSON.stringify(cls)}`,
				).toBe(true);
				expect(
					cls.includes("sterk-dim"),
					`frame ${i}: colour frame must NOT carry a stale dim, className=${JSON.stringify(cls)}`,
				).toBe(false);
			}
		}
	});
});

// ── (c) attribute-only staleness repro ──────────────────────────────────────

test.describe("attribute-only redraw staleness", () => {
	test("same glyphs, new SGR colour → DOM span class must update", async ({
		page,
	}) => {
		// FIXED (Bug 1): AceRenderer.syncBufferToDocument() used to only rewrite
		// a document line when its TEXT changed, so an attribute-only redraw
		// (same glyphs, new SGR colour) never re-tokenized and the DOM kept the
		// stale span class. The renderer now also compares a per-row rendered-
		// attribute signature and force-re-tokenizes a row whose attrs changed
		// even though its text did not. This assertion now passes normally.
		await boot(page);

		// Frame 1: plain "word" (default fg).
		await feedRaw(page, "\rword");
		const dom1 = await dumpDom(page);
		const line1 = dom1.lines[0];
		// Plain text: no sterk-fg class anywhere on the row.
		const hasColour1 = (line1?.spans ?? []).some((s) =>
			s.className.includes("sterk-fg"),
		);
		expect(hasColour1, "plain 'word' should have NO fg colour class").toBe(
			false,
		);

		// Frame 2: redraw the SAME glyphs at the SAME position with RED fg.
		// CR returns to col 0; identical text "word"; only the SGR attr differs.
		await feedRaw(page, "\r\x1b[31mword\x1b[0m");

		// Buffer must now report red (proven-correct layer) — sanity guard.
		const dom2 = await dumpDom(page);
		const line2 = dom2.lines[0];
		expect(rstrip(line2?.text ?? "")).toBe("word");

		// THE BUG CHECK: the DOM span class must now reflect red (sterk-fg-1).
		// If syncBufferToDocument skipped the re-tokenize because the line TEXT
		// did not change, the DOM still shows the stale uncoloured "word".
		const hasRed = (line2?.spans ?? []).some((s) =>
			s.className.includes("sterk-fg-1"),
		);
		expect(
			hasRed,
			`attribute-only redraw stale: DOM did not pick up sterk-fg-1 after recolouring identical glyphs.\n    dom spans=${JSON.stringify(line2?.spans ?? null)}`,
		).toBe(true);
	});
});
