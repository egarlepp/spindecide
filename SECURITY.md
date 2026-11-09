# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
private vulnerability reporting instead:
**Security** tab → **Report a vulnerability**.

Include steps to reproduce (for example, a crafted `.json` or `.csv` file) and
the browser you tested in. You should get an acknowledgement within 7 days.

## Scope

SpinDecide is a static, client-side page. Relevant issues include:

- Script injection through entry text, labels, list names, or imported files
- Unsafe handling of the banner, logo, or icon image URLs
- Supply-chain concerns with the third-party scripts the page loads

Problems in your own hosting setup (TLS, reverse proxy, headers) are out of
scope unless the shipped `Dockerfile` causes them.
