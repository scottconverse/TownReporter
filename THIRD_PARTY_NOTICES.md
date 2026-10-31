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

## Schibsted Grotesk webfont

TownReporter self-hosts latin and latin-ext WOFF2 subsets of Schibsted
Grotesk, in the 400/600/700/800/900 weights the Bulletin design uses for the
reader's headlines and interface. Schibsted Grotesk is licensed under the SIL
Open Font License 1.1. The complete license text is included at
[`licenses/fonts/schibsted-grotesk-OFL.txt`](licenses/fonts/schibsted-grotesk-OFL.txt).

## Source Serif 4 webfont

TownReporter self-hosts latin and latin-ext WOFF2 subsets of Source Serif 4,
in the 400/600 roman and 400 italic cuts the Bulletin design uses for deks and
story text. Source Serif 4 is licensed under the SIL Open Font License 1.1.
The complete license text is included at
[`licenses/fonts/source-serif-4-OFL.txt`](licenses/fonts/source-serif-4-OFL.txt).

## JetBrains Mono webfont

TownReporter self-hosts latin and latin-ext WOFF2 subsets of JetBrains Mono in
the 400 weight the Bulletin design uses for the SHA-256 fingerprint. JetBrains
Mono is licensed under the SIL Open Font License 1.1. The complete license text
is included at
[`licenses/fonts/jetbrains-mono-OFL.txt`](licenses/fonts/jetbrains-mono-OFL.txt).

## @earendil-works/pi-ai 0.82.1

`@earendil-works/pi-ai` version `0.82.1` is still listed in `package.json` and
installed, but no TownReporter code imports it any more: it was used by the
SuperGrok OAuth adapter, which was removed with the rest of Grok (xAI) support.
It is MIT licensed, copyright Mario Zechner. Source:
<https://github.com/badlogic/pi-mono>. Dropping it from `package.json` is a
dependency sweep of its own, with a lockfile update, and is not part of the
removal.

## Windows runtime distributions

The self-contained Setup.exe downloads these runtimes at CI build time and
bundles them for offline installation. The older source-ZIP installer downloads
them on the user's computer. They are not covered by the repository's MIT
license; each distribution has its own license and notices. Node's LICENSE,
Chromium's bundled notices and the font licenses travel with the Setup payload.

- **Node.js 22.23.2** — the private runtime the installer provisions, recorded
  in `installer/dependencies.json` against the official nodejs.org ZIP. MIT
  License, with the bundled third-party notices in Node's own `LICENSE` file.
- **PostgreSQL 17.11** — the EnterpriseDB Windows x64 binaries recorded in the
  same file. The PostgreSQL License (a permissive BSD/MIT-style license); the
  EnterpriseDB ZIP carries its own copy.
- **Chromium** — installed by Playwright (`playwright install chromium`) during
  the Setup build or older source installation. BSD 3-Clause for Chromium's own code, plus the
  third-party licenses Chromium bundles.

npm dependencies are a different case: CI uses `npm ci --omit=dev` for the Setup
payload. Packages carry their own license files in `node_modules` (for
example `node_modules/react/LICENSE`) and its own `license` field in
`package.json`. Those licenses travel with the installed tree and are not
restated in this file.
