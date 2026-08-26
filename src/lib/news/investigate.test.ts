import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { heuristicPlan } from "./extract.ts";
import { assertHttpUrl } from "./fetch-url.ts";

const TRAIL: Record<string, { text: string; hits?: { title: string; url: string; snippet: string }[] }> = {
  seed: {
    text: "City Council packet awards a contract to Front Range Municipal Solutions LLC.",
  },
  "Front Range Municipal Solutions LLC": {
    text: "Principal and registered agent: Jane Smith, 400 Coffman Street.",
    hits: [
      {
        title: "FRMS filing",
        url: "https://www.sos.state.co.us/biz/frms",
        snippet: "Jane Smith registered agent",
      },
    ],
  },
  "Jane Smith": {
    text: "Jane Smith is registered agent for Peak Range Holdings LLC.",
    hits: [
      {
        title: "Agent record",
        url: "https://www.sos.state.co.us/biz/jane-smith",
        snippet: "Peak Range Holdings LLC",
      },
    ],
  },
  "Peak Range Holdings LLC": {
    text: "Peak Range Holdings LLC owns parcel 1313200001 at 500 Main Street, Longmont.",
    hits: [
      {
        title: "Assessor",
        url: "https://maps.bouldercounty.org/parcel/1313200001",
        snippet: "500 Main Street",
      },
    ],
  },
  "1313200001": {
    text: "Planning case PLN-2024-18 for 500 Main Street. Applicant Peak Range Holdings LLC.",
    hits: [
      {
        title: "Planning case",
        url: "https://www.longmontcolorado.gov/planning/PLN-2024-18",
        snippet: "PLN-2024-18",
      },
    ],
  },
  "PLN-2024-18": {
    text: "Campaign contribution $1,500 from Peak Range Holdings LLC to a council candidate dated 12 days before the vote.",
    hits: [
      {
        title: "TRACE",
        url: "https://tracer.sos.colorado.gov/peak-range",
        snippet: "contribution",
      },
    ],
  },
};

function pickDoc(query: string) {
  for (const [key, val] of Object.entries(TRAIL)) {
    if (key !== "seed" && query.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return null;
}

describe("recursive discovery", () => {
  it("follows a company → agent → second company → parcel → planning case chain off the watch list", async () => {
    const watch = new Set(["https://www.longmontcolorado.gov/agenda"]);
    let text = TRAIL.seed!.text;
    const discovered: string[] = [];
    const tried = new Set<string>();

    for (let hop = 0; hop < 5; hop++) {
      const plan = heuristicPlan(text, tried);
      const queries = plan.searches.filter((q) => !tried.has(q)).slice(0, 3);
      assert.ok(queries.length > 0, `hop ${hop + 1} should search`);
      for (const q of queries) {
        tried.add(q);
        const doc = pickDoc(q);
        if (!doc?.hits) continue;
        for (const hit of doc.hits) {
          assert.equal(watch.has(hit.url), false, "discovered URL must not be on the watch list");
          discovered.push(hit.url);
          text += `\n${doc.text}\n${hit.url}`;
        }
      }
    }

    assert.ok(discovered.length >= 5, `expected 5 hops of new URLs, got ${discovered.length}: ${discovered.join(", ")}`);
    assert.ok(discovered.some((u) => u.includes("sos.state.co.us")));
    assert.ok(discovered.some((u) => u.includes("parcel") || u.includes("planning") || u.includes("tracer")));
    const uniqueHosts = new Set(discovered.map((u) => new URL(u).host));
    assert.ok(uniqueHosts.size >= 3);
  });
});

describe("public URL gate", () => {
  it("keeps off-list public URLs and drops SSRF", () => {
    const keep = [
      "https://www.sos.state.co.us/biz/frms",
      "https://evil.example/doc.pdf",
      "https://www.longmontcolorado.gov/agenda.pdf",
    ];
    for (const u of keep) assert.equal(assertHttpUrl(u).toString(), new URL(u).toString());
    assert.throws(() => assertHttpUrl("http://127.0.0.1/secret"));
    assert.throws(() => assertHttpUrl("http://169.254.169.254/latest/meta-data/"));
    assert.throws(() => assertHttpUrl("javascript:alert(1)"));
    assert.throws(() => assertHttpUrl("file:///etc/passwd"));
  });
});
