# @kattebak/sterk

[![Node.js CI](https://github.com/kattebak/sterk/actions/workflows/node.js.yml/badge.svg)](https://github.com/kattebak/sterk/actions/workflows/node.js.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Sterk is a touch-friendly terminal emulator for the web. It pairs Ace's mature text-rendering engine with a clean-room VT core, and treats shell-integration (OSC 133) as a first-class primitive rather than an extension.

## Status

**Milestone 0 (M0): API Contract Defined ✅**

The public API surface is documented in `src/types.ts`. The constructor stub (`createTerminal()`) is available for type-checking but throws "not implemented" when called.

**Next:** M1 (Non-Encumbered Lift) — extract clean components from c9/aceterm with proper attribution.

See [docs/ROADMAP.md](./docs/ROADMAP.md) for full implementation roadmap.

## Reference Consumer

**mobux** (https://github.com/mvhenten/mobux) — Touch-friendly tmux web UI. The API contract in this repo is derived from mobux's existing `TerminalCore` facade. Mobux's smoke tests define the acceptance criteria for sterk.

See [docs/INTEGRATION.md](./docs/INTEGRATION.md) for the detailed integration plan.

## Installation

```bash
npm install @kattebak/sterk
```

**Note:** The constructor currently throws "not implemented". This is intentional — M0 is type definitions only. Runtime implementation lands in M1+.

## License

MIT © 2026 Matthijs van Henten / kattebak
