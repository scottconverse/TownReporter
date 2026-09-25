import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createServer, type ViteDevServer } from "vite";
import {
  NAMED_OUTLETS,
  type NamedOutlet,
  unresolvedNamedOutlets,
} from "./outlet-credit.ts";
import { cleanOutletList, outletListFor, outletProblems } from "./named-outlet-rules.ts";
import { IMPACT_STORY_CAP, namedOutletPreview } from "./named-outlet-preview.ts";
import {
  NONE_LABEL,
  builtInLabel,
  impactSentence,
  ownListLabel,
} from "../../components/named-outlets-copy.ts";

/*
  THE OWNER'S OUTLET LIST (0.6.63, Unit W).

  Unit P made which outlets a paper checks a per-newsroom setting
  (paper_settings.named_outlets). This is the editor for it, and the editor
  carries the same blast radius as the section list: the list decides which
  published stories the paper stops printing unless the reader is shown the
  source. So this file pins, in the order the owner meets them:

  * the rules, which refuse a list the matcher cannot tell apart -- two
    outlets that fold to one name, an empty name, a domain that is really a
    URL -- using the SAME fold the gate matches with (outlet-credit.ts).

  * the three stored states, which stay distinct: nothing stored means the
    shipped list, an empty array means this paper checks no outlet names, and
    a list means the list. Each is asserted through the gate's own reader
    (getPaperConfig -> unresolvedNamedOutlets), so "the state the panel shows"
    and "the state the gate acts on" cannot drift apart.

  * the revision token, which makes two editors (or one stale tab) a refusal
    instead of a silent overwrite.

  * the preview, which has to tell the owner, in names and headlines, which
    published stories their change stops checking -- and it has to agree with
    the gate about what counts as naming an outlet, so it asks the gate's
    matcher rather than re-implementing it.

  * the copy, because "3 published stories credit Times-Call" is the whole
    point of the screen and it is cheaper to test than to walk.
*/

const GAZETTE: NamedOutlet = {
  name: "Riverside Gazette",
  aliases: ["Riverside Gazette", "the Gazette"],
  domains: ["riversidegazette.com"],
};

const DENVER: NamedOutlet = {
  name: "Denver Post",
  aliases: ["Denver Post", "the Denver Post"],
  domains: ["denverpost.com"],
};

describe("the rules a list has to pass before it can be applied", () => {
  it("passes the shipped list, whose rows repeat their own name as an alias", () => {
    assert.deepEqual(
      outletProblems(NAMED_OUTLETS),
      [],
      "the built-in list is the standard the editor has to accept",
    );
  });

  it("refuses a nameless row instead of quietly dropping it", () => {
    const problems = outletProblems([{ name: "   ", aliases: [], domains: [] }]);
    assert.equal(problems.length, 1);
    assert.equal(problems[0].row, 0);
    assert.equal(problems[0].field, "name");
    assert.match(problems[0].text, /name/i);
  });

  it("refuses two outlets the matcher cannot tell apart", () => {
    const caseOnly = outletProblems([DENVER, { name: "DENVER POST", aliases: [], domains: [] }]);
    assert.equal(caseOnly.length, 1, "case is not a difference the fold keeps");
    assert.match(caseOnly[0].text, /already/);

    const viaAlias = outletProblems([
      { name: "Longmont Times-Call", aliases: ["Times-Call"], domains: [] },
      { name: "The Times-Call", aliases: ["longmont times-call"], domains: [] },
    ]);
    assert.equal(viaAlias.length, 1, "a hyphen is kept, so these two fold together");
    assert.equal(viaAlias[0].row, 1);
    assert.equal(viaAlias[0].field, "aliases");

    assert.deepEqual(
      outletProblems([
        { name: "Denver Post", aliases: ["Denver Post", "the Denver Post"], domains: [] },
      ]),
      [],
      "a row repeating its own name is not a collision",
    );
  });

  it("refuses a domain that is really a URL, and one that is not a host at all", () => {
    const cases: [string, RegExp][] = [
      ["https://denverpost.com", /alone|bare/i],
      ["denverpost.com/news", /alone|bare/i],
      ["www.denverpost.com", /alone|bare/i],
      ["denver post.com", /alone|bare/i],
      ["denverpost", /not a domain/i],
      ["-denverpost.com", /not a domain/i],
    ];
    for (const [domain, expected] of cases) {
      const problems = outletProblems([{ name: "Denver Post", aliases: [], domains: [domain] }]);
      assert.equal(problems.length, 1, `${domain} should be refused`);
      assert.equal(problems[0].field, "domains");
      assert.match(problems[0].text, expected);
    }
    assert.deepEqual(
      outletProblems([{ name: "Denver Post", aliases: [], domains: [] }]),
      [],
      "no domain is allowed: not every outlet has a website",
    );
  });

  it("cleans a saved list: trimmed, aliases defaulted to the name, hosts lowercased", () => {
    assert.deepEqual(
      cleanOutletList([
        { name: "  Denver Post  ", aliases: ["  the Denver Post ", "Denver Post"], domains: ["DenverPost.com", "denverpost.com"] },
        { name: "Colorado Sun", aliases: [], domains: [] },
      ]),
      [
        {
          name: "Denver Post",
          aliases: ["the Denver Post", "Denver Post"],
          domains: ["denverpost.com"],
        },
        { name: "Colorado Sun", aliases: ["Colorado Sun"], domains: [] },
      ],
    );
  });

  it("reads the list the gate reads: the stored one, or the shipped one when nothing is stored", () => {
    assert.deepEqual(outletListFor(null), NAMED_OUTLETS);
    assert.deepEqual(outletListFor([]), [], "an empty list is an answer");
    assert.deepEqual(outletListFor([GAZETTE]), [GAZETTE]);
  });
});

