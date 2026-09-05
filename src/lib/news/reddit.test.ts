import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  civicScore,
  parseRedditFeed,
  pickCivicPosts,
  redditAnomaly,
  subredditNewFeed,
  subredditSearchFeed,
  threadFeed,
} from "./reddit.ts";
import {
  presentWorthItem,
  rankWorthItems,
  withReservedTipSlots,
  type WorthSeed,
} from "./worth-a-look.ts";

const here = dirname(fileURLToPath(import.meta.url));
const FEED = readFileSync(join(here, "__fixtures__", "reddit-longmont-new.xml"), "utf8");

describe("reddit feed URLs", () => {
  it("builds the feeds the technique depends on", () => {
    assert.equal(subredditNewFeed("longmont"), "https://www.reddit.com/r/longmont/new/.rss");
    const search = subredditSearchFeed("longmont", "city council OR ordinance");
    assert.match(search, /^https:\/\/www\.reddit\.com\/r\/longmont\/search\.rss\?/);
    assert.match(search, /restrict_sr=on/, "must stay inside the subreddit");
    assert.match(search, /sort=new/);
    assert.match(search, /q=city%20council%20OR%20ordinance/);
  });

  it("keeps a subreddit name from escaping the path", () => {
    const url = subredditNewFeed("longmont/../../admin");
    assert.equal(url.includes("/../"), false);
    assert.match(url, /^https:\/\/www\.reddit\.com\/r\//);
  });

  it("turns a permalink into its comment feed", () => {
    assert.equal(
      threadFeed("https://www.reddit.com/r/longmont/comments/abc/slug/?utm_source=share"),
      "https://www.reddit.com/r/longmont/comments/abc/slug/.rss",
    );
  });
  it("keeps the feed suffix in the path and makes RSS URLs idempotent", () => {
    const feed = "https://www.reddit.com/r/longmont/comments/abc/slug/.rss";
    assert.equal(threadFeed("https://www.reddit.com/r/longmont/comments/abc/slug/#comments"), feed);
    assert.equal(threadFeed(`${feed}?context=3#comments`), feed);
  });

});

describe("parseRedditFeed", () => {
  it("reads a real feed", () => {
    const posts = parseRedditFeed(FEED);
    assert.equal(posts.length, 11);
    const first = posts[0]!;
    assert.match(first.title, /Lunar Eclipse/);
    assert.match(first.url, /^https:\/\/www\.reddit\.com\/r\/longmont\/comments\//);
    assert.match(first.updated, /^2026-/);
    assert.match(first.author, /example1/);
  });

  /** Reddit puts unescaped HTML inside <content>; it must arrive as text. */
  it("strips the markup out of the excerpt", () => {
    const post = parseRedditFeed(FEED).find((p) => /left turns/i.test(p.title))!;
    assert.doesNotMatch(post.excerpt, /[<>]/);
    assert.match(post.excerpt, /CDOT says it starts/);
  });

  it("ignores anything that is not a reddit permalink", () => {
    const xml = `<feed><entry><title>Ad</title><link href="https://example.com/x"/></entry></feed>`;
    assert.deepEqual(parseRedditFeed(xml), []);
  });

  it("returns nothing rather than throwing on rubbish", () => {
    assert.deepEqual(parseRedditFeed(""), []);
    assert.deepEqual(parseRedditFeed("<html>429 Too Many Requests</html>"), []);
  });
});

describe("civicScore", () => {
  const posts = parseRedditFeed(FEED);
  const byTitle = (re: RegExp) => posts.find((p) => re.test(p.title))!;

  /**
   * The regression that shaped the whole scorer.
   *
   * The first version listed the word "closure"; the real post said "will
   * close". It scored 3 out of 20 — under its own threshold — for a story this
   * paper had already published.
   */
  it("catches the road closure the first version missed", () => {
    assert.ok(civicScore(byTitle(/left turns/i)) >= 10);
  });

  it("scores a council vote highest of all", () => {
    const council = civicScore(byTitle(/city council votes/i));
    assert.ok(council >= 15, `council scored ${council}`);
  });

  it("keeps a housing complaint that is also a story", () => {
    // Advice-seeking AND a rent increase with a named fee. Penalised, not lost.
    assert.ok(civicScore(byTitle(/rent went up/i)) >= 8);
  });

  it("leaves small talk far below the threshold", () => {
    for (const re of [/soap/i, /appetizer/i, /Lunar Eclipse/i, /rant, and rave/i, /Apartment advice/i]) {
      const s = civicScore(byTitle(re));
      assert.ok(s <= 3, `"${byTitle(re).title}" scored ${s}`);
    }
  });

  it("is 0 for nothing at all", () => {
    assert.equal(civicScore({ title: "", excerpt: "" }), 0);
  });

  it("never leaves the 0-20 range", () => {
    const loaded = {
      title: "council ordinance ballot budget tax permit lawsuit contract mayor rtd cdot",
      excerpt: "$5,000,000 ordinance no. 2026-41 public hearing agenda minutes audit rezoning",
    };
    const s = civicScore(loaded);
    assert.ok(s >= 0 && s <= 20, `out of range: ${s}`);
  });
});

describe("pickCivicPosts", () => {
  it("returns the day's real stories and nothing else", () => {
    const picked = pickCivicPosts(parseRedditFeed(FEED));
    assert.equal(picked.length, 3);
    assert.match(picked[0]!.title, /city council votes/i, "best first");
    assert.equal(picked.some((p) => /soap|appetizer|eclipse/i.test(p.title)), false);
  });

  it("honours the limit", () => {
    assert.equal(pickCivicPosts(parseRedditFeed(FEED), 0, 2).length, 2);
  });
});

describe("redditAnomaly", () => {
  const post = parseRedditFeed(FEED).find((p) => /city council votes/i.test(p.title))!;

  /**
   * Everything filed becomes a card an editor may act on, so the wording has
   * to read as a claim someone made on the internet — never as something the
   * paper knows.
   */
  it("files a tip as unverified, with its permalink and date", () => {
    const a = redditAnomaly(post, "longmont");
    assert.equal(a.kind, "reddit-tip");
    assert.match(a.summary, /^r\/longmont: /);
    assert.match(a.details, /UNVERIFIED/);
    assert.match(a.details, /Find the document/);
    assert.match(a.details, /Posted 2026-08-27/);
    assert.equal(a.url, post.url);
  });

  it("says 'undated' rather than inventing a date", () => {
    const a = redditAnomaly({ ...post, updated: "" }, "longmont");
    assert.match(a.details, /Posted undated/);
  });
});

describe("withReservedTipSlots", () => {
  const item = (kind: string, priority: number, n: number): WorthSeed => ({
    id: `${kind}-${n}`,
    kind,
    title: `${kind} ${n}`,
    happened: "",
    why: "",
    evidence: "",
    source_url: `https://example.gov/${kind}/${n}`,
    question: "",
    seed: "",
    priority,
  });

  const records = Array.from({ length: 20 }, (_, i) => item("missing-record", 10, i));
  const tips = Array.from({ length: 5 }, (_, i) => item("reddit-tip", 6, i));

  /**
   * The regression. Twelve records outranked every tip, so a run that filed
   * seven tips displayed none: the button said "Filed 7 tips" and the page
   * showed nothing.
   */
  it("shows tips even when records fill the whole list", () => {
    const out = withReservedTipSlots([...records, ...tips], 12, 2);
    assert.equal(out.length, 12);
    assert.equal(out.filter((i) => i.kind === "reddit-tip").length, 2);
  });

  it("does not spend the reserve when there are no tips", () => {
    const out = withReservedTipSlots(records, 12, 2);
    assert.equal(out.length, 12);
    assert.equal(out.every((i) => i.kind === "missing-record"), true);
  });

  it("takes only what it needs when there are fewer tips than slots", () => {
    const out = withReservedTipSlots([...records, tips[0]!], 12, 2);
    assert.equal(out.filter((i) => i.kind === "reddit-tip").length, 1);
    assert.equal(out.length, 12);
  });

  it("still ranks records above tips on the page", () => {
    const out = withReservedTipSlots([...records, ...tips], 12, 2);
    const firstTip = out.findIndex((i) => i.kind === "reddit-tip");
    assert.ok(firstTip >= 10, `a tip appeared at position ${firstTip}`);
  });

  it("does not pad a short list", () => {
    const out = withReservedTipSlots([records[0]!, tips[0]!], 12, 2);
    assert.equal(out.length, 2);
  });
});

describe("tip cards read honestly", () => {
  const tip = {
    kind: "reddit-tip",
    summary: "r/longmont: All left turns at CO 119 and Hover will close",
    url: "https://www.reddit.com/r/longmont/comments/aaa004/x/",
    details: "Posted 2026-08-28 by /u/x on r/longmont.\nUNVERIFIED — a resident's account.",
  };

  /**
   * The card first read "A monitored public record did not look the way it
   * usually does" — not vague but false. Nothing was monitored and nothing
   * changed; somebody posted something.
   */
  it("does not claim a monitored record changed", () => {
    const [card] = rankWorthItems({ anomalies: [tip] }).map(presentWorthItem);
    assert.doesNotMatch(card!.why, /monitored public record/i);
    assert.match(card!.why, /subreddit/i);
    assert.match(card!.why, /Nobody has checked it/i);
  });

  it("asks the reporter for the record behind it", () => {
    const [card] = rankWorthItems({ anomalies: [tip] }).map(presentWorthItem);
    assert.match(card!.question, /which agency would hold the record/i);
  });

  it("still labels an ordinary anomaly the old way", () => {
    const [card] = rankWorthItems({
      anomalies: [{ kind: "disappeared", summary: "Packet gone", url: "https://x.gov/a", details: "" }],
    }).map(presentWorthItem);
    assert.doesNotMatch(card!.why, /subreddit/i);
  });
});
