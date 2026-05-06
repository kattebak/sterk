# Roadmap

Sterk is being built in deliberate milestones to ensure clean-room implementation and maintain clear licensing boundaries.

## M0: API Contract ✅ (Current)

**Goal:** Define the public API surface that mobux requires, establish integration plan, and set up type-safe development workflow.

**Scope:**
- TypeScript interface definitions (`src/types.ts`)
  - `Terminal` interface (write, resize, buffer access, event subscriptions)
  - `Buffer` / `BufferLine` / `BufferCell` interfaces (read-only buffer access with full color/style attributes)
  - `Parser` interface with `registerOscHandler()` for OSC 133
  - `TerminalOptions` and `Theme` configuration
  - Event types: `onWriteParsed`, `onData`
- Constructor stub (`createTerminal()`) that throws "not implemented" with clear error message
- Documentation
  - `INTEGRATION.md` — mobux integration plan, swap strategy, acceptance criteria
  - `ROADMAP.md` — this document
  - README status section pointing to roadmap
- Type-level tests confirming interfaces compile and stub throws

**Exit Criteria:**
- ✅ All types documented with JSDoc
- ✅ Constructor stub throws with actionable error message
- ✅ Integration doc covers mobux's current usage and swap plan
- ✅ Vitest type assertions pass (`expectTypeOf` checks)
- ✅ CI green (lint, typecheck, test)
- ✅ PR open and reviewed

**Non-goals:**
- No runtime implementation
- No c9/aceterm code review or analysis (licensing unclear — intentionally staying away)

---

## M1: Non-Encumbered Lift

**Goal:** Extract and port the unambiguously clean components from c9/aceterm with proper attribution. Build the foundation layer without touching VT parsing logic.

**Scope:**
1. **WC (256-color palette utilities)**
   - Port `term_colors.js` (ANSI palette, XTerm 256 color cube, grayscale ramp)
   - RGB ↔ palette conversion helpers
   - These are mathematical algorithms (public domain / trivial), not creative implementations
   - Attribution: note that the color cube formula matches XTerm's spec

2. **Scrollback buffer (`scroll_buffer.js`)**
   - Ring buffer for terminal lines
   - Line wrapping / reflow logic
   - No VT parsing — just data structure
   - Clean-room rewrite in TypeScript with tests
   - Ensure mobux's reader view can walk the buffer line-by-line

3. **Shims and polyfills**
   - EventEmitter compatibility layer (Node.js EventEmitter API for browser)
   - Minimal DOM helpers (if needed)
   - These are standard patterns, not c9-specific implementations

4. **Tests**
   - Unit tests for color conversion (palette ↔ RGB)
   - Unit tests for scrollback buffer (insert, scroll, wrap, reflow)
   - No integration tests yet (no VT core to integrate with)

**Exit Criteria:**
- `wc/term_colors.ts` passes all color conversion tests
- `buffer/scroll_buffer.ts` stores lines and handles scrollback correctly
- All code includes clear attribution comments where ported
- No copied code from ambiguously-licensed files (libterm, escape sequence parser)
- CI green
- PR reviewed and merged

**Non-goals:**
- No VT parsing (deferred to M2)
- No rendering (deferred to M3)
- No Ace integration yet

---

## M2: Clean-Room VT Core

**Goal:** Build a from-scratch VT parser that implements the subset of escape sequences mobux needs. Zero reference to c9/aceterm's libterm implementation.

