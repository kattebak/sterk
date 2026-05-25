/**
 * Unicode / SGR content corpus — the single source of truth shared by the
 * demo gallery and the deterministic test gates.
 *
 * Each `CorpusEntry` carries ONE deterministic frame (`bytes`) that is fed to
 * `term.write()` and snapshotted by the test gate (`test/corpus.tokens.test.ts`).
 * Optional `frames` are for the live animated demo gallery only — they are
 * NEVER snapshotted, so animations stay deterministic in CI while still
 * looking alive in the browser.
 *
 * The corpus exercises the two bug classes the gate is meant to catch:
 *   1. SGR-attribute bleed/loss — most importantly the `sgr-bg-space-boundaries`
 *      regression where a plain inter-word space must NOT carry a background
 *      class but an explicitly-coloured space cell MUST.
 *   2. Cell-width parity — wide CJK glyphs occupying a leading cell + an empty
 *      placeholder cell, zero-width combining marks gluing onto a base cell,
 *      and emoji / ZWJ sequences.
 *
 * Escape sequences are written with `\x1b` so they stay human-readable.
 * Keep `id` values stable kebab-case — they are used as snapshot keys.
 */

export type CorpusCategory =
	| "spinner"
	| "loader"
	| "progress"
	| "graphics"
	| "box-drawing"
	| "block-shading"
	| "braille"
	| "sparkline"
	| "cjk"
	| "combining"
	| "emoji"
	| "sgr";

export interface CorpusEntry {
	/** stable kebab-case; used as snapshot key */
	id: string;
	/** human label for the demo gallery */
	title: string;
	category: CorpusCategory;
	/** ONE deterministic frame fed via term.write — what tests snapshot */
	bytes: string;
	/** optional animation frames for the live demo only (NOT snapshotted) */
	frames?: string[];
	/** ms per frame for the demo */
	frameMs?: number;
	/** optional width override (default 80) */
	cols?: number;
	/** optional height override (default 24) */
	rows?: number;
	/** When true, `frames` are applied cumulatively to ONE buffer (each frame
	 *  redraws in place via \r / cursor-move / erase-line) rather than each
	 *  being a standalone screen. The demo renders them as one evolving region;
	 *  tests assert buffer state after each frame. */
	inPlace?: boolean;
}

// ── Spinners ─────────────────────────────────────────────────────────────

const BRAILLE_SPINNER_FRAMES = [
	"⠋",
	"⠙",
	"⠹",
	"⠸",
	"⠼",
	"⠴",
	"⠦",
	"⠧",
	"⠇",
	"⠏",
].map((f) => `${f} working…`);

const ASCII_SPINNER_FRAMES = ["|", "/", "-", "\\"].map((f) => `${f} working…`);

const DOTS_SPINNER_FRAMES = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"].map(
	(f) => `${f} loading…`,
);

// ── Loaders ──────────────────────────────────────────────────────────────

const ELLIPSIS_LOADER_FRAMES = [
	"Loading",
	"Loading.",
	"Loading..",
	"Loading...",
];

const BOUNCING_BAR_FRAMES = [
	"[=     ]",
	"[ =    ]",
	"[  =   ]",
	"[   =  ]",
	"[    = ]",
	"[     =]",
	"[    = ]",
	"[   =  ]",
	"[  =   ]",
	"[ =    ]",
];

// ── Progress ─────────────────────────────────────────────────────────────

// Unicode block progress bar with partial blocks at several fill levels.
const PROGRESS_PARTIALS = " ▏▎▍▌▋▊▉█";

function progressBar(fraction: number, width = 20): string {
	const total = width * 8;
	const filledEighths = Math.round(fraction * total);
	const fullCells = Math.floor(filledEighths / 8);
	const remainder = filledEighths % 8;
	let bar = "█".repeat(fullCells);
	if (remainder > 0) {
		bar += PROGRESS_PARTIALS[remainder];
	}
	bar = bar.padEnd(width, " ");
	const pct = Math.round(fraction * 100)
		.toString()
		.padStart(3, " ");
	return `[${bar}] ${pct}%`;
}

const PROGRESS_FRAMES = [0, 0.1, 0.25, 0.375, 0.5, 0.625, 0.75, 0.9, 1].map(
	(f) => progressBar(f),
);

/**
 * Pick a frame by index, asserting it exists. Keeps the corpus entries free of
 * `string | undefined` under `noUncheckedIndexedAccess` while still failing
 * loudly if a frame list is ever shortened below the index it is read at.
 */
