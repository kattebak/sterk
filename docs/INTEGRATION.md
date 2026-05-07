# Integration Guide: Mobux → Sterk

This document outlines the plan for replacing mobux's vendored c9/aceterm with `@kattebak/sterk`.

## Reference Consumer

**Mobux** is the reference implementation consumer. It's a touch-friendly tmux web UI built with Rust (axum backend) and vanilla JS (frontend). Mobux currently uses a vendored, patched version of c9/aceterm (Ace-based terminal renderer + libterm VT parser).

Repository: https://github.com/mvhenten/mobux  
Live branches:
- `main` — xterm.js-based renderer (mobile gestures work, reader view limited by xterm.js buffer API)
- `spike-aceterm` — c9/aceterm-based renderer (reader view fully featured, licensing unclear)

## Current Architecture (spike-aceterm branch)

### Files that Import TerminalCore

1. **`web/static/terminal.js`** (276 lines)
   - Creates TerminalCore instance
   - Wires WebSocket connection lifecycle
   - Manages touch gestures (scroll, pinch-zoom, swipe between windows, tap-to-open-URLs)
   - Handles mobile input bar
   - Coordinates view swapping between xterm and reader modes
   - Exposes `window.__mobuxView` test interface

2. **`web/static/reader-view.js`** (318 lines)
   - ReaderView class: renders buffer content as semantic HTML blocks (prompts, code, text)
   - Reads buffer via `core.getActiveBuffer()` and walks line-by-line with `buffer.getLine(y)`
   - Accesses per-cell attributes: `cell.getFgColor()`, `cell.getBgColor()`, `cell.isBold()`, etc.
   - Subscribes to buffer changes via `core.term.onWriteParsed()`
   - Uses OSC 133 markers (`core.oscMarkers`) to detect prompt boundaries

3. **`test/smoke.spec.cjs`** (549 lines, Playwright)
   - Smoke tests covering:
     - Terminal rendering and WebSocket connection
     - Scroll via touch gestures
     - Window switching (tmux prev/next window)
     - URL tap-to-open detection
     - Reader view rendering and synthetic scroll
     - View persistence across page reloads
     - OSC 133 shell integration hint visibility
   - Injects synthetic data via `window.__mobuxView.test.inject()` and `injectLines()`
   - Asserts on buffer state: `bufferLength()`, `viewportY()`, `terminalRows()`

### What They Need

| Component | Terminal API Used |
|-----------|-------------------|
| `terminal.js` | `term.write()`, `term.resize()`, `term.cols`, `term.rows`, `term.options.fontSize`, `term.scrollLines()`, `term.scrollToBottom()`, `term.clear()`, `term.onData()`, `buffer.active.viewportY`, `buffer.active.length`, `buffer.active.getLine()` |
| `reader-view.js` | `term.onWriteParsed()`, `buffer.active.length`, `buffer.getLine(y).translateToString()`, `buffer.getLine(y).getCell(x)`, cell color/style accessors (`getFgColor`, `getBgColor`, `isBold`, `isItalic`, `isUnderline`, `isInverse`, `isDim`), `term.parser.registerOscHandler()` (OSC 133) |
| `smoke.spec.cjs` | `term.write()`, `term.resize()`, `term.rows`, `buffer.active.viewportY`, `buffer.active.length`, synthetic event helpers via `__mobuxView` test interface |

### TerminalCore Responsibilities (mobux's facade)

