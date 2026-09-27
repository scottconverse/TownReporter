/*
  The vocabulary and arithmetic of the reading beacon, without a database.

  Everything asserted here is what the reader's BROWSER decides before it sends
  anything (src/components/read-beacon.tsx runs these same functions), so these
  cases are also the test of the beacon's privacy promise: a referrer is turned
  into one of eight words here and the URL is dropped; a path is canonicalized
  to a short allowlist here and nothing else is sent. If a case below could
  return a URL, a query string, a slug that is not published, or a device name
  guessed from a user agent, the server half in reading.server.ts would be
  receiving something it promised never to hold.
*/

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ARTICLE_PATH_PREFIX,
  BEACON_TRUST_EVENTS,
  LEFT_WITHOUT_READING_SECONDS,
  MAX_READ_SECONDS,
  READ_DEPTH_BUCKETS,
  READ_DEVICE_LABELS,
  READ_DEVICES,
  READ_PATH_LABELS,
  READ_REF_CLASSES,
  READ_REF_CLASS_LABELS,
  READ_STANDING_PATHS,
  TRUST_EVENTS,
  TRUST_EVENT_LABELS,
  classifyArrival,
  clampReadSeconds,
  depthBucketsReached,
  deviceForWidth,
  formatClock,
  formatCount,
  formatHours,
  hostnameOf,
  isArticlePath,
  normalizeReadPath,
  readAgeLabel,
  readPathFallbackLabel,
  storySlugFromPath,
} from "./reading.ts";

describe("deviceForWidth", () => {
  it("is a viewport width and nothing else", () => {
    assert.equal(deviceForWidth(390), "phone");
    assert.equal(deviceForWidth(639), "phone");
    assert.equal(deviceForWidth(640), "tablet");
    assert.equal(deviceForWidth(1023), "tablet");
    assert.equal(deviceForWidth(1024), "computer");
    assert.equal(deviceForWidth(2560), "computer");
  });

  it("falls back to computer for a width it cannot believe", () => {
    assert.equal(deviceForWidth(0), "computer");
    assert.equal(deviceForWidth(-1), "computer");
    assert.equal(deviceForWidth(Number.NaN), "computer");
    assert.equal(deviceForWidth(Number.POSITIVE_INFINITY), "computer");
  });
});

describe("device class vocabulary", () => {
  it("labels every device, and only those devices", () => {
    assert.deepEqual(Object.keys(READ_DEVICE_LABELS).sort(), [...READ_DEVICES].sort());
    for (const device of READ_DEVICES) assert.ok(READ_DEVICE_LABELS[device].length > 0);
  });
});

describe("classifyArrival", () => {
  const SELF = "smallpaper.example";
  const story = (slug: string) => `${ARTICLE_PATH_PREFIX}${slug}`;

  it("reads a search engine as search, including a country domain", () => {
    assert.equal(
      classifyArrival("https://www.google.com/search?q=who+won", SELF, story("council-vote")).refClass,
      "search",
    );
    assert.equal(
      classifyArrival("https://google.de/search?q=rat", SELF, story("council-vote")).refClass,
      "search",
    );
    assert.equal(
      classifyArrival("https://duckduckgo.com/?q=rates", SELF, "/").refClass,
      "search",
    );
  });

  it("reads facebook and reddit by host", () => {
    assert.equal(classifyArrival("https://l.facebook.com/l.php?u=x", SELF, "/").refClass, "facebook");
    assert.equal(classifyArrival("https://www.reddit.com/r/town/", SELF, "/").refClass, "reddit");
    assert.equal(classifyArrival("https://redd.it/abc", SELF, "/").refClass, "reddit");
  });

  it("reads a feed reader as rss, and says so honestly when it cannot tell", () => {
    assert.equal(classifyArrival("https://feedly.com/i/entry/x", SELF, "/").refClass, "rss");
    assert.equal(classifyArrival("https://miniflux.app/", SELF, "/").refClass, "rss");
  });

  it("reads another local paper's site as local", () => {
    assert.equal(
      classifyArrival("https://othertownnews.example/story", SELF, "/").refClass,
      "local",
    );
  });

  it("treats our own host as internal, whichever form it arrives in", () => {
    assert.equal(
      classifyArrival(`https://${SELF}/articles/a`, SELF, story("b")).refClass,
      "internal",
    );
    assert.equal(
      classifyArrival(`https://www.${SELF}:8443/articles/a`, `https://${SELF}`, story("b")).refClass,
      "internal",
    );
  });

  it("counts an internal arrival from one of our stories as 'read another story'", () => {
    const fromStory = classifyArrival(`https://${SELF}${story("council-vote")}`, SELF, story("schools"));
    assert.equal(fromStory.refClass, "internal");
    assert.equal(fromStory.fromArticle, true);

    const fromStanding = classifyArrival(`https://${SELF}/about`, SELF, story("schools"));
    assert.equal(fromStanding.refClass, "internal");
    assert.equal(fromStanding.fromArticle, false, "the front page is not a story");
  });

  it("files an empty referrer on a story under email/apps/texts, and on a standing page under direct", () => {
    const fromText = classifyArrival("", SELF, story("council-vote"));
    assert.equal(fromText.refClass, "share");
    assert.equal(fromText.fromArticle, false);
    assert.equal(classifyArrival(undefined, SELF, story("council-vote")).refClass, "share");
    assert.equal(classifyArrival("", SELF, "/").refClass, "direct");
    assert.equal(classifyArrival("   ", SELF, "/about").refClass, "direct");
  });

  it("never returns anything but a class and one boolean -- no URL, no host, no path", () => {
    const result = classifyArrival(
      "https://www.google.com/search?q=a+private+query&utm=secret",
      SELF,
      story("council-vote"),
    );
    assert.deepEqual(Object.keys(result).sort(), ["fromArticle", "refClass"]);
    assert.deepEqual(Object.values(result).filter((v) => typeof v === "string"), ["search"]);
    assert.ok(!JSON.stringify(result).includes("private+query"));
  });

  it("does not mistake a lookalike host for a search engine or for us", () => {
    assert.equal(classifyArrival("https://notgoogle.com/x", SELF, "/").refClass, "local");
    assert.equal(classifyArrival("https://google.com.evil.example/x", SELF, "/").refClass, "local");
    assert.equal(
      classifyArrival("https://smallpaper.example.evil.example/x", SELF, "/").refClass,
      "local",
      "a suffix match must not run the other way",
    );
  });
});