describe("the list the owner's panel shows and the list the gate uses are one list", () => {
  it("says built-in, none and a list, in words the owner can act on", () => {
    assert.equal(builtInLabel(NAMED_OUTLETS.length), `Using the built-in list (${NAMED_OUTLETS.length} outlets)`);
    assert.equal(builtInLabel(1), "Using the built-in list (1 outlet)");
    assert.equal(NONE_LABEL, "This paper checks no outlet names");
    assert.equal(ownListLabel(2), "This paper checks 2 outlets");
    assert.equal(ownListLabel(1), "This paper checks 1 outlet");
  });

  it("says exactly what a removal costs, in the brief's plain words", () => {
    assert.equal(
      impactSentence("Times-Call", 3),
      "3 published stories credit Times-Call. After this change the paper will no longer check that credit.",
    );
    assert.equal(
      impactSentence("Times-Call", 1),
      "1 published story credits Times-Call. After this change the paper will no longer check that credit.",
    );
  });
});

let vite: ViteDevServer;
let getSql: typeof import("../db.ts").getSql;
let getPaperConfig: typeof import("./paper-settings.ts").getPaperConfig;
let readNamedOutlets: typeof import("./named-outlets.server.ts").readNamedOutlets;
let saveNamedOutlets: typeof import("./named-outlets.server.ts").saveNamedOutlets;
let previewNamedOutlets: typeof import("./named-outlets.server.ts").previewNamedOutlets;

before(async () => {
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    resolve: { alias: { "@": join(process.cwd(), "src") } },
  });
  ({ getSql } = await vite.ssrLoadModule("/src/lib/db.ts"));
  ({ getPaperConfig } = await vite.ssrLoadModule("/src/lib/news/paper-settings.ts"));
});

after(async () => vite.close());

/* Loaded in a hook of its own, inside the groups that need it, so the rules,
   copy and matcher groups above -- which need no database -- can run and fail
   on their own terms while this module does not exist yet. */
async function loadEditor() {
  ({ readNamedOutlets, saveNamedOutlets, previewNamedOutlets } = await vite.ssrLoadModule(
    "/src/lib/news/named-outlets.server.ts",
  ));
}

/** One editor per newsroom: newsroom_members is keyed by user. */
const owner = (newsroomId: number) => `outlet-editor-owner-${newsroomId}`;
const plainEditor = (newsroomId: number) => `outlet-editor-editor-${newsroomId}`;

async function seat(userId: string, role: "owner" | "editor", newsroomId: number) {
  const sql = await getSql();
  await sql.query("delete from newsroom_members where user_id=$1", [userId]);
  await sql.query("insert into newsroom_members(user_id,role,newsroom_id) values($1,$2,$3)", [
    userId,
    role,
    newsroomId,
  ]);
}

