/*
  PUB2 item 2 (review-bot finding on PR 163): the publish result is recorded
  BEFORE the cache refreshes are awaited.

  TanStack Query keeps a mutation `isPending` until an async `onSuccess`
  settles. The publish mutation's `onSuccess` awaited four `invalidateQueries`
  (each of which refetches) BEFORE it set `publishedSlug`, `justPublished` and
  `msg` -- so a slow or stalled `lead` refetch kept the publish bar saying
  "Publishing…" while the article was already committed, and pressing the
  button again was possible-looking. The two refusal paths had the same
  ordering with `invalidateQueries(["lead", id])`: the refusal was written to
  the bar, but the state it belonged to was not settled until the refetch
  returned.

  The fix: write the result state first, then fire the invalidations without
  awaiting them, with their rejection handled.

  SOURCE-SHAPE. The repo has no harness that drives this route's mutation with
  a never-resolving refetch (no render harness for the 3,000-line story route
  at all), so the property is asserted on the mutation's own source: the
  setters come first, and no invalidation is awaited. A mutation that puts the
  `await` back in front of the setters fails this test -- see the unit report.

  The slice is taken from `const publish = useMutation({` to the next
  `"Suggest headlines"` comment, so no other mutation in the file is read.
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const story = await readFile(
  new URL("../src/routes/desk.story.$leadId.tsx", import.meta.url),
  "utf8",
);

const start = story.indexOf("const publish = useMutation({");
// The NEXT occurrence after the mutation: the phrase also appears in an
// earlier comment (the "Suggest headlines" feature's own documentation).
const end = story.indexOf('"Suggest headlines"', start);
const publish = start >= 0 && end > start ? story.slice(start, end) : "";

test("the publish mutation slice is found", () => {
  assert.ok(publish.length > 400, "the publish mutation was located in the route");
  assert.match(publish, /mutationFn:/);
  assert.match(publish, /onSuccess:/);
  assert.match(publish, /onError:/);
});

test("the success path records the result before it refreshes anything", () => {
  const atSlug = publish.indexOf("setPublishedSlug(result.slug)");
  const atJustPublished = publish.indexOf("setJustPublished(true)");
  const atMsg = publish.indexOf("setMsg(notesProblem");
  const atLeads = publish.indexOf('refresh(["leads"])');
  const atPaper = publish.indexOf('refresh(["paper"])');
  const atPublishedDesk = publish.indexOf('refresh(["published-desk"])');
  // The LAST one: the refusal path refreshes the lead too, and it legitimately
  // runs before the success path's setters.
  const atLead = publish.lastIndexOf('refresh(["lead", id])');
  for (const [name, at] of [
    ["setPublishedSlug", atSlug],
    ["setJustPublished", atJustPublished],
    ["setMsg", atMsg],
    ["leads refresh", atLeads],
    ["paper refresh", atPaper],
    ["published-desk refresh", atPublishedDesk],
    ["lead refresh", atLead],
  ]) {
    assert.ok(at >= 0, `the success path still carries ${name}`);
  }
  assert.ok(atSlug < atLeads, "publishedSlug is set before the leads refetch is started");
  assert.ok(atJustPublished < atLeads, "justPublished is set before the leads refetch is started");
  assert.ok(atMsg < atLeads, "msg is set before the leads refetch is started");
  assert.ok(atSlug < atLead, "publishedSlug is set before the lead refetch is started");
});

test("the refusal paths write their state before refreshing", () => {
  assert.match(
    publish,
    /const refuse = \(text: string\) => \{\s*setMsg\(""\);\s*setPublishRefusal\(text\);\s*refresh\(\["lead", id\]\);\s*\}/,
    "a refusal is written to the bar, then the lead query is refreshed without being waited on",
  );
  assert.match(
    publish,
    /onError: \(err\) => \{\s*setMsg\(""\);\s*setPublishRefusal\([\s\S]*?\);\s*void qc\.invalidateQueries\(\{ queryKey: \["lead", id\] \}\)\.catch\(/,
    "onError writes the refusal, then refreshes without waiting",
  );
});

test("no publish-path invalidation is awaited", () => {
  assert.doesNotMatch(
    publish,
    /await\s+qc\.invalidateQueries/,
    "an awaited invalidation keeps the mutation pending and the bar on 'Publishing…'",
  );
  assert.doesNotMatch(publish, /onSuccess: async/, "an async onSuccess re-introduces the wait");
  assert.doesNotMatch(publish, /onError: async/, "an async onError re-introduces the wait");
  /*
    Fired, not forgotten: every invalidation on this path has its rejection
    handled, so a refetch that rejects cannot land as an unhandled rejection.
  */
  assert.match(publish, /void qc\.invalidateQueries\(\{ queryKey \}\)\.catch\(\(\) => \{\}\)/);
  assert.match(publish, /void qc\.invalidateQueries\(\{ queryKey: \["lead", id\] \}\)\.catch\(\(\) => \{\}\)/);
});
