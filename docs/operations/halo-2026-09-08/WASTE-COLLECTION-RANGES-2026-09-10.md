# Waste collection ranges — development checkpoint

Base ccc8cb1. No production, source settings, database, scheduler, or model changes.

Both waste variants now accept optional endDate and collectionInstructions.
The date range is preserved in edition text and eligible on overlapping Today
and weekend dates. Reversed ranges are rejected. Existing single-date ICS
handling remains unchanged. The real Longmont bulletin adapter and saved-source
activation are still unfinished; these constructed fixtures are not live proof.

Luna supplied three tests; lead reviewed and implemented. Lead corrected the
Wednesday fixture expectation: an upcoming Friday inside the collection range
belongs in the weekend edition as well as Today. Original submission expected
only Today. No claim of first-pass worker acceptance.

Parent baseline command:
`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/routine-notice-types.test.ts src/lib/news/routine-notice-editions.test.ts`

```text
ℹ tests 21
ℹ suites 1
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 232.0311
```

Same command after tests, before implementation: exit1, 24 tests, 21 passed,
3 failed, no cancelled/skipped/todo, duration223.8342ms. Failures: no active
Wednesday notice (0 versus1); regular range rejected (false versus true);
reversed endDate returned unsupported-field rather than invalid-field.
Full assertion output is retained in the parent tool transcript.

Final parent command:
`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/routine-notice-types.test.ts src/lib/news/routine-notice-editions.test.ts src/lib/news/routine-notice-feeds.test.ts`

```text
ℹ tests 29
ℹ suites 1
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 430.4694
```

Exit0. Tests ran serially with DATABASE_URL unset (in-memory), no warnings.
All execution handles completed. This is focused development verification,
not full CI, built UI, release readiness, or production acceptance.

Existing candidate ccc8cb1 Windows run34534795006 completed successfully.
CI34534795003 still had its main test job running at this checkpoint; desk and
scan browser lanes failed. No new CI run was manually launched.

## Bulletin connection

The source-specific Longmont fall-leaf adapter is now connected to the existing
saved-source dispatcher and replay path. ICS handling remains unchanged.
Owner issuer context and source approval remain required. No scheduler changes.
Source: https://longmontcolorado.gov/waste-services-trash-recycling-composting/special-services-events/fall-leaf-collection/

Parent baseline (feeds + checks): 22 tests,1 suite,22 pass,0 fail/cancelled/skipped/todo,
18425.1081ms. Command:
`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/routine-notice-feeds.test.ts src/lib/news/routine-notice-checks.test.ts`

RED saved-source test: refused versus parsed;1test,1suite,0pass,1fail,
0cancelled/skipped/todo,16921.8517ms. Command: same wrapper/test flags with
`--test-name-pattern="collection bulletin" src/lib/news/routine-notice-checks.test.ts`.
RED parser stub:0 versus2 candidates;3tests,1suite,2pass,1fail,
0cancelled/skipped/todo,89.0586ms; command same wrapper with
`--test-timeout=60000 src/lib/news/routine-notice-waste.test.ts`.

Luna supplied parser and tests. First implementation omitted validation from
the parsed result:26tests,2suites,24pass,2fail,0cancelled/skipped/todo,
17696.9485ms. Both failures were TypeError reading valid/notice from undefined.
Parent fixed that contract error, matched instructions by list item, marked
issuer as OWNER_ISSUER, and used area identity rather than list order.
This was accepted after correction, not first-pass acceptance.

Final command:
`node scripts/with-app-env.mjs node --experimental-strip-types --test --test-concurrency=1 --test-timeout=60000 src/lib/news/routine-notice-waste.test.ts src/lib/news/routine-notice-checks.test.ts src/lib/news/routine-notice-feeds.test.ts`

```text
ℹ tests 26
ℹ suites 2
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17579.9291
```

Exit0, isolated PGLite, no model calls. `node node_modules/typescript/bin/tsc --noEmit`
also exited0 with no diagnostics. No lingering execution handles.

Separate real HTTP200 fetch parsed two windows: north2026-10-26..30 and
south2026-11-02..06, preserving instructions. HTML SHA256
52ad03156edf621fe66b6758e637ac26f74b0e172bd4e004842c76bd00bf98af.
That probe used synthetic provenance IDs and no database; it is not a real
saved-check/browser proof. The saved-check proof above uses a constructed fixture.
The page's old image alt dates differ from its explicit2026 heading; activation
must retain that source limitation rather than claim all page metadata agrees.

Remaining: actual owner source configuration, real saved-source acceptance and
activation; routine household collection remains address-specific. No production
state changed. CI34534795003 has now completed: main test passed; overall failed
because the two previously identified browser tests remain red.
