-- Correct the seeded welcome article on existing installs (unit U14).
--
-- WHY THIS IS A MIGRATION AND NOT A CODE CHANGE. `writeWelcomeArticle`
-- (src/lib/news/welcome-article.ts) rewrites slug `welcome-to-townreporter`
-- from the current template, but it has exactly one caller --
-- `completeFirstRunSetup` -- so it only ever runs for a newsroom whose owner
-- fills in the first-run form. A desk that finished setup BEFORE the template
-- changed, or that never runs it at all, keeps the copy that was written into
-- its database years ago. Nothing else re-reads the template, so the only way
-- to reach those rows is forward: an UPDATE, exactly like
-- migrations/0040_welcome_nonprofit.sql, which is the precedent this file
-- follows in shape, in method (`replace()` on the column, guarded by a
-- `like` on the phrase being replaced) and in the promise that a second
-- replay changes nothing.
--
-- WHAT THE CLAIM IS. The article told the reader that nothing prints without
-- an editor -- "Nothing on this masthead goes live because a model felt
-- confident" / "A human editor still decides what publishes." Routine notices
-- broke that sentence without touching it: when the owner activates routine
-- notices, an edition that changes after it printed is corrected by
-- routine-notice-worker.server.ts with no editor press anywhere, and that
-- correction prints on /corrections like any other. The reader-facing promise
-- is therefore false, and the honest one is the template's: ordinary stories
-- need an editor, and owner-activated routine notices are the one exception.
--
-- THERE ARE THREE DIFFERENT TEXTS IN THE WILD, AND TWO PARTS BELOW BECAUSE OF
-- IT. The unit's brief named the text in migrations/0002_newsroom.sql, and
-- part 1 corrects exactly that text; part 2 corrects the other two. Which
-- statement fires on which install:
--
--   (a) migrations/0002_newsroom.sql's seed. Unreachable in any live
--       database, and worth saying plainly rather than leaving a reader to
--       work it out: 0002 inserts the row, then 0009_reporting.sql
--       overwrites its dek and body unconditionally (`where slug =
--       'welcome-to-townreporter' and user_id = 'masthead'`, which every
--       install satisfies), and 0040 rewrites one phrase inside that body. A
--       migration cannot be skipped by having "already run" -- 0009 sorts
--       after 0002 in the same directory and both are applied in one pass. So
--       the Grok-naming sentences and the "masthead" sentence below are on no
--       live row today. They are kept because the brief named them, because
--       the unit's test seeds them, and because this file is the only place
--       that records the correct rewrite should such a row ever be imported
--       from an archive.
--
--   (b) The text `writeWelcomeArticle` ITSELF wrote before commit 0922f74f
--       (2026-09-30, ENG-4 part 1, "wording only; migrations untouched").
--       An owner who completed first-run setup before that commit has this
--       row, and it carries the same two claims in the same words the 0002
--       seed used: dek `... drafts under wire-service rules, and publishes
--       only what an editor signs.`, body `... Nothing on this masthead goes
--       live because a model felt confident.` (it never named Grok -- it said
--       "its writing model" and "the model"). Part 1's dek and body
--       statements are the correction for it, and they are the reason part 1
--       is not dead SQL: this is a live shape.
--
--   (c) The text an owner who never ran first-run setup has, written by
--       0009_reporting.sql and amended by 0040_welcome_nonprofit.sql: dek
--       `The public record is only the beginning. ... then keeps digging.`,
--       body `... Dark Desk is the recursive investigative lane. A human
--       editor still decides what publishes.` Part 2 corrects that one. It
--       carries neither of the 0002/0922f74f phrases, so part 1 is a no-op on
--       it -- which a PGlite replay of 0001..0107 confirms.
--
-- Part 2 is beyond the letter of the brief, which named only the 0002 text;
-- it is reported to the coordinator as such, because (c) is the shape that
-- most installs actually have.
--
-- IDEMPOTENT, AND NARROW. Every replacement is an exact-phrase `replace()`
-- and every statement is guarded by a `like` on that same phrase, so a second
-- replay matches nothing, and an owner who rewrote any sentence keeps the
-- rewrite: the sentence is simply no longer there to match. None of the
-- patterns contains a LIKE metacharacter (`%` or `_`), so each `like` is a
-- plain substring test. Nothing here touches `status`, `published_at`,
-- `headline` or any other column -- `articles` has no `updated_at` at all,
-- and the codebase dates a copy change by the `corrections` /
-- `article_body_history` rows the desk writes, not by re-dating the article
-- (see corrections.ts, which edits a published body and leaves published_at
-- alone). This migration deliberately writes no correction row: it corrects
-- a sentence that was never true on this install rather than a report that
-- was wrong, which is 0040's judgement too.
--
-- One inherited hazard, named rather than fixed: `articles` carries
-- `articles_legal_guard` (0047), which raises on an UPDATE to a
-- legally-removed row. 0040 has the same exposure and shipped. A `destroy`
-- removal deletes the row (nothing to update); a `retain` removal would fail
-- this file loudly at deploy. No install is known to be in that state.

