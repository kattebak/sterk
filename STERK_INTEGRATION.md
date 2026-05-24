# Sterk integration boundary

This document defines the contract between sterk and any consumer (e.g. a
web shell, terminal IDE, tmux UI). Read it before you touch sterk's
internals — the boundary exists for a reason, and crossing it has burned
real consumers (see [Why we own this](#why-we-own-this)).

If you can solve your problem through the API listed in
[Public surface](#public-surface), do that. If you can't, open an issue —
do not reach into `terminal.renderer`, `editor`, or any private field.

## What sterk owns

Sterk is responsible for everything between "bytes arrive from the PTY"
and "pixels land on screen":

- **VT parsing** — Paul Williams state machine, CSI, OSC, DCS, SGR
  (`src/parser/vt_parser.ts`).
- **Buffer model** — the scrollback buffer, the alternate-screen buffer,
  cursor, and viewport (`src/buffer/scroll_buffer.ts`).
- **PTY → Ace document sync** — taking buffer state and projecting it into
  the Ace `EditSession` (`src/renderer/ace_renderer.ts:299`,
  `syncBufferToDocument`).
- **Render scheduling** — coalescing a burst of `write()` calls into a
  single `requestAnimationFrame` flush so we never paint a half-synced
  document (`src/renderer/ace_renderer.ts:251`, `scheduleUpdate`).
- **Scrollback** — the ring buffer plus the viewport pin / unpin
  semantics.
- **Theming** — CSS injection for the foreground/background, the 16-color
  ANSI palette, and lazily-generated truecolor classes
  (`src/renderer/theme.ts:180`, `applyTheme`).
- **Mouse / keyboard input** — keyboard event → VT sequence, mouse
  drag / wheel → scroll, IME composition (`src/renderer/input.ts`,
  `src/renderer/mouse.ts`).
- **OSC 133 plumbing** — sterk does not interpret shell-integration
  markers itself, but the parser surfaces them via the `Parser.registerOscHandler`
  API as a first-class primitive.
- **Container resize observation** — a `ResizeObserver` on the host
  container, coalesced via rAF, that forces Ace to re-measure when CSS
  resizes the box without firing `window.resize`
  (`src/renderer/ace_renderer.ts:135`, `installResizeObserver`).

## Public surface

Everything in this section is part of the API contract. The file:line
citation points at the source of truth — if a future refactor moves it,
this doc gets updated too.

### Factory

| API | Source | Semantics |
| --- | --- | --- |
| `createTerminal(options?: TerminalOptions): Terminal` | `src/index.ts:82` | Construct a `Terminal`. Headless until you call `open()`. |
| `VERSION` | `src/index.ts:12` | The package version constant. |

### `Terminal` — lifecycle

| API | Source | Semantics |
| --- | --- | --- |
| `Terminal.open(container)` | `src/terminal.ts:232` | Attach to a DOM container and start rendering. Throws if called twice. |
| `Terminal.dispose()` | `src/terminal.ts:293` | Tear down the renderer, input/mouse/link handlers, and all event listeners. Instance is unusable after this. |

### `Terminal` — write / read / control

| API | Source | Semantics |
| --- | --- | --- |
| `Terminal.write(data, callback?)` | `src/terminal.ts:136` | Feed bytes or a string to the VT parser. Buffer is updated synchronously; the renderer flushes on the next rAF. |
| `Terminal.send(data)` | `src/terminal.ts:226` | Emit a `data` event (use this from custom input UIs to forward to the backend). |
| `Terminal.resize(cols, rows)` | `src/terminal.ts:147` | Change the buffer grid. Triggers a re-render. |
| `Terminal.clear()` | `src/terminal.ts:156` | Clear the active buffer and reset attributes. |
| `Terminal.scrollLines(lines)` | `src/terminal.ts:161` | Scroll the viewport by N lines (positive = down/older, negative = up/newer). |
| `Terminal.scrollToBottom()` | `src/terminal.ts:168` | Pin the viewport to the bottom of the buffer. |
| `Terminal.refresh()` | `src/terminal.ts:191` | Race-safe forced repaint. Awaits any in-flight write-burst flush, then asks Ace to re-paint. **This is the canonical "I need a redraw" entry point** — see [Recipes](#recipes). |
| `Terminal.setTheme(id)` | `src/terminal.ts:341` | Swap to a built-in theme by id. Looks up in `THEMES`, regenerates the per-instance stylesheet, schedules a coalesced repaint. |
| `Terminal.setFont(id)` | `src/terminal.ts:374` | Swap to a bundled monospace font by id. Lazily injects `@font-face`, updates the renderer family with `monospace` fallback, schedules a coalesced repaint. See [Recipes](#i-want-to-swap-the-bundled-font). |
| `Terminal.getCellMetrics()` | `src/terminal.ts:286` | Returns `{ width, height }` of a single cell in CSS pixels, or `null` if the renderer hasn't laid out yet. |

### `Terminal` — read-only accessors

| API | Source | Semantics |
| --- | --- | --- |
| `Terminal.cols` / `Terminal.rows` | `src/terminal.ts:109`, `113` | Current grid dimensions. |
| `Terminal.options` | `src/terminal.ts:117` | The resolved `TerminalOptions` (live; theme / fontSize can be mutated). |
| `Terminal.parser` | `src/terminal.ts:121` | Use this to register OSC handlers (see below). |
| `Terminal.buffer` | `src/terminal.ts:125` | Read-only access to the active buffer. See `BufferNamespace`, `Buffer`, `BufferLine`, `BufferCell` in `src/types.ts`. |

### `Terminal` — events

| API | Source | Semantics |
| --- | --- | --- |
| `Terminal.onWriteParsed(callback)` | `src/terminal.ts:203` | Fires after each `write()` is parsed and the buffer has been mutated. Returns a `Disposable`. |
| `Terminal.onData(callback)` | `src/terminal.ts:212` | Fires when user input (keyboard, mouse, programmatic `send()`) is generated. Forward this to your PTY / WebSocket. Returns a `Disposable`. |

### `Parser` — OSC handlers

| API | Source | Semantics |
| --- | --- | --- |
| `Parser.registerOscHandler(id, handler)` | `src/types.ts:408` | Register an OSC handler. The handler receives the raw payload string and returns `true` to stop propagation. OSC 133 (shell integration) is **not** auto-handled — consumers opt in. |

### Theme and color utilities

| API | Source | Semantics |
| --- | --- | --- |
| `Terminal.options.theme` (read/write) | `src/types.ts:475` | Live-mutable. To apply changes after construction, mutate then call `Terminal.refresh()`. |
| `buildPalette`, `hexToPalette`, `hexToRgb`, `paletteToHex`, `paletteToRgb`, `rgbToHex`, `rgbToPalette`, `ANSI_COLORS` | `src/index.ts:30` | Pure helpers for working with the 256-color palette and RGB conversions. |
| `EventEmitter` | `src/index.ts:45` | The internal emitter shim, exported so consumers can reuse it. |

### Type exports

All types in `src/types.ts` are re-exported from `src/index.ts:15`:
`Terminal`, `TerminalOptions`, `Theme`, `Buffer`, `BufferCell`,
`BufferLine`, `BufferNamespace`, `Disposable`, `OscHandler`, `Parser`.

## Out of contract

Everything in this section is **not** part of the contract. We may
rename, reshape, or delete it between any two patch versions. Consumers
that depend on these will break.

- **`Terminal.renderer`** (`src/terminal.ts:282`). This getter returns
  the internal `AceRenderer` as `unknown`. It exists for emergency
  diagnostics, not for production use. Do not type-assert it and call
  methods.
- **The Ace editor underneath**, reachable via
  `(terminal.renderer as AceRenderer).getEditor()`. Specifically:
  - `editor.renderer.updateFull()` — bypasses our write-quiesce barrier.
    This is the call that caused **mobux PR #79** (the "zombie rows"
    incident). Use `Terminal.refresh()` instead.
  - `editor.resize()` — bypasses our `ResizeObserver` coalescing. The
    `ResizeObserver` installed by sterk already handles container
    pixel-size changes; you don't need to call this.
  - `editor.session`, `editor.renderer.*`, `editor.getSession()`, any
    other Ace internal.
- **Private fields on `TerminalImpl`** — `aceRenderer`, `inputHandler`,
  `mouseHandler`, `linkDetector`, `bufferNamespace`, `vtParser`.
  TypeScript marks them `private`; reaching them via runtime escape
  hatches is not supported.
- **Modules not re-exported from `src/index.ts`** — `src/renderer/*`,
  `src/parser/*`, `src/buffer/*`. Even if a deep import path works
  today, it is not part of the contract.

### Why this matters

Sterk writes to the Ace document **asynchronously**. Every `write()`
mutates the buffer immediately but schedules the document sync onto the
next animation frame, so a burst of writes lands as one paint. If you
force a repaint mid-burst, Ace paints a half-synced document.

This is exactly what bit mobux PR #79: the consumer worked around a
container-resize bug by calling `editor.resize(true) + renderer.updateFull()`.
The `updateFull()` call caught Ace mid-sync, producing duplicate prompt
lines and stale rows interleaved with fresh output. The PR was reverted
in mobux #80, and the architectural fix landed here as `Terminal.refresh()`
plus the `ResizeObserver` (kattebak/sterk#14, kattebak/sterk#16).

If you find yourself wanting to call an Ace method, that's a signal
sterk's public surface is missing a recipe. **Open an issue, don't reach
in.**

## Recipes

### "I need to force a redraw"

Use `Terminal.refresh()`. It awaits the next coalesced flush, so the
document is in steady state before Ace repaints, then triggers Ace's
full repaint.

```ts
await terminal.refresh();
```

**Do not** call `terminal.renderer.editor.renderer.updateFull()`. That
is the mobux #79 trap.

### "I changed the theme and need it to apply"

Mutate `terminal.options.theme`, then call `refresh()`:

```ts
terminal.options.theme = { background: "#202020", foreground: "#e0e0e0" };
await terminal.refresh();
```

### "The container resized via CSS (no `window.resize`)"

Nothing. `AceRenderer` installs a `ResizeObserver` on its host container
in `open()` and forces Ace to re-measure on the next rAF. This is the
fix for the Android soft-keyboard case where only `visualViewport.height`
changes — see `src/renderer/ace_renderer.ts:135`.

If you also need to change the *grid* (cols × rows) because the new pixel
size implies a different cell count, call `terminal.resize(cols, rows)`
separately. The `ResizeObserver` only invalidates Ace's pixel cache; it
does not reflow cell counts.

### "I want to know when a write has been rendered"

`await terminal.refresh()`. This resolves after the next coalesced flush
has applied buffer state to the Ace document and a repaint has been
committed. (`Terminal.write(data, callback)` invokes the callback after
the *parse* completes, which is synchronous and happens before the
render flush — useful for "buffer changed" hooks, not for "pixels are on
screen".)

For a stream of "buffer mutated" events, use `Terminal.onWriteParsed`.

### "Mouse / keyboard custom handling"

The input adapter pattern lives in `src/renderer/input.ts`:

- `keyboardEventToSequence(event)` (`src/renderer/input.ts:74`) is a pure
  function from `KeyboardEvent` to a VT byte sequence. If you want to
  intercept or transform a key (e.g. swap Caps-Lock for Ctrl, inject a
  custom binding), wrap this and call `terminal.send()` with the result.
- `InputHandler` (`src/renderer/input.ts:145`) owns the listeners and
  IME composition state. Sterk installs one automatically on the editor
  element when you call `open()`.
- For mouse input, see `src/renderer/mouse.ts` (drag / wheel → scroll
  + mouse-tracking byte sequences).

If you need behavior that neither file covers (custom touch gestures,
multi-key chords), build it on top: listen to your own DOM events and
call `terminal.send()`.

### "I want to swap the bundled font"

Sterk ships 5 monospace fonts under `assets/fonts/`; the constructor
defaults to JetBrains Mono. Swap at runtime via `setFont(id)`:

```ts
import { createTerminal, BUILTIN_FONTS } from "@kattebak/sterk";

const term = createTerminal();             // default: JetBrains Mono
term.open(document.getElementById("terminal"));

term.setFont("source-code-pro");           // narrow, good for phones

for (const f of Object.values(BUILTIN_FONTS)) {
  console.log(f.id, f.family);             // build a picker UI
}
```

`setFont()` lazily injects **two** `@font-face` rules into a shared
`<style id="sterk-fonts">` element (idempotent across instances and
across repeated calls for the same id), updates the renderer family with
`monospace` as the fallback, and schedules a coalesced repaint — same
race-safe path as `setTheme()`. The two rules:

1. The **primary** face — a subset of the upstream regular weight that
   covers Basic Latin, Latin-1/Extended-A, plus the TUI ranges the
   upstream ships natively (Box Drawing, Block Elements, Geometric
   Shapes, Arrows, Dingbats where present).
2. A shared **symbol-fallback** face (`SterkTUISymbols`, a renamed
   subset of DejaVu Sans Mono per the Bitstream Vera license) aliased
   under the same family name but constrained via `unicode-range` to
   `U+2190-21FF, U+2500-257F, U+2580-259F, U+25A0-25FF, U+2700-27BF`.
   The browser only downloads it on first use, only resolves to it for
   code points the primary woff2's cmap lacks, and shares it across
   every primary family (downloaded at most once per page).

This means TUI characters Claude Code relies on heavily — box-drawing
borders (`─ ┌ ┐ │`), block elements (`▌ ▘ █`), geometric shapes
(`● ◆ ▶`), arrows (`→ ← ↑ ↓`), and heavy dingbats (`✱ ✓ ➜ ✶`) —
all render in a properly-designed monospace face, not the OS-default
fallback they would otherwise drop down to. (See `assets/fonts/LICENSES.txt`
for the full per-font attribution including the Bitstream Vera notice
for `SterkTUISymbols.woff2`.)

To **opt out** of the bundled default entirely (e.g. consumer ships its
own Nerd Font + glyph patch), pass `font: ""` with your own `fontFamily`:

```ts
createTerminal({ font: "", fontFamily: '"FiraCode Nerd Font", monospace' });
```

### "I need OSC 133 (shell integration)"

```ts
const handle = terminal.parser.registerOscHandler(133, (data) => {
  const kind = data.charAt(0); // 'A' | 'B' | 'C' | 'D'
  // ... your prompt-boundary logic ...
  return true; // stop propagation
});

// Later:
handle.dispose();
```

OSC 133 is not auto-handled by sterk; consumers opt in. This is the
canonical example of how the parser surfaces VT sequences as a
first-class primitive instead of forcing you to monkey-patch.

## Why we own this

Sterk used to leak "trigger a redraw" and "react to container resize"
responsibilities up to the consumer, on the assumption that a consumer
knows its own layout system best. The mobux postmortem
([mvhenten/mobux#81](https://github.com/mvhenten/mobux/issues/81))
proved this was wrong:

1. The consumer hit a container-resize edge case (Android soft keyboard
   changes `visualViewport.height` without firing `window.resize`).
2. Sterk had no API to react, so the consumer reached into Ace
   (`editor.resize(true) + renderer.updateFull()`).
3. Sterk's write pipeline is async (buffer → rAF → document), so the
   forced repaint caught the document mid-sync and produced zombie rows.
4. The fix was reverted ([mobux#80](https://github.com/mvhenten/mobux/pull/80)),
   the design tension was named, and the responsibility was pulled into
   sterk in [kattebak/sterk#14](https://github.com/kattebak/sterk/issues/14).

The lesson: any responsibility we leak to the consumer will, eventually,
be implemented incorrectly — because the consumer cannot see sterk's
internal scheduling. The fix is to own the responsibility ourselves and
expose a narrow, race-safe API. That is what `Terminal.refresh()` and
the `ResizeObserver` are.

If you spot another responsibility that's currently leaking, please open
an issue. The rule is: **if a consumer would need to call an Ace method
to do it correctly, sterk is missing the API.**