function frame(frames: string[], i: number): string {
	const f = frames[i];
	if (f === undefined) {
		throw new Error(`corpus: frame index ${i} out of range`);
	}
	return f;
}

// ── SGR — the regression repro ───────────────────────────────────────────

// The real bug shape: single spaces between words sit next to SGR background
// runs. The two coloured spaces (green-bg and red-bg) MUST carry a bg class;
// the plain spaces around "open"/"watching" MUST NOT. Then a clean line with
// NO colour, plus fg/bold/italic/underline/inverse/dim samplers.
const SGR_REPRO =
	`open\x1b[42m \x1b[49m+\x1b[41m \x1b[49mwatching\r\n` +
	`exit code 0\r\n` +
	`\x1b[31mred\x1b[0m \x1b[1mbold\x1b[0m \x1b[3mitalic\x1b[0m ` +
	`\x1b[4munderline\x1b[0m \x1b[7minverse\x1b[0m \x1b[2mdim\x1b[0m`;

// ── In-place animations (cumulative redraw on ONE buffer) ────────────────
//
// Each frame below carries the redraw escapes (\r, \x1b[K, cursor-up) so that
// writing the frames in sequence into a single terminal reproduces a real
// terminal animation. These are the dynamic counterpart to the static frames
// above; the animation test gate (test/corpus.animation.test.ts) feeds them
// cumulatively and asserts buffer correctness after every frame.

const SPINNER_GLYPHS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Claude-Code style single-line pulsing busy indicator.
 *
 * Each frame: CR + erase-line (`\r\x1b[K`), then a cycling spinner glyph, a
 * gerund word that PULSES (dim on odd frames, a 256-colour brightness ramp on
 * even frames), and an elapsed-seconds counter. Every frame opens by resetting
 * attributes (`\x1b[0m`) right after the erase so no styling can carry over.
 */
function busySpinnerFrames(): string[] {
	const word = "Transfiguring…";
	const frames: string[] = [];
	const count = 12;
	for (let i = 0; i < count; i++) {
		const glyph = SPINNER_GLYPHS[i % SPINNER_GLYPHS.length];
		const seconds = i; // elapsed counter
		// Pulse: alternate dim vs a 256-colour grey-ramp brightness on the word.
		// Reset all attrs first so the previous frame's pulse never lingers.
		let pulse: string;
		let pulseEnd: string;
		if (i % 2 === 1) {
			pulse = "\x1b[2m"; // dim
			pulseEnd = "\x1b[22m"; // dim off
		} else {
			// 256-colour grey ramp 240..255 for a brightness pulse.
			const grey = 240 + (i % 16);
			pulse = `\x1b[38;5;${grey}m`;
			pulseEnd = "\x1b[39m"; // default fg
		}
		frames.push(
			`\r\x1b[K\x1b[0m${glyph} ${pulse}${word}${pulseEnd}` +
				` (${seconds}s · still thinking)`,
		);
	}
	return frames;
}

/**
 * The classic ghosting trap: a long line, then redraws that get SHORTER.
 * `withErase` controls whether each redraw includes `\x1b[K` after the `\r`.
 *
 * - withErase=true  → a correct renderer erases the stale tail every frame.
 * - withErase=false → only `\r` is sent, so a correct renderer LEAVES the
 *   stale tail (real-terminal behaviour). The two siblings pin EL semantics.
 */
function shrinkingTailFrames(withErase: boolean): string[] {
	const texts = [
		"⠋ Loading (processing 4096 items)…",
		"⠙ Loading (processing 512 items)…",
		"⠹ Loading (processing 64 items)…",
		"⠸ Loading (8)…",
		"⠼ Done.",
	];
	const erase = withErase ? "\x1b[K" : "";
	return texts.map((t) => `\r${erase}${t}`);
}

/**
 * Unicode partial-block progress bar that fills 0→100% in place. Each frame:
 * CR + erase-line, an opening `[`, the coloured bar, a closing `] `, and the
 * percentage. The fill is coloured green; the bracket/percentage stay default.
 */