-- Part 1 of 2 -- the original seed (migrations/0002_newsroom.sql, lines
-- 111-123) and the pre-0922f74f setup text, which share the two sentences
-- these statements look for. See (a) and (b) above.

-- The dek's gate clause becomes the template's clause.
update articles
   set dek = replace(
         dek,
         'and publishes only what an editor signs.',
         'and prints a reported story only when an editor signs it; owner-activated routine notices are the one exception.'
       )
 where slug = 'welcome-to-townreporter'
   and dek like '%and publishes only what an editor signs.%';

-- The body's overclaim becomes the template's two sentences, and its two
-- Grok-naming sentences name the paper's own model instead. Grep of
-- migrations/0002_newsroom.sql finds exactly two sentences that name Grok:
-- "points Grok at official sources" (the desk paragraph) and "On Scan, Grok
-- fetches" (the how-a-story-gets-here paragraph). Both are below; neither is
-- on a live row (see (a)), and both are exact-phrase replacements, so a body
-- that does not contain them is returned unchanged by `replace()`.
update articles
   set body = replace(
         replace(
           replace(
             body,
             'Nothing on this masthead goes live because a model felt confident.',
             'Nothing reported goes live because a model felt confident. The one exception is the routine notices the owner may separately activate -- approved library, recreation, community-event, registration, waste-collection and public-meeting notices, printed from fixed templates and approved sources.'
           ),
           'points Grok at official sources',
           'points its writing model at official sources'
         ),
         'On Scan, Grok fetches',
         'On Scan, the desk fetches'
       )
 where slug = 'welcome-to-townreporter'
   and (
     body like '%Nothing on this masthead goes live because a model felt confident.%'
     or body like '%points Grok at official sources%'
     or body like '%On Scan, Grok fetches%'
   );

-- Part 2 of 2 -- the text an existing install actually holds, written by
-- migrations/0009_reporting.sql and amended by
-- migrations/0040_welcome_nonprofit.sql. This is the part with a live effect.

-- The dek carries no gate clause at all, so the template's clause is
-- appended to its last sentence. The clause is the template's own, with the
-- paper as its subject; the rest of the dek, including "keeps digging", is
-- left exactly as the owner has it.
--
-- The search phrase stops at "digging." and not at "digging," on purpose.
-- Replacing `then keeps digging.` with `then keeps digging. It prints ...`
-- would leave the phrase it searched for inside its own result, so the replay
-- guard below would still match and a second run would append the clause
-- again -- caught by a dry run. Ending the replacement with a comma destroys
-- the phrase, which is what makes this statement idempotent rather than
-- merely re-runnable once.
update articles
   set dek = replace(
         dek,
         'then keeps digging.',
         'then keeps digging, and prints a reported story only when an editor signs it; owner-activated routine notices are the one exception.'
       )
 where slug = 'welcome-to-townreporter'
   and dek like '%then keeps digging.%';

-- "A human editor still decides what publishes." is the live sentence that
-- routine notices made false -- the same claim the 0002 text made in other
-- words. It becomes the template's two sentences.
update articles
   set body = replace(
         body,
         'A human editor still decides what publishes.',
         'Nothing reported goes live because a model felt confident. The one exception is the routine notices the owner may separately activate -- approved library, recreation, community-event, registration, waste-collection and public-meeting notices, printed from fixed templates and approved sources.'
       )
 where slug = 'welcome-to-townreporter'
   and body like '%A human editor still decides what publishes.%';
