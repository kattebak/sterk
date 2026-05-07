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
- ⏳ **M4** — Polish, docs, demo page, 1.0 release

See [docs/ROADMAP.md](./docs/ROADMAP.md).

## Installation

```bash
npm install @kattebak/sterk
```

`createTerminal()` currently returns a headless `Terminal` (parser + buffer + events). DOM rendering lands in M3.

## Design principles

- **Clean-room core.** The VT parser is written from public specs (Paul Williams' state machine, XTerm Control Sequences, ECMA-48). No code lifted from other emulators.
- **Ace does what Ace does well.** Text layout, scrolling, theming — we don't reinvent it.
- **OSC 133 first-class.** Shell integration (prompt markers, command boundaries) is a built-in concept, not a bolt-on.
- **Pragmatic feature scope.** Feature parity with xterm.js is aspirational. We build what real consumers need and skip the rest.

## License

MIT © 2026 Matthijs van Henten / kattebak
