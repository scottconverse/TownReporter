# Dark Desk run-budget diagnosis (isolated live runs 1-3)

**Source under test:** `fix/finish-townreporter-20260916` at `a6fcc04`, built `.output`, served on `127.0.0.1:4400` against the isolated database `townreporter_dark_live_20260916`. Isolated `CODEX_HOME` at `...\work\codex-live-home`; `TOWNREPORTER_LOCAL=0`. No production database, process, or credential was used. No local model was called.

**Model for every run:** `codex-luna` (reported by the provider ledger as `gpt-5.6-luna`), effort `low`. This is the cheapest ready writing model, chosen deliberately for mechanical research.

## What happened

| Run | Subject | Stop reason | Elapsed | Calls | Searches | Doc reads | Eligible signals | Signals written |
|---|---|---|---|---|---|---|---|---|
| 1 | Longmont contracts to Front Range Civic Partners LLC | `elapsed-time-limit` | 421,042 ms | 9 | 12 | 16 | 0 | 0 |
| 2 | Longmont water rights purchases / augmentation plans | `elapsed-time-limit` | 420,565 ms | 9 | 12 | 16 | 0 | 0 |
| 3 | Longmont campaign contributions / independent expenditures 2025-26 | `hop-limit` | 308,765 ms | 9 | 18 | 8 | 3 | 3 |

Runs 1 and 2 produced byte-for-byte identical usage totals. That is not a coincidence and it is not evidence about civic research; it is the run clock.

## Root cause

`src/lib/news/dark.ts` sizes the whole run from the provider's wall clock:

```ts
function darkRunBudget(dials, choice, overrides, verificationLimit) {
  const hopLimit = budgetFor(dials).hops;
  return createDarkRunBudget({
    elapsedMs: providerBudget(choice, overrides).wallMs,
    modelCalls: hopLimit * 2 + Math.max(0, verificationLimit) + 3,
    searches: hopLimit * 3 + Math.max(0, verificationLimit) * 4,
    documentReads: hopLimit * 4,
  });
}
```

`src/lib/news/provider-registry.ts` ships `codex: { wallMs: 420_000, callMs: 150_000, reserveMs: 170_000 }`, so the run gets 7 minutes total. `src/lib/news/dark-run-budget.ts` enforces elapsed time only at call boundaries (`withinElapsed()` inside `startModelCall()`), so the counter reads exactly what fits: 9 calls at Luna's measured 38-70 s per call, consumed by hops 1-4 of 5.

The result at the default `dig 4/10` is that the wall clock expires as the run enters the signal desk, `verification_counts.eligible` stays `0`, and no signal can ever be written at any confidence. The stop is honest (`stop_reason: elapsed-time-limit`, reported in the summary), but it is not a usable investigative outcome - not a lead and not a clearly-earned "nothing found".

The shipped registry already carries `reserveMs: 170_000` for this provider, and `darkRunBudget()` does not use it.

## Secondary finding: the preset buttons do not persist on their own

The first two runs were launched after clicking **Careful**, yet both summaries report `Setting: dig 4/10, nerve 5/10 (Standard)`, and `dark_settings` was empty for the newsroom. Setting `#dig` directly and pressing **Save** persisted the row (`dig=2, nerve=5, scope=city`). So the preset buttons alone did not commit a preference an editor could rely on.

## Run 3: the outcome changed when the dial actually persisted

With `dig 2/10` saved, run 3 reached the signal desk inside its clock and stopped by design at `hop-limit` - not by running out of time. It produced a usable lead set:

1. "The campaign-finance records are present in the City's system but not exposed by broad search" - confidence 0.42, unverified.
2. "Longmont's local-versus-state reporting split may route records to the wrong registry" - confidence 0.39, unverified.
3. "The 2026 ballot-measure finance trail is not yet identified" - confidence 0.34, verified.

Verification counts: `{"eligible":3,"attempted":3,"verified":1,"unverified":2,"failed":0,"deferred":0}`. The summary names the next concrete work (extract committees and candidates, then follow people, entities, vendors, beneficiaries and payments), lists the gaps it could not close, states the search window, and reports that 1 of 3 eligible signals completed the four-question protocol. Two signals are explicitly labelled unverified.

## Smallest in-scope repair

Two candidates, in order of preference:

