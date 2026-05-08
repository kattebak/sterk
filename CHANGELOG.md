# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Renderer**: Force `editor.resize(true)` on `open()` to ensure Ace measures layout correctly when attached to pre-sized containers
- **Renderer**: Render SGR colors and text attributes (bold, italic, underline, dim, inverse) via custom Ace tokenizer
  - ANSI colors (0-15) via SGR 30-37, 40-47, 90-97, 100-107
  - 256-color palette via SGR 38;5;N and 48;5;N
  - 24-bit truecolor via SGR 38;2;R;G;B and 48;2;R;G;B
  - Bold, italic, underline, dim text attributes
  - Inverse video (swaps fg/bg)
  - CSS class-based rendering for palette colors
  - Dynamic CSS injection for truecolor

### Added

- **M4: Polish & 1.0 Release Prep**
  - Alternate screen buffer support (DECSET/DECRST modes 1047, 1048, 1049)
  - Cursor save/restore (DECSC/DECRC via ESC 7 / ESC 8 and CSI s / CSI u)
  - Bundle size budget script (`npm run size`) with 75 kB soft limit
  - Standalone demo page (`demo/index.html`) with theme switching and OSC 133 examples
  - Comprehensive API documentation in README with usage examples
  - Contributing guidelines (CONTRIBUTING.md) with clean-room development rules
  - 12 new tests for alternate screen buffer functionality (250 tests total)

- **M3: Ace Renderer Glue** (merged)
  - Ace `EditSession` bridge with incremental buffer updates
  - Keyboard input → VT sequence translation (arrows, function keys, Ctrl, Alt)
  - Mouse support (VT mouse protocol X10, SGR mode 1006, wheel, touch scroll)
  - Link detection (URLs, file paths) with hover/click events
  - Theme mapping with live theme switching support
  - Stable DOM class names (`.sterk-*`) for consumer CSS targeting
  - Font size coordination and cell metrics calculation

- **M2: Clean-Room VT Core** (merged)
  - Paul Williams' DEC-compatible VT parser state machine
  - Full SGR support (ANSI/bright colors, 256-color, truecolor, bold/italic/underline/inverse/dim)
  - C0 controls (BEL, BS, HT, LF, CR)
  - CSI sequences (cursor movement, erase display/line)
  - OSC handler registration system (titles, shell integration)
  - UTF-8 aware parsing
  - 174 tests with golden coverage of shell/tmux/vim sequences

- **M1: Foundation Utilities** (merged)
  - 256-color palette (ANSI 0-15, 6×6×6 RGB cube, 24-step grayscale)
  - RGB ↔ palette ↔ hex color conversions
  - Ring buffer for terminal lines with full SGR attributes
  - Line wrapping support
  - Node-style EventEmitter for browser

- **M0: API Contract** (merged)
  - Complete TypeScript type definitions
  - `Terminal`, `Buffer`, `BufferLine`, `BufferCell` interfaces
  - `Parser` with OSC handler registration
  - `Theme` and `TerminalOptions` configuration types
  - Public API surface defined in `src/types.ts`

### Changed

- **M3**: Updated buffer interface to support alternate screen (normal/alternate split)
- **M3**: Renderer now handles buffer switching for alternate screen modes

### Documentation

- Comprehensive README with installation, usage, API reference, and design principles
- JSDoc comments on all public exports with `@example` tags
- Demo page with interactive examples of VT features and themes
- Contributing guide with clean-room development rules

### Infrastructure

- Semantic-release with automated versioning and changelog generation
- Bundle size verification with budget enforcement
- 11 test files, 250 tests, all passing
- Biome for linting and formatting
- TypeScript strict mode enabled
- CI workflow (lint, typecheck, test, build, publish)

## References

- [Paul Williams VT500 Parser](https://vt100.net/emu/dec_ansi_parser)
- [XTerm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html)
- [ECMA-48 Standard](https://www.ecma-international.org/publications-and-standards/standards/ecma-48/)
- [Terminal Guide](https://terminalguide.namepad.de/)
- [Ace Editor](https://ace.c9.io/)
