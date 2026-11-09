# Changelog

All notable changes to SpinDecide are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.0] - 2026-11-09

First public release.

### Added
- **Elimination mode** (Settings → Game Rules): each Grand Winner leaves the wheel until scores are reset.
- **Share links** (File → Copy Share Link): the list is compressed into the URL fragment, so it is never sent to a server. Opening a link asks before replacing the wheel. Image-URL icons are left out of links.
- **Presenter mode**: full-screen wheel with the side panel hidden. Press <kbd>P</kbd> to toggle and <kbd>Space</kbd> to spin.
- **Undo** (toast button, header button, or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Z</kbd>) for deletes, clears, resets, imports, shuffles, theme changes, and the last spin.
- Keyboard and screen-reader support: labelled controls, arrow-key tabs, announced spin results, and focus-trapped dialogs that close with <kbd>Esc</kbd>.
- Warning when browser storage is full or unavailable, instead of silently not saving.
- Docker image served by nginx with a strict Content Security Policy and security headers.
- Playwright end-to-end tests, CI, and a GitHub Pages deploy workflow.

### Changed
- All scripts, styles, and fonts are bundled in the repo; the page makes no third-party requests.
- CSV import follows standard CSV quoting (commas and line breaks inside quotes, `""` escapes) and skips a header row.
- Spins and shuffles use the browser's cryptographic random number generator.
- The OS "reduce motion" setting caps spins at 2 seconds and turns off the idle spin and CSS animations.
- Default entries are "Option 1" through "Option 5".
- The "netwrix" color palette is renamed "violet".
- JSON export downloads as a file blob, which works for large lists.
- The wheel renders sharply on high-DPI screens, and labels shrink to stay clear of the center button.

### Removed
- Third-party branding and logo assets.
- Banner, logo, and icon image URLs that don't use `https://` (or `data:`). They are dropped when a saved list loads, because the Content Security Policy blocks them.

### Security
- Fixed HTML injection: entry text, labels, list names, and history from imported files or browser storage could run script. All untrusted text is now escaped, and imported data is validated before it is applied.

[Unreleased]: https://github.com/egarlepp/spindecide/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/egarlepp/spindecide/releases/tag/v1.3.0
