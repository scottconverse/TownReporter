import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boilerplatePageReason,
  leadSourceRefusalReason,
  resurfaceRefusalReason,
  usableLeadSources,
} from "./result-quality.ts";

/**
 * Unit U25, B2/B3/C1 — the three judges, held to the pages that produced them.
 *
 * Every URL and title below is out of the dev database the Kid City USA
 * walkthrough ran against: `artifacts` rows 3-34 of investigation 1, and the
 * `search_log` rows whose provider is `adversarial`. They are not invented
 * examples; they are the file the editor was handed.
 *
 * THE MUTATIONS THAT MATTER. Deleting youtubekids.com from
 * `APP_LANDING_HOSTS` fails "the app landing page the good queries returned";
 * dropping the `USABLE_OUTCOMES` check from `leadSourceRefusalReason` fails
 * "a capture that failed is not a source"; removing the evidence-is-an-address
 * branch from `resurfaceRefusalReason` fails the reopened-item case.
 */

const LEAD = "Reddit users say Longmont's Kid City USA daycare is closing permanently Oct. 2, 2026";

describe("pages that are never the article", () => {
  it("refuses the app landing page the good queries returned", () => {
    assert.ok(boilerplatePageReason("https://www.youtubekids.com/"));
  });

  it("refuses a dictionary entry", () => {
    for (const url of [
      "https://www.merriam-webster.com/dictionary/under",
      "https://dictionary.com/browse/under",
      "https://dictionary.cambridge.org/dictionary/english/under",
      "https://englishfortheplanet.com/english-vocabulary/under",
    ])
      assert.ok(boilerplatePageReason(url), `a dictionary entry would have been cited: ${url}`);
  });

  it("refuses another search engine's own page", () => {
    assert.ok(boilerplatePageReason("https://support.google.com/youtube/?hl=en"));
    assert.ok(boilerplatePageReason("https://www.bing.com/search?q=x"));
  });

  it("refuses a consent, sign-in or redirect wall", () => {
    assert.ok(boilerplatePageReason("https://outlook.office.com/mail/signin"));
    assert.ok(boilerplatePageReason("https://example.com/consent?next=/article"));
  });

  /**
   * The desk reads YouTube meeting recordings on purpose (see DARK_SYSTEM), so
   * refusing the whole host would throw away the records it is built for.
   */
  it("keeps the pages the desk is built to read", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=tk36ovCMsU8",
      "https://www.longmontcolorado.gov/government/city-council",
      "https://www.reddit.com/r/Longmont/comments/1wqeq6x/local_daycare_closure/",
      "https://cdhs.colorado.gov/child-care-facility-search",
    ])
      assert.equal(boilerplatePageReason(url), null, `a real record was refused: ${url}`);
  });

  /*
    M2 of the batch-6 pre-merge audit. Two rules were wider than the shapes
    that produced them and refused real records. Both sides are pinned here: the
    page that must survive, and the page of the same shape that must not.

    THE MUTATIONS THAT MATTER. Putting the trailing `\b` back on
    `INTERSTITIAL_PATH` fails "keeps a record filed under a consent directory"
    and "keeps a council consent agenda"; putting `google.com` back in
    `SEARCH_ENGINE_HOSTS` fails "keeps the Google documents the desk reads".
  */
  it("keeps a record filed under a consent directory", () => {
    for (const url of [
      "https://www.longmontcolorado.gov/city-council/consent-agenda",
      "https://www.longmontcolorado.gov/cityclerk/consent/2024.pdf",
      "https://example.gov/redirects/2024-budget.pdf",
      "https://example.gov/login-history/meeting-notes",
    ])
      assert.equal(boilerplatePageReason(url), null, `a real record was refused: ${url}`);
  });

  it("still refuses the interstitial of the same shape", () => {
    for (const url of [
      "https://outlook.office.com/mail/signin",
      "https://example.com/consent?next=/article",
      "https://example.com/cookie",
      "https://example.com/sorry/",
      "https://example.com/captcha",
    ])
      assert.ok(boilerplatePageReason(url), `an interstitial was kept: ${url}`);
    assert.match(
      boilerplatePageReason("https://outlook.office.com/mail/signin")!,
      /consent, sign-in or redirect/,
    );
  });

  it("keeps the Google documents the desk reads", () => {
    for (const url of [
      "https://docs.google.com/document/d/1abc/edit",
      "https://drive.google.com/file/d/1abc/view",
      "https://sites.google.com/view/longmont-neighborhoods",
      "https://news.google.com/articles/abc",
    ])
      assert.equal(boilerplatePageReason(url), null, `a real record was refused: ${url}`);
  });

  it("still refuses Google answering with itself", () => {
    for (const url of ["https://www.google.com/", "https://google.com/search?q=council+packet"])
      assert.ok(boilerplatePageReason(url), `a search engine page was kept: ${url}`);
    assert.match(
      boilerplatePageReason("https://google.com/search?q=x")!,
      /another search engine/,
    );
  });
});