TerminalCore wraps the underlying terminal (currently c9/aceterm, future: sterk) and provides:
- WebSocket lifecycle management (connect, reconnect, send)
- Resize coordination (measure host element, compute cols/rows, notify backend)
- Pane (tmux window) list management via mobux's REST API
- Window switching commands (prev/next window, clear + history reload)
- OSC 133 handling (detect shell integration, maintain marker map)
- Touch gesture wiring (relays to underlying terminal's scroll, input handlers)

## Swap Plan

### Phase 1: Adapter Layer (Day 1)

Replace `web/static/terminal-core.js`'s `makeAcetermAdapter()` function with a thin adapter over `@kattebak/sterk`:

```typescript
import { createTerminal } from '@kattebak/sterk';

function makeSterkAdapter(host, sendCb) {
  const theme = getTheme(getStoredThemeId());
  const term = createTerminal({
    cols: 120,
    rows: 35,
    scrollback: 10000,
    fontSize: 13,
    fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace",
    theme: {
      foreground: theme.foreground,
      background: theme.background,
      palette: theme.palette,
    },
  });

  // Wire OSC 133 handler (same as existing aceterm handler)
  term.parser.registerOscHandler(133, (data) => {
    const kind = data.charAt(0);
    if (kind !== 'A' && kind !== 'B' && kind !== 'C' && kind !== 'D') return;
    const buffer = term.buffer.active;
    const absY = buffer.baseY + buffer.cursorY;
    this.oscMarkers.set(absY, kind);
    if (!this.oscDetected) {
      this.oscDetected = true;
      this.dispatchEvent(new Event('osc-detected'));
    }
  });

  // Wire onData to sendCb for user input
  term.onData(sendCb);

  // Mount to host element (sterk handles DOM injection)
  term.mount(host);

  return term;
}
```

Key differences from aceterm adapter:
- **No touch scroll interception** — sterk's Ace renderer layer handles this natively
- **No class name aliasing** — sterk emits xterm-compatible class names out of the box
- **No manual scrollback locking** — sterk always preserves scrollback for reader view
- **Simpler theme wiring** — sterk accepts theme in constructor, no separate `setColors()` call

### Phase 2: Validation (Day 1-2)

1. Run mobux's smoke test suite against the sterk-backed build:
   ```bash
   cd mobux
   npm run build  # rebuild with sterk adapter
   npm run dev    # start local server
   npm test       # run Playwright smoke tests
   ```

2. Acceptance criteria (all tests must pass):
   - Terminal renders and connects within 5 seconds
   - Scroll gestures update `viewportY` correctly
   - Window switching clears buffer and reloads history
   - URL tap detection finds links in buffer text
   - Reader view renders buffer with correct tokenization
   - Reader scroll physics match xterm view
   - OSC 133 integration hint appears/dismisses correctly
   - Buffer cell color/style attributes match expected values

3. Manual verification (phone/tablet):
   - Touch scroll feels smooth (no janky reflows)
   - Pinch-zoom resizes font without breaking layout
   - Input bar keyboard shows/hides without clipping viewport
   - Reader view bubbles render with correct backgrounds
   - Tmux status bar pins to bottom correctly

### Phase 3: Cleanup (Day 3)

Once tests pass:
- Remove vendored c9/aceterm bundle (`vendor/aceterm.bundle.js`)
- Delete aceterm-specific shims and polyfills
- Update mobux's package.json to depend on `@kattebak/sterk`
- Update docs to reflect the new terminal stack
- Archive `spike-aceterm` branch or merge to main

## Acceptance Criteria

**Zero changes to `terminal.js` and `reader-view.js`** — they should work identically with sterk as they do with aceterm.

Specific requirements:
1. All smoke tests pass without modification
2. Buffer API matches exactly: `getLine(y).getCell(x)` returns cells with all color/style accessors
3. OSC 133 markers populate `oscMarkers` map correctly
4. `onWriteParsed` callback fires after every write (history, WS data, synthetic injects)
5. Scroll viewport (`viewportY`) updates correctly on touch scroll and `scrollLines()`
6. Font size changes via `term.options.fontSize` resize the grid and trigger redraw
7. Reader view tokenizer sees the same buffer content and cell attributes
8. No visual regressions (colors, fonts, spacing, cursor positioning)
9. No performance regressions (scroll lag, memory leaks, battery drain)

## Compatibility Notes

### xterm.js API Surface (Minimal)

Mobux's code paths touch a small subset of the xterm.js API:
- `term.write(data)` — VT data ingestion
- `term.resize(cols, rows)` — grid resize
- `term.cols`, `term.rows` — dimensions
- `term.options.fontSize` — live font size mutation
- `term.scrollLines(n)`, `term.scrollToBottom()` — viewport scroll
- `term.buffer.active` — buffer accessor
- `buffer.length`, `buffer.viewportY`, `buffer.baseY`, `buffer.cursorX`, `buffer.cursorY`
- `buffer.getLine(y).translateToString()`, `buffer.getLine(y).getCell(x)`
- `cell.getChars()`, color/style accessors
- `term.onWriteParsed(cb)`, `term.onData(cb)` — event subscriptions
- `term.parser.registerOscHandler(id, cb)` — OSC 133 registration

Sterk's API contract (see `src/types.ts`) guarantees 1:1 compatibility for these methods.

### Not Used by Mobux (Safe to Defer)

The following xterm.js features are **not** used by mobux and can be deferred or omitted:
- Addons (WebLinksAddon, FitAddon, SearchAddon) — mobux implements these inline
- `onResize`, `onTitleChange`, `onBell` — mobux doesn't subscribe to these
- `loadAddon()`, `attachCustomKeyEventHandler()` — not used
- Cursor style/blink configuration — mobux accepts defaults
- Selection API (`getSelection()`, `selectAll()`) — mobux uses native browser selection
- Markers API — mobux uses OSC 133 via `registerOscHandler`, not xterm's Marker objects

## Future Enhancements

Once the basic swap is complete, consider:
1. **Native mobile selection** — sterk could expose a touch-friendly selection API
2. **Gesture-aware link detection** — tap-to-link currently re-scans buffer text; sterk could cache URL ranges
3. **Incremental reader rendering** — only re-render changed blocks instead of full buffer
4. **WebGL renderer option** — for large scrollback on desktop
5. **OSC 633 support** (VS Code shell integration) — additional prompt markers

## Questions / Design Decisions Needed

1. **Ace theme loading** — sterk will need to bundle or fetch Ace themes. Should it:
   - Bundle common themes (monokai, tomorrow, github)?
   - Load themes dynamically via CDN?
   - Require consumers to pre-load themes?

2. **Touch scroll physics** — mobux currently uses its own gesture recognizer with custom fling/deceleration. Should sterk:
   - Expose scroll physics configuration (friction, max velocity)?
   - Accept an external gesture controller?
   - Provide its own opinionated touch handler?

3. **Buffer reflow on resize** — xterm.js reflows scrollback when cols change. Should sterk:
   - Match xterm.js reflow behavior exactly?
   - Provide a `preserveScrollback` option to disable reflow?
   - Emit a `reflow` event so consumers can react?

4. **Font measurement** — mobux currently reads Ace's `characterWidth` and `lineHeight` from the renderer. Should sterk:
   - Expose these via `term.metrics.charWidth` / `term.metrics.lineHeight`?
   - Let consumers measure themselves via `getComputedStyle`?
   - Fire a `metrics-changed` event on font/theme changes?

---

**Last updated:** 2026-05-06  
**Status:** M0 (API contract defined, integration plan documented)
