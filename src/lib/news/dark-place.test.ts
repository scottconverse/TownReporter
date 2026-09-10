import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { darkSystemFor, darkPlannerFor } from "./dark-prompt.ts";
import { describeDials, jurisdictionsFor, scopeLabelsFor, type DarkScope } from "./dark-dials.ts";
import { subredditFromSources } from "./dark-place.ts";
const other = { city: "Testerville", state: "Oregon", county: "Example" };
it("configured non-Longmont geography governs analyst prompt and every dial scope", () => {
  for (const scope of ["city", "county", "region", "adjacent"] as DarkScope[]) {
    const d = { dig: 5, nerve: 5, scope };
    const prompt = darkSystemFor(d, other);
    assert.match(prompt, /CITY: Testerville, Oregon/);
    assert.doesNotMatch(prompt, /Longmont|Boulder|Weld|Larimer|Colorado|Erie|Firestone|Mead/);
    assert.match(describeDials(d, other), /Testerville/);
    assert.doesNotMatch(jurisdictionsFor(scope, other).join(","), /Longmont|Boulder|Colorado/);
  }
  assert.match(darkPlannerFor(other), /Testerville, Oregon/);
  assert.doesNotMatch(darkPlannerFor(other), /Longmont|Colorado/);
});
it("actual Longmont Colorado retains its established regional map", () => {
  assert.match(
    darkSystemFor({ dig: 5, nerve: 5, scope: "region" }, { city: "Longmont", state: "Colorado" }),
    /Boulder County.*Weld County.*Larimer County/,
  );
  assert.match(scopeLabelsFor({ city: "Longmont", state: "CO" }).city, /Longmont only/);
  assert.doesNotMatch(
    darkSystemFor({ dig: 5, nerve: 5, scope: "region" }, { city: "Longmont", state: "Oregon" }),
    /Boulder|Weld|Colorado/,
  );
});
it("subreddit comes only from one unambiguous accepted source set, never a city guess", () => {
  assert.equal(subredditFromSources([]), null);
  assert.equal(subredditFromSources(["https://city.example.gov/"]), null);
  assert.equal(
    subredditFromSources([
      "https://www.reddit.com/r/Testerville/new/.rss",
      "https://old.reddit.com/r/testerville/comments/a/thread",
    ]),
    "testerville",
  );
  assert.equal(
    subredditFromSources(["https://www.reddit.com/r/longmont", "https://www.reddit.com/r/boulder"]),
    null,
  );
  assert.equal(subredditFromSources(["https://reddit.com.evil.test/r/longmont"]), null);
  assert.equal(subredditFromSources(["https://www.reddit.com/r/longmont"]), "longmont");
});
it("runtime planner and synthesis use configured place; Reddit endpoint is newsroom scoped and fails closed", () => {
  const dark = readFileSync(new URL("./dark.ts", import.meta.url), "utf8");
  const investigate = readFileSync(new URL("./investigate.ts", import.meta.url), "utf8");
  assert.match(dark, /grokChat\(darkSystemFor\(dials, place\)/);
  assert.match(investigate, /grokPlanner\(pack, opts.choice, opts.providerOverrides, place, newsroomId\)/);
  assert.doesNotMatch(investigate, /Longmont|Colorado/);
  assert.match(
    dark,
    /select url from sources where newsroom_id=\$\{newsroomId\} and status='accepted'/,
  );
  assert.match(dark, /const sub = await readTipSubreddit\(owned\(context\)\)/);
  assert.match(dark, /if \(!sub\) throw new Error/);
  assert.doesNotMatch(dark, /const sub = TIP_SUBREDDIT/);
});

it("actual research loop reads this newsroom setup; accepted Reddit sources stay isolated", async () => {
  const { getSql } = await import("../db.ts");
  const { ensureDarkSchema, readDarkPlace, readTipSubreddit } = await import("./dark.ts");
  const { researchLoop, emptyPlan } = await import("./investigate.ts");
  await ensureDarkSchema();
  const sql = await getSql();
  await sql.query(
    `create table if not exists sources(id serial primary key,user_id text,newsroom_id integer,url text,title text,status text,tier text)`,
  );
  await readDarkPlace(771);
  await sql`insert into paper_settings(newsroom_id,city,state,onboarded) values(771,'Testerville','Oregon',true)`;
  const [inv] = await sql<{
    id: number;
  }>`insert into investigations(user_id,newsroom_id,title) values('local-place-test',771,'School choir') returning id`;
  await sql`insert into frontier_items(user_id,newsroom_id,investigation_id,label,kind) values('local-place-test',771,${inv.id},'School choir','topic')`;
  const packs: string[] = [];
  await researchLoop({
    userId: "local-place-test",
    newsroomId: 771,
    investigationId: inv.id,
    hops: 1,
    planner: async (pack) => {
      packs.push(pack);
      return emptyPlan();
    },
    search: async () => [],
    fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
    archives: async () => [],
  });
  assert.ok(packs.length > 0);
  assert.match(packs[0], /Testerville, Oregon/);
  assert.doesNotMatch(packs[0], /Longmont|Colorado/);
  await sql`insert into sources(user_id,newsroom_id,url,title,status) values('local-place-test',772,'https://reddit.com/r/longmont','Foreign room','accepted')`;
  await sql`insert into sources(user_id,newsroom_id,url,title,status) values('local-place-test',771,'https://reddit.com/r/wrongtown','Unaccepted suggestion','proposed')`;
  assert.equal(await readTipSubreddit(771), null);
  await sql`insert into sources(user_id,newsroom_id,url,title,status) values('local-place-test',771,'https://reddit.com/r/testerville','Local source','accepted')`;
  assert.equal(await readTipSubreddit(771), "testerville");
  assert.equal(await readTipSubreddit(772), "longmont");
});
