# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
private vulnerability reporting instead:
**Security** tab → **Report a vulnerability**.

Include steps to reproduce (for example, a crafted `.json` or `.csv` file or a
share link) and the browser you tested in. You should get an acknowledgement
within 7 days.

## Scope

SpinDecide is a static, client-side app. Relevant issues include:

- Script injection through entry text, labels, list names, imported files, or
  share links
- Bypasses of the Content Security Policy (`index.html` meta tag and
  `nginx/security-headers.conf`)
- Unsafe handling of the banner, logo, or icon image URLs
- Supply-chain concerns with the vendored third-party files in `vendor/`

Problems in your own hosting setup (TLS, reverse proxy) are out of scope unless
the shipped `Dockerfile` or nginx config causes them.
