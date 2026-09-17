# Live cross-provider failover proof (2026-09-17)

**Environment:** isolated build on `http://127.0.0.1:4400`, database `townreporter_dark_live_20260916`, signed-in test owner. Production was not touched.

**Requested provider:** a disposable Custom AI connection named `Failover Probe 1789627266772`, saved through the real Server panel with base URL `http://127.0.0.1:9/v1` and model id `dead-model`. The endpoint was deliberately unreachable, and saving a connection does not call a model.

**Run:** one supplied-material Story draft requested that Custom API connection.

**Result:**

- The Story job created `story/7` and completed.
- The Story workspace recorded **Model & research · Codex Terra**.
- The UI displayed: `Model note: This draft moved to Codex Terra because Custom API connection was unavailable`.
- The draft body was produced: `The library board is scheduled to meet Sept. 21, 2026, at 5 p.m.` with an explicit note that the supplied material omitted location, agenda, and public-attendance details.
- No browser console or page errors were recorded.

**What this proves:** a live requested-provider technical failure can move the unfinished Story call to another ready provider, complete the work, and record the requested/actual switch in the editor's workspace.

**What this does not prove:** every mid-call failure class, every provider pair, or a production deployment. This run used one intentionally unreachable Custom AI endpoint and Codex Terra as the ready fallback.