/** The three stored states, written the way the settings path writes them. */
async function storeRaw(newsroomId: number, value: unknown, revision = 0) {
  const sql = await getSql();
  await sql.query("delete from paper_settings where newsroom_id=$1", [newsroomId]);
  if (value !== undefined) {
    await sql.query(
      "insert into paper_settings(newsroom_id, named_outlets, named_outlets_revision) values($1,$2,$3)",
      [newsroomId, JSON.stringify(value), revision],
    );
  }
}

/** A published story, as publish leaves one, plus unpublished ones the panel must ignore. */
async function story(
  newsroomId: number,
  headline: string,
  body: string,
  status = "published",
  slug = `s-${newsroomId}-${headline.replace(/\W+/g, "-").toLowerCase()}`,
) {
  const sql = await getSql();
  const [row] = await sql.query<{ id: number }>(
    "insert into articles(user_id,newsroom_id,headline,slug,body,topic,source_urls,status) values($1,$2,$3,$4,$5,'council','[]',$6) returning id",
    [owner(newsroomId), newsroomId, headline, slug, body, status],
  );
  return row.id;
}

/** What the GATE would refuse, read through the gate's own reader. */
async function gateNames(newsroomId: number, body: string) {
  const config = await getPaperConfig(newsroomId);
  return unresolvedNamedOutlets({ body, sourceUrls: [], outlets: config.namedOutlets });
}

describe("the owner's outlet list: three stored states, one reader", { timeout: 60000 }, () => {
  before(loadEditor);

  it("reads nothing-stored as the built-in list, and says who may edit it", async () => {
    const newsroomId = 98440;
    await seat(owner(newsroomId), "owner", newsroomId);
    await seat(plainEditor(newsroomId), "editor", newsroomId);
    await storeRaw(newsroomId, undefined);

    const asOwner = await readNamedOutlets(owner(newsroomId));
    assert.equal(asOwner.stored, null, "nothing stored is not an empty list");
    assert.equal(asOwner.revision, 0);
    assert.deepEqual(asOwner.shipped, NAMED_OUTLETS);
    assert.equal(asOwner.canEdit, true);

    const asEditor = await readNamedOutlets(plainEditor(newsroomId));
    assert.equal(
      asEditor.canEdit,
      false,
      "an editor with desk rights may read the list, like the Sections panel",
    );
  });

  it("keeps an empty list and a built-in list apart, all the way to the gate", async () => {
    const newsroomId = 98441;
    await seat(owner(newsroomId), "owner", newsroomId);
    await storeRaw(newsroomId, undefined);

    const named = "The Denver Post reported the vote.";
    assert.deepEqual(await gateNames(newsroomId, named), ["Denver Post"], "nothing stored checks the shipped list");
    assert.deepEqual(await readNamedOutlets(owner(newsroomId)).then((read) => read.stored), null);

    const emptied = await saveNamedOutlets(owner(newsroomId), { revision: 0, outlets: [] });
    assert.equal(emptied.revision, 1);
    assert.deepEqual(emptied.outlets, []);
    const afterEmpty = await readNamedOutlets(owner(newsroomId));
    assert.deepEqual(afterEmpty.stored, [], "an empty list is stored as an answer, not as a gap");
    assert.deepEqual(await gateNames(newsroomId, named), [], "and the gate stops checking");

    const restored = await saveNamedOutlets(owner(newsroomId), { revision: 1, outlets: null });
    assert.deepEqual(restored.outlets, null);
    const afterRestore = await readNamedOutlets(owner(newsroomId));
    assert.equal(afterRestore.stored, null, "going back to the built-in list stores NULL");
    assert.equal(afterRestore.revision, 2, "every apply moves the revision forward");
    assert.deepEqual(await gateNames(newsroomId, named), ["Denver Post"]);
  });

  it("stores a list, and only the owner may write it", async () => {
    const newsroomId = 98442;
    await seat(owner(newsroomId), "owner", newsroomId);
    await seat(plainEditor(newsroomId), "editor", newsroomId);
    await storeRaw(newsroomId, undefined);

    await assert.rejects(
      () => saveNamedOutlets(plainEditor(newsroomId), { revision: 0, outlets: [GAZETTE] }),
      /Only the owner/,
      "an editor cannot change which outlets the paper checks",
    );

    const saved = await saveNamedOutlets(owner(newsroomId), { revision: 0, outlets: [GAZETTE] });
    assert.equal(saved.revision, 1);
    assert.deepEqual((await readNamedOutlets(owner(newsroomId))).stored, [GAZETTE]);
    assert.deepEqual(await gateNames(newsroomId, "The Riverside Gazette reported it."), [
      "Riverside Gazette",
    ]);
  });

  it("refuses a list the matcher cannot tell apart, and writes nothing", async () => {
    const newsroomId = 98443;
    await seat(owner(newsroomId), "owner", newsroomId);
    await storeRaw(newsroomId, [DENVER], 4);

    await assert.rejects(
      () =>
        saveNamedOutlets(owner(newsroomId), {
          revision: 4,
          outlets: [DENVER, { name: "the denver post", aliases: [], domains: [] }],
        }),
      /already/,
    );
    await assert.rejects(
      () => saveNamedOutlets(owner(newsroomId), { revision: 4, outlets: [GAZETTE, { name: " ", aliases: [], domains: [] }] }),
      /name/i,
    );
    const after = await readNamedOutlets(owner(newsroomId));
    assert.equal(after.revision, 4, "a refused apply leaves the revision where it was");
    assert.deepEqual(after.stored, [DENVER]);
  });

  it("refuses a stale revision instead of overwriting the other tab's work", async () => {
    const newsroomId = 98444;
    await seat(owner(newsroomId), "owner", newsroomId);
    await storeRaw(newsroomId, undefined);

    const first = await saveNamedOutlets(owner(newsroomId), { revision: 0, outlets: [GAZETTE] });
    assert.equal(first.revision, 1);

    await assert.rejects(
      () => saveNamedOutlets(owner(newsroomId), { revision: 0, outlets: [DENVER] }),
      /changed while you were editing/,
    );
    const after = await readNamedOutlets(owner(newsroomId));
    assert.deepEqual(after.stored, [GAZETTE], "the first save stands");
    assert.equal(after.revision, 1);
  });
});

