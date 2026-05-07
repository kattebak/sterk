# Contributing to Sterk

Thank you for your interest in contributing to Sterk!

## Clean-room development

Sterk is built as a **clean-room implementation** from public specifications. When contributing:

- ✅ **DO** reference official specs: Paul Williams' VT500 parser (vt100.net), XTerm Control Sequences (invisible-island.net), ECMA-48, Terminal Guide (terminalguide.namepad.de)
- ✅ **DO** test against real terminals (iTerm2, Terminal.app, Alacritty, etc.)
- ❌ **DO NOT** read or copy code from other terminal emulators (xterm.js, hterm, etc.)
- ❌ **DO NOT** decompile or reverse-engineer proprietary terminal implementations

## Development workflow

1. **Fork and clone** the repository
2. **Install dependencies:** `npm ci`
3. **Make your changes** in a feature branch
4. **Run checks:** `npm run check` (lint + typecheck + tests)
5. **Format code:** `npm run fix`
6. **Test your changes:** `npm test`
7. **Commit with conventional commits:** `feat:`, `fix:`, `docs:`, `test:`, etc.
8. **Open a pull request** against `main`

### Before committing

Always run:
```bash
npm run fix     # Format + lint fixes
npm run check   # Verify everything passes
```

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) for automated versioning and changelog generation:

- `feat: add alternate screen buffer support` → Minor version bump
- `fix: correct cursor position after wrap` → Patch version bump
- `docs: update API examples` → No version bump
- `test: add golden tests for SGR` → No version bump

Breaking changes require a `BREAKING CHANGE:` footer or `!` after the type:
```
feat!: remove deprecated Buffer.getLineUnsafe()

BREAKING CHANGE: getLineUnsafe() has been removed. Use getLine() instead.
```

## Code style

- **TypeScript strict mode** — no `any`, prefer explicit types
- **No comments unless essential** — write self-documenting code
- **Return early** — avoid deep nesting
- **Fail fast** — don't catch-and-log errors without recovery
- **Small functions** — one responsibility per function

## Testing

- All new features **must** include tests
- Use existing test patterns: see `test/golden.test.ts` for VT sequences, `test/scroll_buffer.test.ts` for buffer tests
- Golden tests are preferred for parser/renderer behavior
- Run `npm test` to verify all tests pass

## Pull requests

- Keep PRs focused — one feature or fix per PR
- Update tests and docs as needed
- Ensure CI passes (all checks must be green)
- PRs require review before merge
- **Never** use `--admin` to bypass branch protection

## Questions?

Open an issue or discussion on GitHub. We're happy to help!

## License

By contributing to Sterk, you agree that your contributions will be licensed under the MIT License.
