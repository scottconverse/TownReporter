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