**Reference Sources (Clean):**
- VT100 / VT220 / XTerm control sequence documentation (Paul Williams' parser state machine)
- [XTerm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html) (canonical reference)
- [ANSI escape code - Wikipedia](https://en.wikipedia.org/wiki/ANSI_escape_code)
- [Terminal Guide](https://terminalguide.namepad.de/) (excellent modern reference)

**Scope:**
1. **State machine parser**
   - Implement Paul Williams' DEC-compatible parser state machine
   - States: GROUND, ESCAPE, CSI_ENTRY, CSI_PARAM, CSI_INTERMEDIATE, OSC_STRING, etc.
   - Clean-room: write from spec, not by reading libterm's implementation

2. **Escape sequence handlers**
   - CSI sequences: cursor movement (`CUU`, `CUD`, `CUF`, `CUB`, `CUP`), erase (`ED`, `EL`), SGR (colors, bold, underline, etc.)
   - OSC sequences: title (`OSC 0`, `OSC 2`), shell integration (`OSC 133`)
   - C0 control codes: `\r`, `\n`, `\b`, `\t`, `\x1b`
   - Ignore unsupported sequences gracefully (log warnings in dev mode)

3. **Buffer mutations**
   - Write character at cursor position
   - Apply SGR attributes to current cell
   - Advance cursor, handle wrapping
   - Scrollback buffer integration (from M1)

4. **OSC 133 first-class support**
   - Parse `OSC 133 ; A/B/C/D ST` and invoke registered handlers
   - Mobux's reader view depends on this for prompt detection
   - Must be implementable without monkey-patching

5. **Tests**
   - Golden file tests: parse VT sequences, compare buffer output to expected
   - Sequence coverage: common tmux output, vim, shell prompts, ANSI art
   - OSC 133 marker tests: verify handler invocations
   - Regression tests against mobux's current output (capture from spike-aceterm, replay through sterk)

**Exit Criteria:**
- Parser handles all sequences mobux currently encounters (tmux, bash, vim, less)
- OSC 133 handler API works as specified in `src/types.ts`
- Buffer output matches expected golden files (95%+ coverage of common sequences)
- No undefined behavior on malformed sequences (parser degrades gracefully)
- CI green with full test suite
- PR reviewed and merged

**Non-goals:**
- DEC private modes that mobux doesn't use (e.g. DEC line drawing, double-height lines)
- Sixel graphics (no consumer need)
- Bracketed paste mode (nice-to-have, deferred to M4 polish)

---

## M3: Ace Renderer Glue

**Goal:** Replace aceterm's Ace integration layer with a clean-room equivalent. Wire sterk's VT core to Ace's text editor for rendering.

**Scope:**
1. **Ace session bridge**
   - Map sterk's scrollback buffer to Ace's Document model
   - Incremental updates: only modify changed lines (not full rewrite on every `write()`)
   - Handle alternate screen buffer (vim/less) by swapping Ace sessions

2. **Renderer coordination**
   - Cursor positioning: map buffer cursor (x, y) to Ace row/column
   - Viewport scroll: translate `scrollLines()` and `scrollToBottom()` to Ace's `setScrollTop()`
   - Font size changes: call `editor.setFontSize()` and trigger resize

3. **Input handling** (`input.js` replacement)
   - Keyboard event → VT sequence translation (arrow keys, function keys, modifiers)
   - Composition events (IME) → UTF-8 output
   - Wire to `onData()` callback

4. **Mouse handling** (`mouse.js` replacement)
   - Mouse button clicks → VT mouse protocol sequences (if terminal is in mouse mode)
   - Mouse wheel → scroll OR VT mouse sequences (depending on app mode)
   - Touch scroll integration (use mobux's existing gesture recognizer or provide built-in handler)

5. **Link detection** (`hover_link.js` replacement)
   - Scan buffer text for URLs/file paths on hover/tap
   - Optional: emit `link-hover` / `link-click` events for consumers to handle
   - Mobux currently does this inline; sterk could optionally provide a helper

6. **Theme integration**
   - Map sterk's `Theme` interface to Ace's theme format
   - Support live theme swapping (mobux's theme picker)
   - Ensure ANSI palette colors render correctly

7. **xterm-compatible DOM structure**
   - Emit `.xterm-viewport`, `.xterm-screen`, `.xterm-rows` class names for mobux compatibility
   - Ace's native structure uses `.ace_scroller`, `.ace_text-layer` — alias or remap

**Exit Criteria:**
- Rendering matches current aceterm output visually (colors, fonts, spacing, cursor position)
- Input handling supports all keys mobux uses (arrow keys, Enter, Backspace, Ctrl-C, etc.)
- Touch scroll works smoothly on mobile (no janky reflows, no missed touches)
- Font size changes resize the grid without breaking layout
- Alternate screen buffer works (vim, less, htop render correctly)
- Links are detectable and tappable (mobux's `onTap` handler finds URLs)
- CI green with rendering tests (screenshot diffing or DOM snapshot assertions)
- PR reviewed and merged

**Non-goals:**
- WebGL renderer (nice-to-have, deferred to post-M4)
- Advanced selection modes (word/line selection, rectangular selection)

---

## M4: Mobux Integration PR

**Goal:** Replace mobux's vendored aceterm with `@kattebak/sterk` and pass all smoke tests with zero changes to `terminal.js` and `reader-view.js`.

**Scope:**
1. **Adapter replacement**
   - Replace `makeAcetermAdapter()` in `terminal-core.js` with `makeSterkAdapter()`
   - Wire OSC 133 handler (same logic, different API)
   - Wire touch scroll (if sterk provides built-in handler) or keep existing gesture recognizer

2. **Dependency update**
   - Remove vendored `vendor/aceterm.bundle.js`
   - Add `@kattebak/sterk` to package.json
   - Update build to import sterk via npm instead of script tag

3. **Testing**
   - Run full smoke test suite (`test/smoke.spec.cjs`)
   - All tests must pass without modification
   - Manual verification on phone/tablet (Android Chrome, iOS Safari)

4. **Documentation**
   - Update mobux README to mention sterk
   - Add migration notes (for other aceterm users who might want to follow)

5. **Performance validation**
   - Measure scroll FPS (target: 60fps on mid-range Android phone)
   - Measure memory usage (target: <50MB for 10k line scrollback)
   - Measure battery impact (target: no worse than aceterm)

**Exit Criteria:**
- All smoke tests pass (18/18 green)
- No visual regressions (screenshot diffing or manual QA)
- No performance regressions (FPS, memory, battery)
- Mobux PR merged and deployed to production
- Sterk 1.0.0 released to npm

**Non-goals:**
- New features beyond API parity (no new gestures, no new OSC sequences)
- Other consumers (focus on mobux first; broader adoption is post-1.0)

---

## Post-1.0 (Future)

Once mobux is successfully running on sterk in production, consider:

### Performance & Scale
- WebGL renderer for large scrollbacks (xterm.js has this, worth investigating)
- Virtual scrolling for reader view (only render visible blocks)
- Worker thread for VT parsing (keep main thread responsive)

### Features
- OSC 633 (VS Code shell integration) — additional prompt markers
- Bracketed paste mode — safer pasting of multi-line commands
- Hyperlinks (OSC 8) — clickable file paths, URLs with hidden labels
- Kitty graphics protocol — inline images in terminal output
- Sixel graphics — for retro ANSI art and plots

### Developer Experience
- Standalone demo page (like xterm.js's demo)
- Storybook for theme/config playground
- Performance profiling tools (built-in FPS counter, memory monitor)
- Better error messages (parse errors, unsupported sequences)

### Ecosystem
- React/Vue/Svelte wrapper components
- Electron integration guide
- Tauri integration guide
- VS Code extension (terminal emulator in sidebar)

---

## Licensing Strategy

**Core principle:** Sterk must be unambiguously MIT-licensed with no encumbered code.

**Approach:**
- M1: Port only the trivial/mathematical bits with clear attribution
- M2: Write VT parser from scratch using public specs (no c9/aceterm reference)
- M3: Write Ace integration from scratch (Ace itself is BSD-licensed, safe to use)
- Throughout: Document sources, attribute algorithms, avoid copy-paste

**If in doubt:** Re-implement from spec, don't port. Better to take 2x longer than to create a licensing timebomb.

---

## Timeline (Rough Estimates)

| Milestone | Estimated Duration | Status |
|-----------|-------------------|--------|
| M0 (API Contract) | 1 day | ✅ Complete |
| M1 (Non-Encumbered Lift) | 3-5 days | 🔜 Next |
| M2 (Clean-Room VT Core) | 2-3 weeks | ⏳ Planned |
| M3 (Ace Renderer Glue) | 2-3 weeks | ⏳ Planned |
| M4 (Mobux Integration) | 1 week | ⏳ Planned |
| **Total to 1.0** | **6-8 weeks** | |

**Note:** Estimates assume one developer working part-time (evenings/weekends). Full-time work would compress timeline to 3-4 weeks.

---

**Last updated:** 2026-05-06  
**Status:** M0 complete, awaiting PR review