describe("hostnameOf", () => {
  it("drops www and the port so two spellings compare equal", () => {
    assert.equal(hostnameOf("https://www.Example.com:8443/x"), "example.com");
    assert.equal(hostnameOf("example.com"), "example.com");
    assert.equal(hostnameOf("EXAMPLE.COM/path"), "example.com");
  });

  it("returns nothing for anything unparseable", () => {
    assert.equal(hostnameOf(""), "");
    assert.equal(hostnameOf("   "), "");
    assert.equal(hostnameOf(null), "");
    assert.equal(hostnameOf(42), "");
    assert.equal(hostnameOf("http://"), "");
  });
});

describe("normalizeReadPath", () => {
  const story = `${ARTICLE_PATH_PREFIX}council-vote`;

  it("keeps the paths the beacon may report", () => {
    assert.equal(normalizeReadPath("/"), "/");
    assert.equal(normalizeReadPath(story), story);
    for (const path of READ_STANDING_PATHS) {
      assert.equal(normalizeReadPath(path), path, `${path} is a standing page`);
    }
  });

  it("drops the query string and the fragment -- a search page's ?q= is a person's", () => {
    assert.equal(normalizeReadPath(`${story}?utm_source=newsletter#top`), story);
    assert.equal(normalizeReadPath(`${story}?ref=abc`), story);
    assert.equal(normalizeReadPath("/?q=rates"), "/");
  });

  it("accepts a full URL and keeps only its path", () => {
    assert.equal(normalizeReadPath(`https://smallpaper.example${story}?x=1`), story);
  });

  it("folds every captured-version page into one bucket", () => {
    assert.equal(normalizeReadPath("/evidence"), "/evidence");
    assert.equal(normalizeReadPath("/evidence/17"), "/evidence");
    assert.equal(normalizeReadPath("/evidence/compare?left=1&right=2"), "/evidence");
  });

  it("ignores a trailing slash", () => {
    assert.equal(normalizeReadPath("/about/"), "/about");
    assert.equal(normalizeReadPath(`${story}/`), story);
  });

  it("refuses a path outside the allowlist, so a crafted request cannot mint a row", () => {
    assert.equal(normalizeReadPath("/admin"), null);
    assert.equal(normalizeReadPath("/articles"), null);
    assert.equal(normalizeReadPath("/articles/a/b"), null);
    assert.equal(normalizeReadPath("//evil.example/x"), null);
    assert.equal(normalizeReadPath("about"), null);
    assert.equal(normalizeReadPath(""), null);
    assert.equal(normalizeReadPath(null), null);
    assert.equal(normalizeReadPath({ toString: () => "/" }), null);
  });
});

describe("storySlugFromPath / isArticlePath", () => {
  it("reads a slug out of an article path and nothing else", () => {
    assert.equal(storySlugFromPath(`${ARTICLE_PATH_PREFIX}council-vote`), "council-vote");
    assert.equal(storySlugFromPath("/"), null);
    assert.equal(storySlugFromPath("/evidence"), null);
    assert.equal(storySlugFromPath(`${ARTICLE_PATH_PREFIX}`), null);
    assert.equal(isArticlePath(`${ARTICLE_PATH_PREFIX}council-vote`), true);
    assert.equal(isArticlePath("/"), false);
  });
});

