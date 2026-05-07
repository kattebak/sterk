# Roadmap

Sterk is built in deliberate, clean-room milestones. Each milestone is a publishable step.

## Design principles

- **Clean-room VT core.** Implement from public specs (Paul Williams VT500 parser, XTerm Control Sequences, ECMA-48). No code lifted from other emulators.
- **Ace handles rendering.** Sterk wires its parser/buffer to Ace; we don't reinvent text layout.
- **OSC 133 first-class.** Shell integration is built-in, not a plugin.
- **Pragmatic scope.** Feature parity with xterm.js is aspirational. Build what consumers need; ignore the long tail.

---

## M0 — API Contract ✅

Public TypeScript surface defined in `src/types.ts`: `Terminal`, `Buffer` / `BufferLine` / `BufferCell`, `Parser` (with `registerOscHandler`), `TerminalOptions`, `Theme`, event types. Constructor stub throws "not implemented".

## M1 — Foundation Utilities ✅

- `src/util/colors.ts` — 256-color palette: ANSI 0–15, 6×6×6 RGB cube, 24-step grayscale ramp; RGB ↔ palette ↔ hex conversions. Cube formula per XTerm spec.
- `src/buffer/scroll_buffer.ts` — ring buffer for terminal lines + cells with full SGR attributes; satisfies the `Buffer` / `BufferLine` / `BufferCell` interfaces.
- `src/util/event_emitter.ts` — Node-style EventEmitter for browser.

## M2 — Clean-Room VT Core ✅

- `src/parser/vt_parser.ts` — Paul Williams' DEC-compatible state machine. UTF-8 aware. OSC handler chain with propagation control.
- `src/parser/sgr.ts` — full SGR: ANSI/bright colors, 256-color palette (`38;5;n` / `48;5;n`), truecolor (`38;2;r;g;b` / `48;2;r;g;b`), styles (bold, dim, italic, underline, inverse), individual attribute resets.
- `src/terminal.ts` — `createTerminal(options)` returning a working headless `Terminal`. C0 controls, CSI cursor moves, ED/EL erase, OSC 0/1/2 (titles), OSC 133 (consumer-registered).
- 174 tests, golden coverage of common shell/tmux/vim sequences.

References used: Paul Williams VT500 parser (vt100.net), XTerm Control Sequences (invisible-island.net), ECMA-48, Terminal Guide.

## M3 — Ace Renderer Glue 🚧

- Ace `EditSession` bridge: incremental updates, alt-screen swap path
- Renderer coordination: cursor positioning, viewport scroll, font size
- `getCellMetrics()` returns real pixel dimensions once attached
- Input: keyboard → VT sequences (arrows, function keys, Ctrl combos, Alt-as-ESC, IME)
- Mouse: VT mouse protocol (X10, SGR mode 1006), wheel, basic touch scroll
- Link detection: scan visible buffer for URLs / file paths; emit hover/click events
- Theme mapping: `Theme` interface → Ace + CSS variables; live theme swap
- DOM hooks: stable class names so consumer CSS can target rows/viewport

## M4 — Polish & 1.0 Release

- Standalone demo page
- Bundle size budget + verification
- API stability review and docs pass
- Publish 1.0.0

---

## Post-1.0 (aspirational)

Driven by real consumer needs:

- Bracketed paste, OSC 8 hyperlinks, OSC 633 (VS Code shell integration)
- WebGL/canvas renderer alternative for very large scrollbacks
- Worker-thread parsing
- Framework wrappers (React/Vue/Svelte) when someone actually asks
- DEC private modes / sixel / kitty graphics — only if a consumer needs them

---

## Licensing

MIT throughout. The VT parser, SGR handling, color tables and Ace glue are all written from public specifications. Ace itself is BSD-licensed.
