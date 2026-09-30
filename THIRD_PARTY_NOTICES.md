# Third-party notices

## Bricolage Grotesque webfont

TownReporter self-hosts latin and latin-ext WOFF2 subsets of Bricolage
Grotesque, in the 500, 700 and 800 weights the design tokens ask for
(`docs/design/handoff-2026-09-26/design-system/tokens/fonts.css`). Bricolage
Grotesque is licensed under the SIL Open Font License 1.1. Copyright 2022 The
Bricolage Grotesque Project Authors
(<https://github.com/ateliertriay/bricolage>). The complete license text is
included at
[`licenses/fonts/Bricolage-Grotesque-OFL.txt`](licenses/fonts/Bricolage-Grotesque-OFL.txt).

## Literata webfont

TownReporter self-hosts latin and latin-ext WOFF2 subsets of Literata, in the
400/500/600 roman and 400 italic cuts the design tokens ask for. Literata is
licensed under the SIL Open Font License 1.1. Copyright 2017 The Literata
Project Authors (<https://github.com/googlefonts/literata>). The complete
license text is included at
[`licenses/fonts/Literata-OFL.txt`](licenses/fonts/Literata-OFL.txt).

## @earendil-works/pi-ai 0.82.1

`@earendil-works/pi-ai` version `0.82.1` is still listed in `package.json` and
installed, but no TownReporter code imports it any more: it was used by the
SuperGrok OAuth adapter, which was removed with the rest of Grok (xAI) support.
It is MIT licensed, copyright Mario Zechner. Source:
<https://github.com/badlogic/pi-mono>. Dropping it from `package.json` is a
dependency sweep of its own, with a lockfile update, and is not part of the
removal.

## In the source repository only (excluded from release archives)

Three skill trees under `.grok/skills/` are vendored third-party code rather
than TownReporter's own:

- `.grok/skills/generate2dmap/`
- `.grok/skills/generate2dsprite/`
- `.grok/skills/video2dsprite/`

Each is MIT licensed, Copyright (c) 2026 0x0funky, vendored from
[agent-sprite-forge](https://github.com/0x0funky/agent-sprite-forge) at commit
`53dce6055984c610d833e77887939cbd0fb1c92b` — the origin is recorded in that
tree's own `SOURCE.md`, and the complete licence text sits beside it as
`LICENSE`.

The rest of `.grok/` — its `references/`, the `auth`, `neon`, `og`, `xai-api`
and game-building skills, `app-env.json` and `status` — is Grok App Builder
scaffold material kept in this repository as history. It is not TownReporter's
work and not TownReporter documentation.

`.gitattributes` marks `.grok/` `export-ignore`, so none of this material
reaches a release archive: no Windows package a publisher downloads contains
any of it. It is restated here because the repository itself is public.

## Downloaded at install time (not in the source archive)

The Windows installation package provisions three runtimes that are not part
of this source tree and are not covered by the repository's MIT license. Each
is distributed under its own license, and the installer ships no copy of the
license text, so the reference here is the project's own license:

- **Node.js 22.23.2** — the private runtime the installer provisions, recorded
  in `installer/dependencies.json` against the official nodejs.org ZIP. MIT
  License, with the bundled third-party notices in Node's own `LICENSE` file.
- **PostgreSQL 17.11** — the EnterpriseDB Windows x64 binaries recorded in the
  same file. The PostgreSQL License (a permissive BSD/MIT-style license); the
  EnterpriseDB ZIP carries its own copy.
- **Chromium** — installed by Playwright (`npx playwright install chromium`,
  `installer/Install.ps1`). BSD 3-Clause for Chromium's own code, plus the
  third-party licenses Chromium bundles.

npm dependencies are a different case: `npm ci` installs them from the registry
into `node_modules`, and each package carries its own license file there (for
example `node_modules/react/LICENSE`) and its own `license` field in
`package.json`. Those licenses travel with the installed tree and are not
restated in this file.