describe("depthBucketsReached", () => {
  it("reports each bucket once, at the moment it is newly reached", () => {
    assert.deepEqual(depthBucketsReached(10), []);
    assert.deepEqual(depthBucketsReached(25), [25]);
    assert.deepEqual(depthBucketsReached(25.5), [25]);
    assert.deepEqual(depthBucketsReached(76), [25, 50, 75]);
    assert.deepEqual(depthBucketsReached(100), [25, 50, 75, 100]);
    assert.deepEqual(depthBucketsReached(120), [25, 50, 75, 100], "past the end is still the end");
  });

  it("does not re-report a bucket already sent for this load", () => {
    assert.deepEqual(depthBucketsReached(60, [25]), [50]);
    assert.deepEqual(depthBucketsReached(100, READ_DEPTH_BUCKETS), []);
  });

  it("ignores a depth it cannot believe", () => {
    assert.deepEqual(depthBucketsReached(Number.NaN), []);
    assert.deepEqual(
      depthBucketsReached(Number.POSITIVE_INFINITY),
      [],
      "not a number the browser measured, so nothing is reported",
    );
  });
});

describe("clampReadSeconds", () => {
  it("keeps whole seconds and refuses nonsense", () => {
    assert.equal(clampReadSeconds(42), 42);
    assert.equal(clampReadSeconds(42.9), 42);
    assert.equal(clampReadSeconds(0), 0);
    assert.equal(clampReadSeconds(-5), 0);
    assert.equal(clampReadSeconds("600"), 0);
    assert.equal(clampReadSeconds(Number.NaN), 0);
    assert.equal(clampReadSeconds(null), 0);
  });

  it("clamps a forgotten tab instead of dropping the load", () => {
    assert.equal(clampReadSeconds(MAX_READ_SECONDS + 1), MAX_READ_SECONDS);
    assert.equal(clampReadSeconds(60 * 60 * 24), MAX_READ_SECONDS);
  });
});

describe("the two thresholds the page prints", () => {
  it("leaves the 'left without reading' line at ten seconds", () => {
    assert.equal(LEFT_WITHOUT_READING_SECONDS, 10);
  });

  it("draws four read-through buckets, in order", () => {
    assert.deepEqual([...READ_DEPTH_BUCKETS], [25, 50, 75, 100]);
  });
});

describe("label coverage", () => {
  it("has exactly one label per referrer class, and no strays", () => {
    assert.deepEqual(Object.keys(READ_REF_CLASS_LABELS).sort(), [...READ_REF_CLASSES].sort());
    for (const refClass of READ_REF_CLASSES) assert.ok(READ_REF_CLASS_LABELS[refClass].length > 0);
  });

  it("has exactly one label per trust signal, and the beacon's four are a subset of them", () => {
    assert.deepEqual(Object.keys(TRUST_EVENT_LABELS).sort(), [...TRUST_EVENTS].sort());
    for (const event of BEACON_TRUST_EVENTS) {
      assert.ok((TRUST_EVENTS as readonly string[]).includes(event), `${event} is not a known signal`);
    }
    assert.equal(new Set(TRUST_EVENTS).size, TRUST_EVENTS.length);
  });

  it("names every standing page the live panel can hold", () => {
    for (const path of READ_STANDING_PATHS) {
      assert.ok(READ_PATH_LABELS[path], `${path} needs a name for "Reading right now"`);
    }
  });

  it("spells a story path out when there is no headline to use", () => {
    assert.equal(readPathFallbackLabel(`${ARTICLE_PATH_PREFIX}council-vote`), "council vote");
    assert.equal(readPathFallbackLabel("/unknown"), "/unknown");
  });
});

describe("the numbers the page prints", () => {
  it("prints a reading time as m:ss", () => {
    assert.equal(formatClock(0), "0:00");
    assert.equal(formatClock(9), "0:09");
    assert.equal(formatClock(176), "2:56");
    assert.equal(formatClock(3600), "60:00");
    assert.equal(formatClock(-4), "0:00");
    assert.equal(formatClock(Number.NaN), "0:00");
  });

  it("prints a total as minutes below an hour and hours above it", () => {
    assert.equal(formatHours(0), "0 min");
    assert.equal(formatHours(59), "1 min");
    assert.equal(formatHours(3599), "60 min");
    assert.equal(formatHours(3600), "1 hrs");
    assert.equal(formatHours(295 * 3600), "295 hrs");
  });

  it("prints a count with a thousands separator", () => {
    assert.equal(formatCount(0), "0");
    assert.equal(formatCount(1000), "1,000");
    assert.equal(formatCount(9842.4), "9,842");
  });

  it("prints an age the way the drawing does", () => {
    assert.equal(readAgeLabel(0), "today");
    assert.equal(readAgeLabel(1), "1 day");
    assert.equal(readAgeLabel(4), "4 days");
    assert.equal(readAgeLabel(Number.NaN), "today");
  });
});
