# Changelog

Current release: **0.4.3**.

## 0.4.3 — 2026-08-28

The desk is this newsroom's, not whoever clicked. An empty quote is not proof. File → publish → correct is green.

- Captures, monitors, names, and URL history look up by newsroom. Who clicked is still stored. A second identity cannot publish. Two people cannot both own the desk.
- A real capture with an empty excerpt stays unresolved. The version id is kept so you can see what it pointed at.
- File a lead, put it on the paper, correct it — that path is the CI gate.
- Two drainers cannot run the same job. The database hands it to one of them.
- Cron with no secret is off (503).
- Confirm tokens for a newsletter we do not send are gone.
- A hostname that resolves to mapped loopback is refused before fetch.
- GitHub Pages no longer prints a version number.

Not in 0.4.3: cost-routing, invite, real OCR, city picker, mailer. Design copy waits on locked strings.

