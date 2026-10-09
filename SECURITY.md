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

Tweakit is a **dependency-free, client-side UI library** — the kit itself makes no
network requests, runs no server, and handles no secrets or credentials. The attack
surface is correspondingly small, but the things worth a careful eye:

- **Values rendered as CSS.** The image and gradient controls paint their values into
  styles (`url(…)`, `linear-gradient(…)`), and the browser will fetch what a style names.
  Values restored from presets, persisted storage, or `fromJSON` are therefore treated
  like any other stored input: image values are escaped as CSS strings, and a gradient
  stop that isn't a single color token is dropped. Reports of a value that still reaches
  a style unescaped, or adds a background layer, are in scope.
- **The plot control's expression evaluator** is a custom, `eval`-free parser with a
  whitelist and a 512-character input cap, which also bounds its recursion (covered by
  the test suite). Reports of a way to escape it, hang it, or reach arbitrary code are
  in scope.
- **Schema / markup input handling** rejects prototype-polluting keys (e.g. `__proto__`)
  on the typed-meta and presets paths, and color parsing clamps its channels so a
  pathological value (an infinite chroma) can't hang the gamut mapping. Reports of a
  pollution vector or an input that hangs the panel are in scope.
- **The docs-site generator** escapes interpolated content; injection through authored
  page content is in scope.

Out of scope: issues that require a malicious host page or already-compromised browser
(the kit trusts the page it's embedded in), and the bundled third-party icon assets
(see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)).
