# Unit H — mask a council title together with the unresolved name

`IDENTITY_TITLE` (`src/lib/news/name-check-work.ts:44`) listed `mayor` but not `pro`/`tem`, so
"seconded by Mayor Pro Tem <Name>" masked only the surname: "seconded by Mayor Pro Tem an
unidentified speaker". Added `pro\s+tem(?:pore)?`, `councilmember`, `councilwoman`,
`councilman` as titles. The two-word office is one alternative, so the whole title is consumed
with the name instead of leaving a fragment in front of the speaker phrase. The same defect is
fixed for "Mayor Pro Tempore", "Councilmember", "Councilwoman" and "Councilman"; "Council
Member", "Mayor" and "Commissioner" already read correctly and are now pinned by test. Quotes
and links stay byte-for-byte; citation derivation untouched. 2 tests added; 123 pass
(name-check + report suites). Gates: `tsc --noEmit` 0, `tsc -p tsconfig.test.json` 0, ESLint 0.

## Red

```
✖ the draft-164 vote sentence masks a two-word title with the name and reads as a sentence (3.2018ms)
  AssertionError [ERR_ASSERTION]: The input was expected to not match the regular expression /Pro Tem an unidentified/i. Input:
  'The motion was made by an unidentified speaker and seconded by Mayor Pro Tem an unidentified speaker, and it carried 4-3 with three unidentified speakers in opposition, according to the meeting transcript.'
✖ every council title in front of an unresolved name is masked together with the name (2.02ms)
  AssertionError [ERR_ASSERTION]: Mayor Pro Tem
  + actual - expected
  + 'seconded by Mayor Pro Tem an unidentified speaker, according to the transcript.'
  - 'seconded by an unidentified speaker, according to the transcript.'
ℹ tests 23  ℹ pass 21  ℹ fail 2
```

## Green

```
The motion was made by an unidentified speaker and seconded by an unidentified speaker, and it
carried 4-3 with three unidentified speakers in opposition, according to the meeting transcript.

City Council Member Sandoval => seconded by an unidentified speaker on the vote.
Councilmember Sandoval       => seconded by an unidentified speaker on the vote.
Councilwoman Sandoval        => seconded by an unidentified speaker on the vote.
Councilman Sandoval          => seconded by an unidentified speaker on the vote.
Mayor Pro Tempore Sandoval   => seconded by an unidentified speaker on the vote.
Commissioner Sandoval        => seconded by an unidentified speaker on the vote.
Mayor Sandoval               => seconded by an unidentified speaker on the vote.

ℹ tests 23  ℹ pass 23  ℹ fail 0
```

## Note on the masked form (decision the work order left open)

"Keep the role" is not implementable as written: the module's contract says *"Role words are
removed only when directly attached to the unresolved name"* (`name-check-work.ts:163`), and 6
existing assertions across `name-check.test.ts` and `report.scope.test.ts` require that a title
before an unresolved name vanish — e.g. "made by Council Member Marcen" must become "made by an
unidentified speaker" and must not contain "Council Member". Keeping the role would fail the
"existing tests passing" gate, so the masked form is the neutral speaker phrase and the whole
title is consumed with the name. If role-keeping is wanted instead ("the mayor pro tem", "a
council member"), it is a change to the replacement string plus those 6 assertions — say the
word and it is a one-commit follow-up.
