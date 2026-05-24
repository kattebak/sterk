/**
 * Built-in themes registry.
 *
 * Sterk ships 5 named themes out of the box (B10 + B11 of the
 * aceterm-parity plan, kattebak/sterk#21 rows 40-44). Consumers select a
 * theme by id at runtime via `Terminal.setTheme(id)`; the renderer
 * regenerates the per-instance `#sterk-theme` stylesheet and asks Ace to
 * re-paint via the race-safe `refresh()` path.
 *
 * Each theme is a fully-specified value object (`BuiltinTheme`): a
 * 16-color ANSI palette plus default fg/bg/cursor/selection. The
 * `builtinThemeToTheme()` projection converts that into the xterm-style
 * `Theme` options bag consumers already pass to `createTerminal({ theme })`,
 * so the runtime-swap path and the construct-time path share one wire.
 */

import type { BuiltinTheme, Theme } from "../types.js";
import { GRUVBOX_DARK_SOFT } from "./gruvbox-dark-soft.js";
import { NORD } from "./nord.js";
import { SOLARIZED_DARK } from "./solarized-dark.js";
import { SOLARIZED_LIGHT } from "./solarized-light.js";
import { TOMORROW_NIGHT } from "./tomorrow-night.js";

export { GRUVBOX_DARK_SOFT } from "./gruvbox-dark-soft.js";
export { NORD } from "./nord.js";
export { SOLARIZED_DARK } from "./solarized-dark.js";
export { SOLARIZED_LIGHT } from "./solarized-light.js";
export { TOMORROW_NIGHT } from "./tomorrow-night.js";

/**
 * Registry of all built-in themes keyed by `id`.
 *
 * Iteration order is insertion order; consumers that want a stable list
 * (e.g. to populate a picker UI) can `Object.values(THEMES)`.
 */
export const THEMES: Readonly<Record<string, BuiltinTheme>> = Object.freeze({
	[SOLARIZED_DARK.id]: SOLARIZED_DARK,
	[SOLARIZED_LIGHT.id]: SOLARIZED_LIGHT,
	[TOMORROW_NIGHT.id]: TOMORROW_NIGHT,
	[NORD.id]: NORD,
	[GRUVBOX_DARK_SOFT.id]: GRUVBOX_DARK_SOFT,
});

/**
 * Id of the theme used by default when no theme is provided at construct
 * time. Solarized Dark is picked because it's a widely-recognised,
 * neutral-but-distinct palette that proves the theme pipeline is wired
 * (vs. the previous near-monochrome `#1e1e1e`/`#f0f0f0` placeholder which
 * looked the same as "no theme at all").
 */
export const DEFAULT_BUILTIN_THEME_ID = SOLARIZED_DARK.id;

/**
 * Project a `BuiltinTheme` value object into the xterm-style `Theme`
 * options bag accepted by `createTerminal({ theme })` and `applyTheme()`.
 *
 * The 16-entry `ansi` array becomes the `palette[0..15]` indexes; the
 * default fg/bg/cursor/selection become their xterm-style equivalents.
 * `cursorAccent` defaults to the bg (block cursor renders bg-colored text
 * over the cursor fill).
 */
export function builtinThemeToTheme(t: BuiltinTheme): Theme {
	return {
		foreground: t.defaultFg,
		background: t.defaultBg,
		cursor: t.cursor,
		cursorAccent: t.defaultBg,
		selectionBackground: t.selectionBg,
		palette: [...t.ansi],
	};
}

/**
 * Look up a built-in theme by id. Throws on unknown id with a message
 * that lists the registered ids — keeps consumer typos cheap to debug.
 */
export function getBuiltinTheme(id: string): BuiltinTheme {
	const t = THEMES[id];
	if (!t) {
		const known = Object.keys(THEMES).join(", ");
		throw new Error(`Unknown built-in theme id: "${id}". Known ids: ${known}.`);
	}
	return t;
}
