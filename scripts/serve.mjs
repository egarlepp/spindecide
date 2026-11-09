// Minimal static file server for local development and the Playwright tests.
// Sends the same security headers as the nginx image (nginx/security-headers.conf).
// Usage: npm start            (http://localhost:4173)
//        PORT=8080 npm start
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = Number(process.env.PORT) || 4173;
const host = process.env.HOST || '127.0.0.1';

// Only the files the app needs are served; everything else (node_modules, .git, ...) is 404.
const ALLOWED_PREFIXES = ['index.html', `assets${sep}`, `vendor${sep}`, `examples${sep}`];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cache-Control': 'no-cache',
};

const server = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    const relative = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^[/\\]+/, '');
    if (relative.includes('..') || !ALLOWED_PREFIXES.some(p => relative === p || relative.startsWith(p))) {
      res.writeHead(404, SECURITY_HEADERS).end('Not found');
      return;
    }
    const file = join(root, relative);
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, SECURITY_HEADERS).end('Not found');
  }
});

server.listen(port, host, () => {
  console.log(`SpinDecide running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});
