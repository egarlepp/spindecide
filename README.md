# SpinDecide

A picker wheel and scoreboard that runs entirely in the browser. Add choices, spin, and track scores until one entry reaches the target and becomes the Grand Winner. There is no backend, and the page makes no third-party requests: every script, style, and font ships with the repo.

## Features

- **Weighted entries:** each entry has a weight that sets its slice size and its odds. Spins use the browser's cryptographic random number generator.
- **Spins to Win:** an entry must be landed on *N* times to win, so one lucky spin doesn't decide a close vote.
- **Elimination mode:** each Grand Winner comes off the wheel, for raffles and draft orders. Reset Scores brings eliminated entries back.
- **Scoreboard and history:** live scores per entry, plus a log of Grand Winners with timestamps.
- **Undo:** reverse deletes, clears, resets, imports, shuffles, and the last spin with the toast button, the header button, or Ctrl/Cmd+Z.
- **Share links:** File → Copy Share Link puts the whole list into a URL. Anyone who opens it can load the list after a confirmation prompt, and nothing is uploaded anywhere.
- **Presenter mode:** a full-screen wheel with the side panel hidden, for screen-sharing. Press **P** to toggle it and **Space** to spin.
- **Labels and icons:** show an alias instead of the raw entry text, and add a [Lucide](https://lucide.dev) icon or an `https://` image to each slice.
- **Import and export:** bulk-load entries from CSV, and back up or restore everything as JSON.
- **Saved lists:** keep several named lists in browser storage.
- **Appearance:** seven color palettes, dark mode, a custom spin button color, and an optional banner image or text and logo.
- **Accessible:** keyboard support throughout, screen-reader announcements of results, focus-trapped dialogs, and respect for the OS "reduce motion" setting.

### Keyboard shortcuts

| Key | Action |
| :-- | :-- |
| <kbd>Space</kbd> | Spin (when focus isn't in a field) |
| <kbd>P</kbd> | Toggle presenter mode |
| <kbd>Esc</kbd> | Close a dialog or menu, or leave presenter mode |
| <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Z</kbd> | Undo |

## Quick start

No build step is needed to run it. Either open `index.html` in a browser, or serve the folder:

```bash
npm start
```

That serves the app at <http://localhost:4173> with the same security headers as the Docker image. `python3 -m http.server` works too.

## Deployment

The deployable app is `index.html` plus the `assets/` and `vendor/` folders. Any static host works.

### GitHub Pages

The included workflow (`.github/workflows/pages.yml`) publishes the app on every push to `main`.

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. Push to `main`, or run the workflow manually from the **Actions** tab.

GitHub Pages can't set response headers. The Content Security Policy still applies through a `<meta>` tag in `index.html`; only `frame-ancestors` (clickjacking protection) needs the Docker or nginx setup.

### Docker

```bash
docker build -t spindecide .
```

```bash
docker run -d --name spindecide -p 8080:80 spindecide
```

The image is `nginx:1.30-alpine` with a health check. It sends a strict Content Security Policy and other security headers (`nginx/security-headers.conf`), gzips text assets, and caches `vendor/` for a week.

### Dokploy or another PaaS with Dockerfile builds

Point the service at this repository, set the build type to **Dockerfile**, and map container port `80`. Add a domain in the platform to get TLS.

## Importing data

Use **File → Load File (.json, .csv)**.

### CSV

Each row has up to three columns:

| Column | Field  | Required | Description                             |
| :----- | :----- | :------- | :-------------------------------------- |
| 1      | Text   | Yes      | Entry text                              |
| 2      | Label  | No       | Alias shown on the wheel and scoreboard |
| 3      | Weight | No       | Relative slice size (default `1`)       |

```csv
Text,Label,Weight
Identity Platform,Directory Services,1.5
Cloud Identity,,1.0
Privileged Access,PAM,1.0
"Data Security, Discovery",,2.0
```

A copy is in [`examples/sample_roster.csv`](examples/sample_roster.csv).

- Standard CSV quoting works: wrap a field in double quotes if it contains commas or line breaks, and write a literal quote as `""`.
- A header row such as `Text,Label,Weight` is detected and skipped.
- Rows are appended to the current list, up to 1,000 entries per list.

### JSON

**File → Save Data** with the storage method set to *File* (or *Both*) exports a `.json` backup containing every saved list and the current session. Load that file again to restore it. Imported files are validated and sanitized before anything changes, and the import can be undone.

## Data and privacy

- Lists, scores, history, and settings are stored **only in your browser** (`localStorage`) or in files you export. SpinDecide sends no data anywhere and loads nothing from third-party servers.
- **Share links** carry the list inside the URL fragment (`#list=…`). Browsers never send fragments to servers, but anyone who has the link can read the entries, so treat it like the list itself. Image-URL icons are left out of share links, so opening one never makes your browser fetch a URL the sender chose.
- **Image URLs** that you enter for the banner, logo, or icons are fetched from wherever they point. Only `https://` and `data:` image URLs are allowed.
- Clearing site data, using a private window, or switching browsers or devices loses anything that isn't exported. If browser storage fills up, the app shows a warning; export a backup when you see it.

## Limitations

- Single presenter: there is no real-time sync between browsers. Use presenter mode and share your screen.
- The wheel stays readable up to about 100 entries. Labels shrink and truncate to fit their slice.
- Share links for very large lists can exceed what some chat apps accept. Share a JSON export instead.
- Share links need a browser with `CompressionStream` (Chrome 80+, Firefox 113+, Safari 16.4+).

## Development

Requires Node.js 20 or newer.

```bash
npm install
```

| Command | What it does |
| :-- | :-- |
| `npm start` | Serve the app locally on port 4173 |
| `npm run build` | Re-copy `vendor/` from `node_modules` and rebuild `assets/app.css` |
| `npm run build:css` | Rebuild only the Tailwind CSS after changing classes in `index.html` or `assets/app.js` |
| `npm test` | Run the Playwright test suite (first run: `npx playwright install chromium`) |

Build outputs (`assets/app.css`, `vendor/`) are committed so the app runs and deploys without a build step. CI rebuilds them and fails if the committed copies are out of date.

Project layout:

```
index.html              markup
assets/app.js           application code (no build step)
assets/app.css          generated by Tailwind from src/input.css
vendor/                 Lucide, canvas-confetti, Inter (see vendor/README.md)
nginx/                  container web server config and security headers
scripts/                vendoring script and the local dev server
tests/                  Playwright end-to-end tests
```

Because of the Content Security Policy, the app code can't use inline `<script>` blocks, `onclick=`-style attributes, or `style=""` attributes. Wire events with `data-action` / `data-change` / `data-input` attributes, and set dynamic styles through `element.style`.

## Releasing

1. Update `version` in `package.json`, the version label in the `index.html` header, and add a `## [x.y.z]` section to [CHANGELOG.md](CHANGELOG.md). Merge to `main`.
2. Tag the merge commit and push the tag:

   ```bash
   git tag -a v1.3.0 -m "SpinDecide 1.3.0" && git push origin v1.3.0
   ```

The release workflow checks that the versions match, runs the build check and tests, then publishes a GitHub Release with the CHANGELOG notes and a ready-to-host `spindecide-vX.Y.Z.zip`.

## Contributing

Issues and pull requests are welcome. Run `npm run build` and `npm test` before opening a PR. Report security issues privately; see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Bundled third-party files keep their own licenses; see [vendor/README.md](vendor/README.md).
