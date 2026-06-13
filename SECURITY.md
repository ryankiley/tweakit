# Security Policy

## Reporting a vulnerability

Please report security issues privately — **don't** open a public issue for them.

- Preferred: GitHub's private vulnerability reporting — the **Security** tab →
  **Report a vulnerability** ([new advisory](https://github.com/ryankiley/tweakit/security/advisories/new)).
- Or email **ryanekiley@gmail.com**.

Include a minimal reproduction (a schema or markup snippet) and the affected version.
This is a single-maintainer project, so expect a best-effort response — typically within
a few days. Please give a reasonable window to fix before any public disclosure.

## Supported versions

Fixes land on the latest published release. There are no long-term support branches.

## Scope

Tweakit is a **dependency-free, client-side UI library** — it makes no network
requests, runs no server, and handles no secrets or credentials. The attack surface is
correspondingly small, but the things worth a careful eye:

- **The plot control's expression evaluator** is a custom, `eval`-free parser with a
  whitelist, a recursion cap, and an input-length cap (covered by the test suite). Reports
  of a way to escape it, hang it, or reach arbitrary code are in scope.
- **Schema / markup input handling** rejects prototype-polluting keys (e.g. `__proto__`)
  on the typed-meta and presets paths. Reports of a pollution vector are in scope.
- **The docs-site generator** escapes interpolated content; injection through authored
  page content is in scope.

Out of scope: issues that require a malicious host page or already-compromised browser
(the kit trusts the page it's embedded in), and the bundled third-party icon assets
(see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).
