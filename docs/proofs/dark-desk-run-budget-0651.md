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

## Run 6: the September 3-8 replay, and confirmation of the summary fix

Replay window persisted through the editor dials (`dark_settings.research_preferences` = `{"mode":"range","lookbackDays":90,"startDate":"2026-09-03","endDate":"2026-09-08","verificationLimit":6,"executionMode":"batch","actionLimit":6}`), then run on the `b626498` build.

Subject: "Longmont City Council decisions, contracts and public records from September 3-8, 2026". Model `codex-luna` / `gpt-5.6-luna`, effort low, dig 4/10, nerve 5/10, city scope.

| Field | Value |
|---|---|
| Stop reason | **`hop-limit`** - the design stop, not clock exhaustion |
| Elapsed | 408,148 ms (inside the 420 s wall) |
| Usage | 12 model calls, 25 searches, 12 document reads |
| Verification | eligible 4, attempted 4, verified 0, unverified 4, failed 0, deferred 0 |
| Signals written | 4 |

Signals, all labelled unverified: "September 8 council record remains materially incomplete" 0.42; "Southeast Longmont urban-renewal modification has an unresolved money-and-control trail" 0.36; "O-2026-53 has a subject-matter and fiscal-description mismatch" 0.34; "Urban-renewal plan embeds continuing authority and obligations beyond the stated modification date" 0.29.

**The replay window is proven in the run record, not just in the settings:** the stored summary reads `Window: 2026-09-03 through 2026-09-08 (search preference; verify dates in each source)` and `Search date preference: 2026-09-03 through 2026-09-08 (inclusive).`

**The summary-truncation fix is confirmed live.** The stored summary now ends with its status lines intact:

```text
Hops 3 of 5. Artifacts 13. Open frontier 192.
Setting: dig 4/10, nerve 5/10 (Standard), scope city.
```

The narrative above them is clipped at the front (`This hop tar...`), which is the intended trade: the editor keeps the run's own account of what it did and how far it got, and loses prose instead. No `Brief:` line appears this round, so the brief stage raised no error - it was run 4's failed brief that produced that line, and run 5's summary had been truncated before reaching it.

**This closes the "runs by design rather than by clock" question.** Run 6 is the first round that terminated on its own hop budget with every configured verification attempted (4 of 4), nothing failed and nothing deferred. Runs 1-2 stopped on the clock with nothing written; run 3 stopped by design at a reduced dig; runs 4-5 stopped on the clock with the desk stages starving; run 6 stopped by design at the shipped dig with the desk stages complete.

**Assessment of the six runs against the directive's questions.** Did each produce a usable lead or a plainly useful "nothing found"? Runs 3-6 produced 3, 6, 3 and 4 signals respectively with explicit gaps and next steps; runs 1-2 produced nothing and are recorded as budget failures, not as findings. Did they preserve sources and separate facts from hypotheses? Signals carry confidence and a `verification_status`, and every signal in runs 3-6 is labelled `unverified` except one in run 3 and one in run 5. Did they stop under a bounded budget? Yes - every run recorded its stop reason and usage totals. Did they avoid repeating completed work? The frontier carries across runs on one investigation; each replay subject was a distinct investigation. Did they give concrete follow-up items? Yes; every run's summary names the next records to retrieve. Did they avoid overclaiming? The unverified labelling and the "dates are search hints, not proof" line are present in every stored summary.

**Limits.** Six runs, one newsroom, one model, no cross-model comparison. Signals are leads, not conclusions. Run 6's window is a search preference applied to queries; it does not certify that every captured source falls inside September 3-8, and the run itself says so.


## Follow-up 3: the reserve now covers the hop's second call

**`b5b71e4` - the post-search selector honours the reserve.** The hop-boundary check alone was not enough, because a hop costs two model calls: the planner, then the post-search read selector. A hop that began with headroom could still finish below the reserve. Run 5 is the measurement - hop 3 started with 241 s left, ran planning for 73 s and selecting for 58 s, and ended at 309 s elapsed, 2 s under the 170 s the writing stages need. The selector is now skipped while the reserve is on the meter; its candidates are re-planned on the next hop and reads already fall back to the ordinary queue. New cases in `src/lib/news/dark-research-reserve.test.ts`: the selector must not run inside the reserve (RED without the guard: "the selector must not run inside the reserve"), and with real headroom it still runs. 4/4, neighbours 18/18, typecheck clean.

**Run 7 - same newsroom, same model, same dig 4/10, window back to the 90-day lookback.**