describe("the preview names the published stories a change stops checking", { timeout: 60000 }, () => {
  before(loadEditor);

  it("lists the story behind a removal, newest first, and only published ones", async () => {
    const newsroomId = 98450;
    await seat(owner(newsroomId), "owner", newsroomId);
    await story(newsroomId, "Council delays the vote", "The Denver Post reported the delay.");
    await story(newsroomId, "Water rates rise", "The Denver Post reported the increase.");
    await story(newsroomId, "Unfinished draft", "The Denver Post reported something.", "draft");
    await storeRaw(newsroomId, [GAZETTE, DENVER], 1);

    const preview = await previewNamedOutlets(owner(newsroomId), { revision: 1, outlets: [GAZETTE] });
    assert.equal(preview.changes.length, 1);
    const [change] = preview.changes;
    assert.equal(change.kind, "removed");
    assert.equal(change.name, "Denver Post");
    assert.equal(change.storyCount, 2);
    assert.deepEqual(
      change.stories.map((s) => s.headline),
      ["Water rates rise", "Council delays the vote"],
      "newest first, and the unpublished draft is not a published story",
    );
    assert.equal(change.stories[0].url, `/articles/s-${newsroomId}-water-rates-rise`);
    assert.equal(
      preview.revision,
      1,
      "a preview reports the revision it read, so the panel applies against it",
    );
  });

  it("lists only the stories that use an alias the change drops", async () => {
    const newsroomId = 98451;
    await seat(owner(newsroomId), "owner", newsroomId);
    await story(newsroomId, "Sirens at midnight", "The R Gazette reported the sirens.");
    await story(newsroomId, "Bakery reopens", "The Riverside Gazette reported the reopening.");
    const before: NamedOutlet = {
      name: "Riverside Gazette",
      aliases: ["Riverside Gazette", "the R Gazette"],
      domains: ["riversidegazette.com"],
    };
    await storeRaw(newsroomId, [before], 2);

    const preview = await previewNamedOutlets(owner(newsroomId), {
      revision: 2,
      outlets: [{ ...before, aliases: ["Riverside Gazette"] }],
    });
    const [change] = preview.changes;
    assert.equal(change.kind, "changed");
    assert.deepEqual(change.droppedAliases, ["the R Gazette"]);
    assert.equal(change.storyCount, 1);
    assert.deepEqual(change.stories.map((s) => s.headline), ["Sirens at midnight"]);
    assert.equal(
      change.before?.aliases.length,
      2,
      "the preview shows the before and after of the row it changed",
    );
    assert.deepEqual(change.after?.aliases, ["Riverside Gazette"]);
  });

  it("shows an added outlet without a story list, because nothing is unchecked", async () => {
    const newsroomId = 98452;
    await seat(owner(newsroomId), "owner", newsroomId);
    await story(newsroomId, "Day one of the strike", "The Denver Post reported it.");
    await storeRaw(newsroomId, [], 0);

    const preview = await previewNamedOutlets(owner(newsroomId), { revision: 0, outlets: [DENVER] });
    assert.deepEqual(preview.changes.map((c) => [c.kind, c.name]), [["added", "Denver Post"]]);
    assert.equal(preview.changes[0].storyCount, 0, "adding an outlet costs no story its credit");
    assert.deepEqual(preview.changes[0].stories, []);
  });

  it("caps the story list at twenty and still counts them all", async () => {
    const newsroomId = 98453;
    await seat(owner(newsroomId), "owner", newsroomId);
    const total = IMPACT_STORY_CAP + 3;
    for (let i = 0; i < total; i += 1) {
      await story(newsroomId, `Sewer line ${i}`, "The Denver Post reported it.", "published", `sewer-${i}`);
    }
    await storeRaw(newsroomId, [DENVER, GAZETTE], 0);

    const preview = await previewNamedOutlets(owner(newsroomId), { revision: 0, outlets: [GAZETTE] });
    const [change] = preview.changes;
    assert.equal(change.storyCount, total);
    assert.equal(change.stories.length, IMPACT_STORY_CAP, "the list is capped, the count is not");
  });

  it("reads going back to the built-in list as seven additions", async () => {
    const newsroomId = 98454;
    await seat(owner(newsroomId), "owner", newsroomId);
    await storeRaw(newsroomId, [], 3);

    const preview = await previewNamedOutlets(owner(newsroomId), { revision: 3, outlets: null });
    assert.deepEqual(
      preview.changes.map((c) => c.name).sort(),
      NAMED_OUTLETS.map((o) => o.name).sort(),
    );
    assert.equal(preview.usingShipped, true);
  });

  it("is a read: it changes nothing, and an editor cannot ask for it", async () => {
    const newsroomId = 98455;
    await seat(owner(newsroomId), "owner", newsroomId);
    await seat(plainEditor(newsroomId), "editor", newsroomId);
    await story(newsroomId, "Ferry runs again", "The Denver Post reported it.");
    await storeRaw(newsroomId, [DENVER, GAZETTE], 7);

    await assert.rejects(
      () => previewNamedOutlets(plainEditor(newsroomId), { revision: 7, outlets: [] }),
      /Only the owner/,
    );

    await previewNamedOutlets(owner(newsroomId), { revision: 7, outlets: [GAZETTE] });
    const after = await readNamedOutlets(owner(newsroomId));
    assert.equal(after.revision, 7, "a preview is not an apply");
    assert.deepEqual(after.stored, [DENVER, GAZETTE]);
  });
});

describe("the preview decides with the gate's own matcher", () => {
  it("does not report a story that only happens to contain the words", () => {
    const stories = [
      {
        id: 1,
        headline: "At the office",
        slug: "at-the-office",
        body: "Call the office at times call, and the camera at the corner was repainted.",
        sourceUrls: [],
      },
    ];
    assert.deepEqual(
      namedOutletPreview([NAMED_OUTLETS[0]], [], stories),
      [
        {
          kind: "removed",
          name: "Longmont Times-Call",
          before: NAMED_OUTLETS[0],
          after: null,
          droppedAliases: NAMED_OUTLETS[0].aliases,
          stories: [],
          storyCount: 0,
        },
      ],
      "the false positive this fold was fixed for must not reappear on the preview screen",
    );
  });
});