function progressInPlaceFrames(): string[] {
	const fractions = [0, 0.12, 0.27, 0.4, 0.55, 0.68, 0.81, 0.93, 1];
	const width = 20;
	return fractions.map((fraction) => {
		const total = width * 8;
		const filledEighths = Math.round(fraction * total);
		const fullCells = Math.floor(filledEighths / 8);
		const remainder = filledEighths % 8;
		let bar = "█".repeat(fullCells);
		if (remainder > 0) {
			bar += PROGRESS_PARTIALS[remainder];
		}
		bar = bar.padEnd(width, " ");
		const pct = Math.round(fraction * 100)
			.toString()
			.padStart(3, " ");
		// Colour only the fill (green); brackets + pct stay default.
		return `\r\x1b[K[\x1b[32m${bar}\x1b[0m] ${pct}%`;
	});
}

/**
 * A 3-line status block redrawn in place via cursor-up.
 *
 * Frame 0 prints all three lines (spinner / label / count), leaving the cursor
 * on line 3. Every subsequent frame moves the cursor back to the top of the
 * block with `\x1b[2A` + `\r`, then rewrites all three lines (each with a
 * leading `\x1b[K`). Line 1's spinner glyph and line 3's count change per
 * frame. This exercises the cursor-up multiline redraw path.
 *
 * Layout (0-based rows, fresh non-scrolling terminal):
 *   row 0: "<glyph> Building project"
 *   row 1: "  steps: compile → link → bundle"
 *   row 2: "  done: <n>/8 files"
 */
function busyMultilineFrames(): string[] {
	const frames: string[] = [];
	const count = 8;
	for (let i = 0; i < count; i++) {
		const glyph = SPINNER_GLYPHS[i % SPINNER_GLYPHS.length];
		const done = i + 1;
		const line1 = `\x1b[K${glyph} Building project`;
		const line2 = "\x1b[K  steps: compile → link → bundle";
		const line3 = `\x1b[K  done: ${done}/8 files`;
		if (i === 0) {
			// First frame: print the three lines, cursor ends on row 2 (line 3).
			frames.push(`${line1}\r\n${line2}\r\n${line3}`);
		} else {
			// Move up 2 rows to row 0, CR to column 0, rewrite all three.
			frames.push(`\x1b[2A\r${line1}\r\n${line2}\r\n${line3}`);
		}
	}
	return frames;
}

const BUSY_SPINNER_FRAMES = busySpinnerFrames();
const SHRINKING_TAIL_ERASE = shrinkingTailFrames(true);
const SHRINKING_TAIL_NOERASE = shrinkingTailFrames(false);
const PROGRESS_INPLACE_FRAMES = progressInPlaceFrames();
const BUSY_MULTILINE_FRAMES = busyMultilineFrames();

