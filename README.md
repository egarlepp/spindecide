# SpinDecide

A picker wheel and scoreboard that runs entirely in the browser. Add choices, spin, and track scores until one entry reaches the target and becomes the Grand Winner. The whole app is a single `index.html`. There is no backend and no build step.

## Features

- **Weighted entries:** each entry has a weight that sets its slice size and its odds.
- **Spins to Win:** an entry must be landed on *N* times to win, so one lucky spin doesn't decide a close vote.
- **Scoreboard and history:** live scores per entry, plus a log of Grand Winners with timestamps.
- **Labels and icons:** show an alias instead of the raw entry text, and add a [Lucide](https://lucide.dev) icon or an image URL to each slice.
- **Import and export:** bulk-load entries from CSV, and back up or restore everything as JSON.
- **Saved lists:** keep several named lists in browser storage.
- **Appearance:** seven color palettes, dark mode, a custom spin button color, and an optional banner image or text and logo.
- **Extras:** confetti, sound effects, adjustable spin duration and font size, and a slow idle spin.

## Quick start

Open `index.html` in a browser. You can also serve it locally:

```bash
python3 -m http.server 8080
```

Then visit <http://localhost:8080>.

## Deployment

The app is one static file, so any static host works.

### GitHub Pages

1. **Settings → Pages**
2. **Build and deployment → Deploy from a branch**
3. Branch `main`, folder `/ (root)` → **Save**

### Docker

```bash
docker build -t spindecide .
```

```bash
docker run -d --name spindecide -p 8080:80 spindecide
```

The image is `nginx:1.30-alpine` serving `index.html`, with a built-in health check.

### Dokploy or another PaaS with Dockerfile builds

Point the service at this repository, set the build type to **Dockerfile**, and map container port `80`. Add a domain in the platform to get TLS.

## Importing data

Use **File → Load File (.json, .csv)**.

### CSV

Each row has up to three columns, separated by commas:

| Column | Field  | Required | Description                           |
| :----- | :----- | :------- | :------------------------------------ |
| 1      | Text   | Yes      | Entry text                            |
| 2      | Label  | No       | Alias shown on the wheel and scoreboard |
| 3      | Weight | No       | Relative slice size (default `1`)     |

```csv
Identity Platform, Directory Services, 1.5
Cloud Identity,, 1.0
Privileged Access, PAM, 1.0
Data Security,, 2.0
```

A copy is in [`examples/sample_roster.csv`](examples/sample_roster.csv). To skip the label but still set a weight, leave column 2 empty (`Text,,2.0`).

CSV rows are appended to the current list. The parser is a simple comma split, so quoted fields that contain commas are not supported.

### JSON

**File → Save Data** with the storage method set to *File* (or *Both*) exports a `.json` backup containing every saved list and the current session. Load that file again to restore it. Imported files are validated and sanitized before they are applied.

## Data and privacy

- Lists, scores, history, and settings are stored **only in your browser** (`localStorage`) or in JSON files you export. SpinDecide sends no app data anywhere.
- The page loads these third-party resources, so those CDNs see a normal request from your browser (IP address, user agent):
  - Tailwind CSS: `cdn.tailwindcss.com`
  - canvas-confetti: `cdn.jsdelivr.net`
  - Lucide: `unpkg.com`
  - Inter: `fonts.googleapis.com`
- Banner, logo, and icon image URLs that you enter are fetched from wherever they point.
- Clearing site data, using a private window, or switching browsers or devices loses anything that isn't exported. Export lists you care about.

For a fully offline or air-gapped deployment, vendor those four resources next to `index.html` and update the URLs in the `<head>`.

## Limitations

- Single presenter: there is no real-time sync between browsers. Share your screen instead.
- The wheel stays readable up to about 100 entries. Rendering works past that, but labels get tiny.
- The Tailwind Play CDN compiles styles in the browser at runtime. That works fine for this app, but it isn't Tailwind's recommended production setup.

## Contributing

Issues and pull requests are welcome. Keep the app a single self-contained `index.html` with no build step. Report security issues privately; see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