1. **Reserve clock for the signal desk.** `darkRunBudget()` should hold back the provider's shipped `reserveMs` from the hop loop so the adversarial review and signal writing cannot be the phase that dies. This uses a number the registry already defines and changes no interface.
2. **Expose the whole-run wall clock.** The Server page currently exposes only per-call seconds (`callMs`) through `provider_settings`; `wallMs` is settable in the database but not in the UI. Making the run clock editor-visible would let a publisher size a run to their own patience.

Option 1 is the smaller change and the one the registry's own comment implies was intended.

## Limits

- Three live runs on one isolated newsroom; not a statistical claim about Dark Desk quality.
- Luna only; no cross-model comparison was run.
- The runs used live public web search and captures against the isolated database; captured source URLs were not independently re-verified by hand for every signal.
- Signals 1 and 2 remain unverified by design and must not be treated as findings.
- No full test suite, production service, credential, commit, merge, tag, or release operation was touched by these runs.

## Follow-up: option 1 applied, and what run 4 showed

Option 1 above was implemented and committed as `7da28c8` ("Reserve Dark Desk clock for the signal desk"):

- `src/lib/news/investigate.ts` gained `researchReserveMs?: number` on `ResearchLoopOptions` and a hop-loop guard that stops research while that much clock is still on the meter.
- `src/lib/news/dark.ts` computes `providerBudget(choice ?? undefined, overrides).reserveMs` at both run entry points and passes it into both `researchLoop({...})` hand-offs.
- Breaking at the reserve deliberately does **not** set a stop reason, so the existing `paused -> hop-limit` mapping reports "paused by design" rather than claiming the clock was exhausted.

Focused evidence (`src/lib/news/dark-research-reserve.test.ts`): RED before the guard was `AssertionError: research must not start a hop inside the reserve` (actual 5 hops, expected 0); GREEN 2/2 after. Neighbouring suites 10/10 (`dark-preferences-flow`, `dark-run-budget`, `dark-place`) and 18/18 (`investigate.dedup`, `dark-round-failover`); `npm run typecheck` clean; `npm run build` clean.

### Run 4 (isolated, `codex-luna` / `gpt-5.6-luna`, effort low, dig 4/10, nerve 5/10, city scope)

Subject: "Longmont downtown development authority spending and tax increment financing since 2023".

| Field | Value |
|---|---|
| Stop reason | `elapsed-time-limit` |
| Elapsed | 431,225 ms (started 20:57:28, finished 21:04:39) |
| Usage | 8 model calls, 13 searches, 12 document reads |
| Verification | eligible 6, attempted 6, verified 0, unverified 6, failed 1, deferred 0 |
| Signals written | 6 |

Stage ledger, in order, with provider durations:

```text
planning hop 1        43,225 ms  ok
selecting documents   38,512 ms  ok
planning hop 2        70,017 ms  ok
selecting documents   41,827 ms  ok
planning hop 3        88,949 ms  ok
selecting documents   46,420 ms  ok
synthesis             60,355 ms  ok
verification signal 1 14,160 ms  ok (provider "injected")
```

**The reserve behaved as intended.** Research stopped after three hops - it no longer ran to the wall - and the writing stages that produced nothing at all in runs 1 and 2 actually executed: synthesis completed in 60 s and the adversarial review began. Six signals were written, all labelled `unverified`:

1. Large budget-to-actual gap in DDA capital projects - 0.45
2. TIF debt activity lacks an identified debt instrument - 0.48
3. DDA fund fragmentation obscures the complete spending path - 0.44
4. 5.000-mill levy cannot yet be reconciled to collections - 0.42
5. DDA and urban-renewal structures may overlap without a visible legal map - 0.31
6. Capital-projects debt and fund balance may reflect an unfinished project cycle - 0.27

### What run 4 leaves open

The run still ends `elapsed-time-limit`, so the finding is narrowed, not closed. The 170 s reserve buys one synthesis call plus roughly one verification call; the configured `verificationLimit` is 6, and verifying six signals at this provider's latency cannot fit inside it. The next question is therefore whether the reserve should scale with `verificationLimit`, whether a round should verify fewer signals and defer the rest explicitly, or whether the whole-run wall clock should be editor-visible rather than only per-call seconds.