export const CORPUS: CorpusEntry[] = [
	// ── spinner ──────────────────────────────────────────────────────────
	{
		id: "spinner-braille",
		title: "Braille spinner",
		category: "spinner",
		bytes: frame(BRAILLE_SPINNER_FRAMES, 0),
		frames: BRAILLE_SPINNER_FRAMES,
		frameMs: 80,
	},
	{
		id: "spinner-ascii",
		title: "ASCII spinner (|/-\\)",
		category: "spinner",
		bytes: frame(ASCII_SPINNER_FRAMES, 0),
		frames: ASCII_SPINNER_FRAMES,
		frameMs: 80,
	},
	{
		id: "spinner-dots",
		title: "Dots spinner",
		category: "spinner",
		bytes: frame(DOTS_SPINNER_FRAMES, 0),
		frames: DOTS_SPINNER_FRAMES,
		frameMs: 80,
	},

	// ── loader ─────────────────────────────────────────────────────────────
	{
		id: "loader-ellipsis",
		title: "Loading… (cycling ellipsis)",
		category: "loader",
		bytes: frame(ELLIPSIS_LOADER_FRAMES, 0),
		frames: ELLIPSIS_LOADER_FRAMES,
		frameMs: 300,
	},
	{
		id: "loader-bouncing-bar",
		title: "Bouncing bar [=   ]",
		category: "loader",
		bytes: frame(BOUNCING_BAR_FRAMES, 0),
		frames: BOUNCING_BAR_FRAMES,
		frameMs: 120,
	},

	// ── progress ───────────────────────────────────────────────────────────
	{
		id: "progress-blocks",
		title: "Unicode block progress bar",
		category: "progress",
		bytes: frame(PROGRESS_FRAMES, 4), // 50% — a partial-block frame
		frames: PROGRESS_FRAMES,
		frameMs: 200,
	},

	// ── graphics ─────────────────────────────────────────────────────────────
	{
		id: "graphics-box-colored",
		title: "Box-drawing frame with colored text",
		category: "graphics",
		bytes:
			`┌────────────┐\r\n` +
			`│ \x1b[32mHello\x1b[0m \x1b[1;34mBox\x1b[0m │\r\n` +
			`└────────────┘`,
	},

	// ── box-drawing ──────────────────────────────────────────────────────────
	{
		id: "box-drawing-sampler",
		title: "Box-drawing corners & lines",
		category: "box-drawing",
		bytes:
			`light ─ │ ┌┐└┘ ├┤┬┴┼\r\n` + `heavy ━ ┃ ┏┓┗┛\r\n` + `double ═ ║ ╔╗╚╝`,
	},

	// ── block-shading ────────────────────────────────────────────────────────
	{
		id: "block-shading-sampler",
		title: "Blocks & shades",
		category: "block-shading",
		bytes: `blocks █▉▊▋▌▍▎▏\r\nshades ░▒▓`,
	},

	// ── braille ──────────────────────────────────────────────────────────────
	{
		id: "braille-grid",
		title: "Braille dot patterns",
		category: "braille",
		bytes: `⠁⠂⠄⡀⢀⠠⠐⠈\r\n` + `⠿⡿⢿⣟⣯⣷⣾⣽\r\n` + `⣿⠛⠟⠷⠾⠽⠯⠧`,
	},

	// ── sparkline ────────────────────────────────────────────────────────────
	{
		id: "sparkline-colored",
		title: "Colored sparkline",
		category: "sparkline",
		// A row of ▁▂▃▄▅▆▇█ at varying heights, colored green.
		bytes: `\x1b[32m▁▂▃▄▅▆▇█▇▆▅▄▃▂▁\x1b[0m`,
	},

	// ── cjk ──────────────────────────────────────────────────────────────────
	{
		id: "cjk-width-parity",
		title: "CJK width parity",
		category: "cjk",
		bytes: `日本語 test 中文 ok`,
	},

	// ── combining ──────────────────────────────────────────────────────────────
	{
		id: "combining-diacritics",
		title: "Combining diacritics vs precomposed",
		category: "combining",
		// "e" + U+0301 (combining acute) -> é ; "a" + U+0308 (combining
		// diaeresis) -> ä ; then a precomposed "é" (U+00E9) for comparison.
		bytes: `é ä vs é`,
	},

	// ── emoji ──────────────────────────────────────────────────────────────────
	{
		id: "emoji-mixed",
		title: "Emoji & ZWJ family",
		category: "emoji",
		// Single emoji, then the family ZWJ sequence 👨‍👩‍👧‍👦, mixed with text.
		bytes: `hi 🚀 ok 👨‍👩‍👧‍👦 done`,
	},

	// ── sgr ──────────────────────────────────────────────────────────────────
	{
		id: "sgr-bg-space-boundaries",
		title: "SGR background / space boundaries (regression)",
		category: "sgr",
		bytes: SGR_REPRO,
	},

	// ── in-place animations (inPlace: true) ──────────────────────────────────
	{
		id: "busy-spinner-single",
		title: "Pulsing busy indicator (single line)",
		category: "spinner",
		inPlace: true,
		bytes: frame(BUSY_SPINNER_FRAMES, 0),
		frames: BUSY_SPINNER_FRAMES,
		frameMs: 100,
	},
	{
		id: "busy-shrinking-tail",
		title: "Shrinking tail with erase-line (no ghosting)",
		category: "loader",
		inPlace: true,
		bytes: frame(SHRINKING_TAIL_ERASE, 0),
		frames: SHRINKING_TAIL_ERASE,
		frameMs: 200,
	},
	{
		id: "busy-shrinking-tail-noerase",
		title: "Shrinking tail WITHOUT erase-line (stale tail expected)",
		category: "loader",
		inPlace: true,
		bytes: frame(SHRINKING_TAIL_NOERASE, 0),
		frames: SHRINKING_TAIL_NOERASE,
		frameMs: 200,
	},
	{
		id: "progress-bar-inplace",
		title: "In-place progress bar 0→100%",
		category: "progress",
		inPlace: true,
		bytes: frame(PROGRESS_INPLACE_FRAMES, 0),
		frames: PROGRESS_INPLACE_FRAMES,
		frameMs: 150,
	},
	{
		id: "busy-multiline",
		title: "3-line status block redrawn via cursor-up",
		category: "spinner",
		inPlace: true,
		bytes: frame(BUSY_MULTILINE_FRAMES, 0),
		frames: BUSY_MULTILINE_FRAMES,
		frameMs: 150,
	},
];
