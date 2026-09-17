# TownReporter — Scott's standing orders

This file is law for this workspace. Read it before you reply to "download", "zip", "source", or "give me the file." Re-deriving this costs him tokens. Do not re-derive it.

**Scope note (2026-08-29):** this is a personal handoff runbook for getting a
zip out of the Grok Build sandbox chat during development — it is not
TownReporter product documentation. The "Forbidden" list below is about
*this sandbox's chat/preview UI failing to serve a file*, not about the
shipped product: `/get-the-code` and `/TownReporter.zip` are real, documented
routes in the running app (`docs/manual.md` Part 6, `src/routes/get-the-code.tsx`,
`` src/routes/TownReporter[.]zip.tsx ``) and answer 200 / 307 on every build.
Nothing below forbids that product route; it forbids relying on the *sandbox
preview's copy* of it as a file-handoff mechanism, which is unreliable here.

## Download — the only method

When he asks for the source / zip / tree / download:

**Line 1 of the user-visible reply is the live zip URL.** Not a status sentence. Not "the link first." Not a recap. The URL.

```
https://tmpfiles.org/dl/<id>/<key>/townreporter.zip
~NNN KB. About 50 minutes left. Open in Chrome/Safari as a regular tab — not the Grok preview.
Backup: https://litter.catbox.moe/<id>.zip
Durable: GitHub repo he creates, or a repo-scoped PAT + name and you push.
```

### Pack

From `/workspace` as `TownReporter.zip`:

Include: `src/`, `migrations/`, `scripts/`, `public/` (skip `public/__grok`), `server/`, `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `eslint.config.mjs`, `.prettierrc`, `startup.sh`, `AGENTS.md`, `AGENTS.project.md`, `README.md`.

Exclude: `node_modules`, `.env*`, secrets, `artifacts/`, `screenshots/`, `attachments/`, `.grok/`, `.tanstack/`, `.vercel/`, `routeTree.gen.ts`.

No `zip` binary in this sandbox — use Python `zipfile`.

### Upload (tmpfiles + litterbox)

1. `curl -F "file=@/tmp/TownReporter.zip" https://tmpfiles.org/api/v1/upload`
2. JSON `data.url` is an **HTML landing page**, not the zip. Fetch that HTML. The real href is `https://tmpfiles.org/dl/<id>/<key>/townreporter.zip`. If you send `data.url` he gets HTML.
3. Backup: `curl -F "reqtype=fileupload" -F "time=72h" -F "fileToUpload=@/tmp/TownReporter.zip" https://litterbox.catbox.moe/resources/internals/api.php` → `https://litter.catbox.moe/<id>.zip`

### Verify before you send

HEAD/GET the **dl** URL. Require all of:

- HTTP 200
- `Content-Type: application/zip`
- body starts with `PK` (`50 4B`)
- `Content-Disposition: attachment`

If any check fails, do not send that URL.

### Forbidden (already failed — never retry)

- `render_file` / chat file cards / explore-contents cards
- blob: / data: URLs, "click save as"
- `/TownReporter.zip` or any zip inside the live preview
- "open the preview in a new tab"
- a Download zip button on the paper, desk, login, or any product UI (causes the gray sad-face)
- burying the URL under a paragraph about the method
- telling him an old link still works without checking it this turn

Temporary links die in ~1 hour (tmpfiles) / 72h (litterbox). Re-upload when he asks. Durable copy is GitHub only.

TownReporter is a newspaper. The zip is a chat handoff, never product UI.