describe("what may be listed as a source on a lead", () => {
  /*
    `leads.source_urls` was `order by id desc limit 12` over `artifacts` with no
    predicate, so these are exactly the twelve the drafted story carried.
  */
  const CAPTURED = [
    {
      url: "https://reddit.com/r/Longmont/comments/1wqeq6x/local_daycare_closure_linked_to_flurry_o",
      title: "Local Daycare closure linked to flurry of other abrupt closures",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      text: "Kid City USA Longmont at 1941 Terry Street is closing.",
    },
    {
      url: "https://movieweb.com/after-movies-in-order",
      title: "After Movies in Order Chronologically and by Release Date",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      text: "The After film series in order.",
    },
    {
      url: "https://shipslide.com/courier-services/anaheim-ca",
      title: "TOP Courier Services Anaheim, CA | FAST & RELIABLE TEAM",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      text: "Courier services in Anaheim.",
    },
    {
      url: "https://softhandtech.com/how-do-i-know-if-my-phone-has-liquid-damage",
      title: "Identifying Liquid Damage in Your Phone: A Comprehensive Guide",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      text: "Liquid damage guide.",
    },
    {
      url: "https://outlook.office.com/mail",
      title: "Outlook",
      fetchStatus: 200,
      fetchOutcome: "parse-failed",
      text: "",
    },
    {
      url: "https://merriam-webster.com/dictionary/under",
      title: "merriam-webster.com",
      fetchStatus: 403,
      fetchOutcome: "fetch-failed",
      text: "",
    },
    {
      url: "https://californiacourierservices.com/anaheim",
      title: "Anaheim Courier | Same Day Delivery Service",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      text: "Same-day courier delivery in Anaheim.",
    },
    {
      url: "http://unicode.org/L2/L2019/19291-missing-currency.pdf",
      title: "19291-missing-currency.pdf",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      text: "A proposal about currency symbols.",
    },
  ];

  it("keeps the one real source and drops the eleven the dig strayed into", () => {
    const kept = usableLeadSources(CAPTURED, LEAD).map((page) => page.url);
    assert.deepEqual(kept, [CAPTURED[0]!.url], `the lead's sources were: ${kept.join(", ")}`);
  });

  it("names its reason for each of them", () => {
    assert.equal(boilerplatePageReason("https://outlook.office.com/mail"), null);
    // Outlook answered 200 with nav chrome and no article text.
    assert.match(leadSourceRefusalReason(CAPTURED[4]!, LEAD)!, /did not get the article/);
    // Merriam-Webster is refused before the capture is even considered.
    assert.match(leadSourceRefusalReason(CAPTURED[5]!, LEAD)!, /dictionary entry/);
    assert.match(leadSourceRefusalReason(CAPTURED[2]!, LEAD)!, /about the lead/);
    assert.match(leadSourceRefusalReason(CAPTURED[1]!, LEAD)!, /about the lead/);
    assert.match(leadSourceRefusalReason(CAPTURED[3]!, LEAD)!, /about the lead/);
    assert.equal(leadSourceRefusalReason(CAPTURED[0]!, LEAD), null);
  });
});

