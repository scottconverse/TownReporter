# Release H verification

Work was isolated to `tr-release-h`, branch `release/h-gemini-cli`, based on
`origin/main` at `28e99eac`. Existing deployments and other worktrees were not changed.

1. Added Gemini 3.8 Flash and Gemini 3.1 Pro through the signed-in Gemini program; the API-key Gemini connection is unchanged.
2. Program lookup uses GEMINI_CLI_PATH, the user profile Tools/agy/bin/agy.exe, then PATH. The installer accepts GEMINI_CLI_PATH.
3. Verified the real invocation before behavioral tests: `--model gemini-3.8-flash-medium --disable-slash-commands --input-format stream-json --output-format stream-json --print-timeout 120s --print=`. One NDJSON user event carries the full prompt on stdin. Calls use an empty temporary directory, an allowlisted environment without API keys, bounded timeouts, and cleanup.
4. Readiness requires a successful models listing containing a Gemini model, cached for three minutes with shared concurrent checks. Missing/sign-out failures explain how to fix them; unavailable choices remain selectable.
5. Automatic order is DeepSeek -> loaded local model -> Codex Sol 6.1 (balanced) -> Gemini 3.8 Flash (Pro plan). All requested writing pickers offer both Gemini choices. Saved choices are preserved. Pro medium effort maps to high.
6. Ollama Cloud 429/usage-limit responses become visible warnings with Ollama's own words and credit guidance. Discovery cannot clear them. A successful inference or successful explicit Test all check clears the affected model's warning. The selected model is still attempted.
7. Behavioral tests were run red before implementation (missing transport/tracking modules and failed registry/ladder assertions), then green. No new tests pin source text. The fake Gemini program drives the same spawn/stdin path in CI. Existing affected tests were updated for the new ladder.
8. One real draft-sized call ran through grokChat with choice gemini-flash and medium effort from this worktree. It returned valid desk draft JSON from supplied fictional Longmont facts without tools or outside research. This verifies transport and draft-sized output; it did not publish a story or alter a live database.
9. Branch and PR are submitted for CI; no merge or deployment is authorized by this release task.

## Real call receipt

```json
{
  "at": "2026-10-11T17:32:02.514Z",
  "model": "gemini-3.8-flash-medium",
  "seconds": 58.349,
  "reportedSeconds": 56.268,
  "replyLength": 4332,
  "lastSentence": "The contractor selection remains unknown.",
  "headline": "City Council Approves $180,000 Sidewalk Repair Near Elementary School",
  "meta": {
    "provider": "gemini-cli",
    "model": "gemini-3.8-flash-medium",
    "durationMs": 56268,
    "timedOut": false,
    "inputTokens": 12755,
    "outputTokens": 9338,
    "totalTokens": 22093
  }
}
```

## Local checks

- `npm ci` completed, zero audit vulnerabilities.
- Focused existing/affected unit tests: 259 passed.
- Gemini transport and integration tests: 23 passed (includes long stdin, suffix mapping, missing/signed-out/ready, provider words, actual fake transport hop, forced selected-model preservation, timeout and cleanup).
- CI exposed two older ladder expectations; the corrected writer-checkpoint and OCR routing fixtures passed locally with isolated PGlite, preserving completed research and the separate vision-provider order.
- A broader 12-file failover regression run passed 234 tests after updating Dark Desk and Story all-rung expectations for Gemini.
- Compact Gemini assignment labels and the isolated no-provider fixture passed 48 tests; the picker/progress rerun passed 46 browser tests.
- Picker/progress/Queue browser tests: 47 passed.
- Application and test typechecks, lint, Common.ps1 parsing, and Vite client/server build passed.
- Final head CI is reported on the PR.

## Changed files

- `.env.example`
- `.github/workflows/ci.yml`
- `docs/manual.md`
- `installer/Common.ps1`
- `scripts/fakes/fake-gemini-cli.mjs`
- `scripts/job-card-render.test.mjs`
- `scripts/model-picker-render.test.mjs`
- `src/components/model-picker.tsx`
- `src/lib/desk/ops-rows.ts`
- `src/lib/desk/ops-rows.test.ts`
- `src/lib/news/ai-gemini-cli.server.ts`
- `src/lib/news/ai-gemini-cli.test.ts`
- `src/lib/news/gemini-integration.test.ts`
- `src/lib/news/ollama-cloud-readiness.server.ts`
- `src/lib/news/ollama-cloud-readiness.test.ts`
- `src/lib/news/ai.ts`
- `src/lib/news/ai.test.ts`
- `src/lib/news/ai.reasoning.test.ts`
- `src/lib/news/automatic-failover.ts`
- `src/lib/news/forced-runtime.server.ts`
- `src/lib/news/draft-checkpoint.test.ts`
- `src/lib/news/ocr-run-routing.test.ts`
- `src/lib/news/dark-round-failover.test.ts`
- `src/lib/news/desk-model-run.test.ts`
- `src/lib/news/model-assignments.ts`
- `src/lib/news/model-assignments.test.ts`
- `src/lib/news/dark.preflight.test.ts`
- `src/lib/news/model-choice.test.ts`
- `src/lib/news/model-readiness.ts`
- `src/lib/news/preflight.ts`
- `src/lib/news/provider-availability.server.ts`
- `src/lib/news/provider-availability.test.ts`
- `src/lib/news/provider-availability.ts`
- `src/lib/news/provider-registry.ts`
- `src/lib/news/provider-registry.test.ts`
- `src/lib/news/writer-bar.ts`
- `src/routes/desk.models.tsx`
- `docs/release-h-proof.md`
