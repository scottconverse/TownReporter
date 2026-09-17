# Live named second-provider proof (2026-09-17)

**Environment:** isolated build on `http://127.0.0.1:4400`, database `townreporter_dark_live_20260916`, signed-in test owner. Production was not touched.

**Run:** one Story draft through the Desk composer with **Drafting scope: Use only supplied material** and the explicit named model **Claude Sonnet**. The supplied text was a short local meeting note.

**Result:**

- The job completed.
- The Story workspace recorded **Model & research · Claude Sonnet**.
- The draft body was produced: `A neighborhood meeting on a provider-recovery matter is scheduled for 6 p.m. Sunday, Sept. 20, in a community room, according to a note supplied to Longmont Ledger.`
- The UI also stated that the note did not specify the address, organizing agency, or agenda items.
- No `Switched to` or `moved to` failover text appeared.
- No browser console or page errors were recorded.
- The draft was marked **review required** and retained the source/name-check warning.

**What this proves:** the explicit named Claude Sonnet path can complete a real supplied-material Story draft in the isolated build, separate from the Codex path.

**What this does not prove:** a live technical failure, a live cross-provider failover, or that the requested provider is always available. No failure was forced for this run.
