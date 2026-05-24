# @kattebak/sterk

[![Node.js CI](https://github.com/kattebak/sterk/actions/workflows/node.js.yml/badge.svg)](https://github.com/kattebak/sterk/actions/workflows/node.js.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Sterk is a terminal emulator for the web, built with ❤️ on top of [Ace](https://ace.c9.io/). It pairs Ace's mature text-rendering engine with a clean-room VT core, and treats shell-integration (OSC 133) as a first-class primitive rather than an extension.

Touch-friendly. Mobile-first. MIT.

## Status

- ✅ **M0** — Public API contract (`src/types.ts`)
- ✅ **M1** — Foundation utilities (256-color palette, scrollback buffer, EventEmitter shim)
- ✅ **M2** — Clean-room VT core (Paul Williams parser, SGR, OSC 133, `Terminal` factory)
- 🚧 **M3** — Ace renderer glue (input, mouse, links, theme, DOM)
- ✅ **M4** — Polish, alt-screen buffer, demo page, 1.0 release

See [docs/ROADMAP.md](./docs/ROADMAP.md).

## Installation

```bash
npm install @kattebak/sterk
```

## Size

Sterk packs at around **305 kB** total (Ace is a peer dependency, not bundled). The breakdown:

- **~100 kB** — JS + `.d.ts` for the renderer, VT core, themes, and fonts registry.
- **~200 kB** — vendored fonts under `assets/fonts/`: five TUI-coverage subsets
  (JetBrains Mono, IBM Plex Mono, Cascadia Mono, Fira Mono, Source Code Pro)
  at 25–55 kB each, plus a shared ~25 kB `SterkTUISymbols.woff2` fallback
  that supplies the box-drawing, dingbats, geometric, and arrow glyphs the
  primary fonts lack natively (see [`assets/fonts/LICENSES.txt`](./assets/fonts/LICENSES.txt)).

The font assets are static — the consumer's bundler hashes and emits them
as separate files, so the JS payload the browser parses is still ~100 kB.
The browser downloads font files lazily and the symbol fallback is shared
across every primary family (downloaded at most once per page).

Run `npm run size` to verify the current bundle size against the 350 kB budget.

## Demo

A standalone demo is available in `demo/index.html`. To run it:

```bash
npm run build
npm run demo
```

Then open http://localhost:3000 in your browser.

## Usage

### Headless mode (parser + buffer only)

```typescript
import { createTerminal } from '@kattebak/sterk';

const term = createTerminal({ cols: 80, rows: 24 });

term.write('Hello, world!\r\n');
term.write('\x1b[1;31mBold red text\x1b[0m\r\n');

term.onData((data) => {
  console.log('User input:', data);
  // Forward to backend (WebSocket, pty, etc.)
});

// Access buffer for rendering
const line = term.buffer.active.getLine(0);
console.log(line?.translateToString());
```

### DOM mode (with Ace renderer)

```typescript
import { createTerminal } from '@kattebak/sterk';

const term = createTerminal({
  cols: 80,
  rows: 24,
  theme: {
    foreground: '#f0f0f0',
    background: '#1e1e1e',
  },
});

// Attach to DOM
const container = document.getElementById('terminal');
term.open(container);

term.write('Welcome to sterk!\r\n');

// Register OSC 133 handler for shell integration
term.parser.registerOscHandler(133, (data) => {
  const kind = data.charAt(0); // 'A', 'B', 'C', 'D'
  if (kind === 'A') {
    console.log('Prompt start');
  }
  return false; // Allow other handlers
});
```

See `demo/` for a complete standalone example.

## Public API

- `createTerminal(options?: TerminalOptions): Terminal` — Create a terminal instance
- `Terminal` — Main terminal interface (write, resize, open, dispose, refresh, setTheme)
- `Terminal.refresh(): Promise<void>` — Race-safe forced repaint. Waits for any in-flight `write()` burst to flush into the Ace document, then triggers a full repaint. Use this for theme/font swaps or recovery from a render glitch instead of reaching into Ace internals (`renderer.updateFull()`), which can paint a half-synced document.
- `Terminal.setTheme(themeId: string): void` — Swap to a built-in theme by id at runtime (see [Built-in themes](#built-in-themes)).
- `Terminal.setFont(fontId: string): void` — Swap to a bundled monospace font by id at runtime (see [Built-in fonts](#built-in-fonts)).
- `Parser.registerOscHandler(id, handler)` — Register OSC sequence handlers
- `Buffer` / `BufferLine` / `BufferCell` — Read-only buffer access with full SGR attributes
- `Theme` — Color theme definition (foreground, background, ANSI palette)
- `BuiltinTheme` — Value-object form used by the built-in registry

See `src/types.ts` for full API documentation with JSDoc comments and examples.

## Built-in themes

Sterk ships 5 named themes out of the box. Pick one by id at runtime
without re-instantiating the `Terminal`:

| Id                  | Display name        | Source                                   |
| ------------------- | ------------------- | ---------------------------------------- |
| `solarized-dark`    | Solarized Dark      | Ethan Schoonover — https://ethanschoonover.com/solarized/ |
| `solarized-light`   | Solarized Light     | Ethan Schoonover — https://ethanschoonover.com/solarized/ |
| `tomorrow-night`    | Tomorrow Night      | Chris Kempson — https://github.com/chriskempson/tomorrow-theme |
| `nord`              | Nord                | Arctic Ice Studio — https://www.nordtheme.com/docs/colors-and-palettes |
| `gruvbox-dark-soft` | Gruvbox Dark Soft   | Pavel Pertsev (morhetz) — https://github.com/morhetz/gruvbox |

```typescript
import { createTerminal, THEMES, SOLARIZED_DARK } from '@kattebak/sterk';

const term = createTerminal({ cols: 80, rows: 24 });
term.open(document.getElementById('terminal'));

// Swap themes at runtime by id — the public, registry-backed entry point.
term.setTheme('nord');

// Enumerate the registry for a picker UI:
for (const t of Object.values(THEMES)) {
  console.log(t.id, t.name);
}

// Themes are also exported as constants for direct reference.
console.log(SOLARIZED_DARK.ansi[1]); // "#dc322f" — Solarized red
```

The runtime swap regenerates the per-instance `#sterk-theme` stylesheet
and schedules a coalesced re-paint via `scheduleUpdate()` — it never
reaches into Ace's internal `renderer.updateFull()`.

When `createTerminal()` is called without an explicit `theme` option,
sterk keeps the historical neutral built-in palette (dark grey bg, light
grey fg, XTerm-default ANSI palette). The 5 named themes above are
opt-in via either `setTheme(id)` or `{ theme: builtinThemeToTheme(...) }`.
For new integrations we recommend Solarized Dark as a safe, neutral
default:

```typescript
import { createTerminal, SOLARIZED_DARK, builtinThemeToTheme } from '@kattebak/sterk';

const term = createTerminal({ theme: builtinThemeToTheme(SOLARIZED_DARK) });
```

For the consumer ↔ sterk boundary — what's in contract, what's explicitly out
of contract (e.g. reaching into `editor.renderer.updateFull()`), and recipes
for common needs (forced redraws, container resize, OSC 133, custom input) —
see [STERK_INTEGRATION.md](./STERK_INTEGRATION.md).

## Built-in fonts

Sterk vendors 5 open-source monospace fonts as `.woff2` assets under
`assets/fonts/` and ships them with the package. **JetBrains Mono is
applied automatically by the `Terminal` constructor** — a bare
`createTerminal()` already renders with a quality, consistent typeface
on any device. Swap at runtime via `setFont(id)`:

| Id                | Family            | Notes                                                          |
| ----------------- | ----------------- | -------------------------------------------------------------- |
| `jetbrains-mono`  | JetBrains Mono    | **Default.** Code ligatures (`!=` → `≠`, `=>` → `⇒`, …).        |
| `ibm-plex-mono`   | IBM Plex Mono     | Humanist letterforms, no ligatures.                            |
| `cascadia-mono`   | Cascadia Mono     | Cascadia Code without ligatures (per Microsoft naming).        |
| `fira-mono`       | Fira Mono         | Mozilla's Fira family, no ligatures.                           |
| `source-code-pro` | Source Code Pro   | Adobe's narrow monospace — best slot for small phone screens.  |

```typescript
import { createTerminal, BUILTIN_FONTS } from '@kattebak/sterk';

const term = createTerminal();             // → JetBrains Mono, ready to use
term.open(document.getElementById('terminal'));

term.setFont('source-code-pro');           // swap at runtime

for (const f of Object.values(BUILTIN_FONTS)) {
  console.log(f.id, f.family);
}
```

Asset URLs are emitted by sterk via `new URL('../../assets/fonts/X.woff2',
import.meta.url)`. Both Vite/esbuild and Rollup follow this pattern at
your build time and inline the woff2 into the output — nothing for you to
configure. The `Terminal` constructor lazily injects one shared
`@font-face` rule per requested font into a `<style id="sterk-fonts">`
element on `document.head`.

**Opt out** of the bundled default by passing `font: ""` plus your own
`fontFamily`:

```typescript
createTerminal({ font: '', fontFamily: 'Menlo, monospace' });
```

**Glyph coverage.** The bundled woff2 files are the Latin subsets shipped
by [@fontsource](https://fontsource.org/) (≤ 25 KB each). Code, prose,
and the punctuation/arrows used by most TUIs render in-font; line-drawing
characters (`U+2500-257F`), emoji, and CJK fall through to the consumer's
system `monospace` (specified as the fallback in the family stack). If
your application needs in-font box-drawing, override `fontFamily` with a
full-coverage font of your choice.

**Substitution note.** The user-facing "narrow / phone-screen" slot was
specified as Iosevka Term, which has no `@fontsource` package. We
substitute **Source Code Pro** — same OFL-1.1 license, well-tested
condensed monospace, ~12 KB latin woff2.

All five fonts are licensed under the SIL Open Font License 1.1; per-font
attribution lives in [`assets/fonts/LICENSES.txt`](./assets/fonts/LICENSES.txt).

## Visual regression

Every PR that touches rendering must pass a Playwright visual-regression
suite against real Chromium with Pixel 7 emulation. Baselines live under
`test/visual/`. See [CONTRIBUTING.md](./CONTRIBUTING.md#visual-regression-playwright)
for how to run locally, update baselines, and the CI Definition of Done.

```bash
npm run build && npm run test:visual           # run the suite
npm run test:visual:update                     # regenerate baselines
```

## Design principles

- **Clean-room core.** The VT parser is written from public specs (Paul Williams' state machine, XTerm Control Sequences, ECMA-48). No code lifted from other emulators.
- **Ace does what Ace does well.** Text layout, scrolling, theming — we don't reinvent it.
- **OSC 133 first-class.** Shell integration (prompt markers, command boundaries) is a built-in concept, not a bolt-on.
- **Pragmatic feature scope.** Feature parity with xterm.js is aspirational. We build what real consumers need and skip the rest.

## License

MIT © 2026 Matthijs van Henten / kattebak
