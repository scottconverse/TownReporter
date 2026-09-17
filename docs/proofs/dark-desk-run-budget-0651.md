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