| Field | Value |
|---|---|
| Stop reason | **`hop-limit`** - by design |
| Elapsed | 412,957 ms |
| Usage | 10 model calls, 21 searches, 12 document reads |
| Verification | eligible 3, attempted 3, verified 0, unverified 3, failed 0, deferred 0 |
| Signals written | 3 |

```text
planning hop 1        36,862 ms  ok
selecting documents   31,041 ms  ok
planning hop 2        83,351 ms  ok
selecting documents   38,739 ms  ok
planning hop 3        82,988 ms  ok
   (hop 3's post-search selector skipped: the reserve was held)
synthesis             36,550 ms  ok
verification signal 1 16,352 ms  ok
verification signal 2 16,842 ms  ok
verification signal 3 14,113 ms  ok
writing editor brief  19,896 ms  ok
```

**This is the first round in the series where the editor brief ran.** Run 5 - same newsroom, same model, same dig - produced no brief at all, because the clock had been spent. Run 7 traded one hop-3 read plan for it and finished every stage. That is the whole point of the reserve, and it is now observable in the run record rather than asserted.

Signals, all unverified: "Large late-2026 appropriations lack transaction-level explanation" 0.42; "Revenue-gap communication may change the fiscal context" 0.32; "Carryover and fund-balance classifications require reconciliation" 0.45. The summary tail is intact (`Hops 3 of 5. Artifacts 13. Open frontier 169.` / `Setting: dig 4/10, nerve 5/10 (Standard), scope city.`).

**Limits.** One round on one newsroom with one model; a single observation that the brief now fits, not a distribution. The reserve is still a check rather than a hard pre-emption: a model call already in flight can cross it, so research can end slightly under the reserve - it simply cannot start another call there. Skipping the selector means hop 3's read candidates come from the ordinary queue; that trade is deliberate and is now stated in `docs/dark-desk.md`.


## Follow-up 4: the run record stopped calling live calls "injected", and the reserve's real ceiling

**`5ff51b0` - verification calls now name their provider.** `verifyRunSignals` labelled a call `provider: "injected", model: "injected"` whenever `deps.model` was set, on the assumption that an injected model means a test double. Production also passes a callback there - `synthesizeSignals` builds a failover-wrapped `verifyModel` - so every live verification in runs 4, 5 and 7 was recorded as if a test had run it. The label now names the editor's choice; an unknown transport still falls back to "injected". RED with the old labels restored: "a live provider call must not be logged as a test double". Neighbours 36/36, typecheck clean.

**Run 8, same newsroom, `codex-luna`, dig 4/10, lookback window.** Stop reason `elapsed-time-limit`, 420,024 ms, 12 model calls, 25 searches, 12 document reads, `{"eligible":4,"attempted":4,"verified":1,"unverified":3,"failed":0,"deferred":0}`, 4 signals.

The label fix is visible in the run's own record:

```text
"stage":"verification signal 1","provider":"codex-luna","model":"gpt-5.6-luna","durationMs":14637,"result":"ok"
"stage":"verification signal 2","provider":"codex-luna","model":"gpt-5.6-luna","durationMs":14769,"result":"ok"
"stage":"verification signal 3","provider":"codex-luna","model":"gpt-5.6-luna","durationMs":16588,"result":"ok"
"stage":"verification signal 4","provider":"codex-luna","model":"gpt-5.6-luna","durationMs":15422,"result":"ok"
"stage":"writing editor brief","provider":"codex","model":"gpt-5.6-luna","durationMs":596,"result":"timeout","timedOut":true
```

**What run 8 teaches about the reserve.** Hop 3's post-search selector began with 190.8 s left - above the 170 s reserve, so the guard allowed it - and then ran for 42.4 s, finishing at 148.4 s remaining. The reserve is a check *before* a call, not a cap *on* it, so a call that starts just above the line can cross it. The overshoot is now bounded by one call's duration instead of a whole hop, which is why run 7 kept enough room for the brief; run 8 gave the desk stages only ~102 s across synthesis and four verifications, and the brief started with 596 ms and timed out.

**The arithmetic this exposes.** At dig 4/10 with `verificationLimit` 6, the configured work is two model calls per hop plus synthesis, up to six verification calls and the brief. At this provider's observed 10-90 s per call that is more than the 420 s wall can hold. The reserve can triage between stages; it cannot make the configured work fit. The honest resolutions remain the three recorded earlier - size the wall clock to the configured work, verify fewer signals and defer the rest, or make the wall clock editor-visible - and run 8 shows a round can still end on the clock in the meantime, with the brief attempted and timing out rather than silently skipped.