Recorded limits for run 4: same isolated newsroom and single model as runs 1-3; the six signals are unverified and must not be treated as findings; one verification attempt failed and is counted as failed rather than dropped; no production service, credential, commit beyond `7da28c8`, merge, tag, or release was touched by the run.

## Follow-up 2: the deferred accounting fix, run 5, and a summary-truncation defect

Two more repairs landed after run 4.

**`2d36449` - a budget stop is not a verification failure.** `verifyRunSignals` had two budget-stop branches (search cap, model-call cap) doing `failed += 1`. A budget stop is what `deferred` already means here - "not attempted, keep it for later". Both branches now add the untouched remainder to `deferred`; the third `failed` site (attempted, but no usable verdict or unsaved trail) is untouched. New `src/lib/news/dark-verify-budget.test.ts` pins it (RED before the change: `actual 1, expected 0` on both branches; GREEN 2/2). Neighbours `dark-verify` + `dark-preferences-flow` 19/19; `dark-verify` + `dark-preferences-flow` + `dark-output-grounding` 28/28 with the later commit.

**Run 5, same isolated newsroom, `codex-luna` / `gpt-5.6-luna`, effort low, dig 4/10: "Longmont Housing Authority and affordable housing fund allocations since 2023".**

| Field | Value |
|---|---|
| Stop reason | `elapsed-time-limit` |
| Elapsed | 423,991 ms |
| Usage | 10 model calls, 21 searches, 12 document reads |
| Verification | eligible 3, attempted 3, verified 1, unverified 2, **failed 0**, **deferred 0** |
| Signals written | 3 |

```text
planning hop 1        35,438 ms  ok
selecting documents   36,812 ms  ok
planning hop 2        78,510 ms  ok
selecting documents   28,065 ms  ok
planning hop 3        72,792 ms  ok
selecting documents   57,757 ms  ok
synthesis             34,345 ms  ok
verification signal 1 12,806 ms  ok
verification signal 2 14,796 ms  ok
verification signal 3 13,530 ms  ok
```

Signals: "Affordable Housing Fund award ledger remains unresolved" 0.42 unverified; "Multi-year Brothers Redevelopment carry-forward trail" 0.38 unverified; "Housing Authority revenue offsets do not yet map to housing outcomes" 0.33 **verified**.

**What run 5 settles.** `failed: 0` confirms the mislabelling is gone live. `attempted: 3 === eligible: 3` with `deferred: 0` confirms the review was not budget-stopped: every configured verification ran and completed, none timed out. The reserve also worked again - research stopped after hop 3 and synthesis plus all three verifications executed.

**What run 5 leaves open, narrowed.** The round still ends on the clock, in the `dark-signal-desk` stage, with the ledger showing no timed-out call. Two things follow from the arithmetic: research consumed 309 s of the 420 s wall (three hops at ~103 s each) because the reserve is a *hop-boundary gate*, not an allocation - hop 3 began with 241 s left, above the 170 s reserve, and then spent 130 s. The desk stages then needed 75 s, leaving ~35 s, which is not enough for the remaining model call (the editor brief) or the final write. A refused `startModelCall` records no ledger entry, so the ledger cannot show which call lost; the leading explanation is the brief. Because a round's summary ends with a `Brief:` line only when that stage reported, the confirming line for this is the one the next defect was hiding.

**`b626498` - the summary was truncating from the wrong end.** Both run paths stored their header with `slice(0, 2500)`. Run 5's narrative was long enough that the slice cut the tail, so the stored summary ends mid-word at "Hops" - losing the hop count, the saved dials, the synthesis outcome and any `Brief:` line. An editor opening that file would see a narrative that stops mid-sentence and no statement that the brief never ran. `tailSafeDarkSummary()` now keeps the trailing lines whole and clips the narrative instead; both store sites use it. `src/lib/news/dark-summary-tail.test.ts` asserts the kept lines and also asserts that the replaced front-slice *would* have dropped them, so the defect cannot silently return.

**Next.** Re-run one round on this build and read the summary tail: it should now state hops, dials, synthesis and brief outcome explicitly - which both confirms the truncation fix and tells us whether the brief is in fact the call that loses the clock. If it is, the honest options remain the earlier three: scale the reserve with `verificationLimit`, verify fewer signals per round and defer the rest, or make the whole-run wall clock editor-visible.