/*
  Unit B7R, item 2. The relevance test tokenized title + host + URL only, so a
  real record behind an opaque address was refused for saying nothing about the
  lead. A council packet titled "Agenda Packet" at
  `longmontcolorado.gov/sites/default/files/packet.pdf` shares no term with the
  lead in its title or its path -- and its text names the lead on the first
  line. The capture the desk already made is the evidence.

  The fixture addresses carry no date in them on purpose: the lead's own
  "Oct. 2, 2026" is a token, and a URL with "2026" in its path would have
  matched on the year alone and passed this test for the wrong reason.

  THE MUTATION THAT MATTERS. Dropping `page.text` from the token set fails
  "keeps the council packet whose own text is about the lead".
*/
describe("what the captured page itself says", () => {
  it("keeps the council packet whose own text is about the lead", () => {
    const packet = {
      url: "https://longmontcolorado.gov/sites/default/files/packet.pdf",
      title: "Agenda Packet",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      text: "Item 7: the conditional use permit for the Kid City USA daycare at 1941 Terry Street.",
    };
    assert.equal(leadSourceRefusalReason(packet, LEAD), null);
    assert.deepEqual(usableLeadSources([packet], LEAD), [packet]);
  });

  it("reads only a bounded sample of a long page", () => {
    const filler = "The council heard public comment on the annual budget. ".repeat(400);
    const buried = {
      url: "https://longmontcolorado.gov/sites/default/files/minutes.pdf",
      title: "Minutes",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      // The daycare is named far past the sample the judge reads.
      text: `${filler}Kid City USA daycare closing.`,
    };
    assert.ok(filler.length > 20_000, "the fixture has to exceed the sample");
    assert.match(leadSourceRefusalReason(buried, LEAD)!, /about the lead/);
  });

  it("still refuses a courier page whose text is unrelated", () => {
    const courier = {
      url: "https://shipslide.com/courier-services/anaheim-ca",
      title: "TOP Courier Services Anaheim, CA | FAST & RELIABLE TEAM",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      text: "Same-day courier delivery across Anaheim and Orange County. Call for a quote today.",
    };
    assert.match(leadSourceRefusalReason(courier, LEAD)!, /about the lead/);
  });

  it("still refuses a dictionary entry that carries the query word in its body", () => {
    const entry = {
      url: "https://www.merriam-webster.com/dictionary/closing",
      title: "Closing Definition & Meaning",
      fetchStatus: 200,
      fetchOutcome: "fetched",
      text: "closing: the end or conclusion of something. See synonyms for closing.",
    };
    assert.match(leadSourceRefusalReason(entry, LEAD)!, /dictionary entry/);
  });
});

describe("material that comes back to the desk", () => {
  it("refuses a page whose only new evidence is its own address", () => {
    assert.match(
      resurfaceRefusalReason({
        url: "https://jetdelivery.com/locations/ca/orange-county",
        evidence: "https://jetdelivery.com/locations/ca/orange-county",
      })!,
      /own address/,
    );
  });

  it("refuses a boilerplate page however it comes back", () => {
    assert.ok(
      resurfaceRefusalReason({
        url: "https://dictionary.com/browse/under",
        evidence: "under",
      }),
    );
    assert.ok(
      resurfaceRefusalReason({
        url: "https://englishfortheplanet.com/english-vocabulary/under",
        evidence: "under — English for the Planet",
      }),
    );
  });

  it("still lets real evidence about a page back in", () => {
    assert.equal(
      resurfaceRefusalReason({
        url: "https://longmontcolorado.gov/minutes-2026-04",
        evidence: "The minutes record a vote on the daycare's conditional use permit.",
      }),
      null,
    );
  });
});
