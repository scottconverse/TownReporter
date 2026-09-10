import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArticleRow } from "./types.ts";
import { publicArticle } from "./public.ts";

function article(overrides: Partial<ArticleRow>): ArticleRow {
  return {
    id: 1,
    user_id: "editor",
    newsroom_id: 1,
    lead_id: 1,
    slug: "public-boundary",
    headline: "Public boundary",
    dek: "",
    body: "Published body",
    topic: "council",
    source_urls: JSON.stringify(["https://public.example/record"]),
    status: "published",
    published_at: "2026-09-09T00:00:00.000Z",
    provenance_json: JSON.stringify([
      {url:"https://public.example/record",version_id:11,capture_event_id:21,role:"record"},
      {url:"https://private.example/corroboration",version_id:12,capture_event_id:22,role:"corroboration"},
    ]),
    form: "reported",
    found_note: JSON.stringify([
      {text:"Public finding",source_urls:["https://public.example/record","https://private.example/corroboration"],artifact_version_ids:[11,12],capture_event_ids:[21,22],locators:["char:1-20"]},
      {text:"Private finding",source_urls:["https://private.example/corroboration"],artifact_version_ids:[12],capture_event_ids:[22]},
    ]),
    unanswered: "[]",
    ...overrides,
  } as ArticleRow;
}

test("public article serialization excludes private provenance and findings from parsed and raw fields", () => {
  const result=publicArticle(article({}));
  assert.deepEqual(result.provenance,[{url:"https://public.example/record",version_id:11,capture_event_id:21,role:"record"}]);
  assert.deepEqual(result.findings,[{text:"Public finding",source_urls:["https://public.example/record"],artifact_version_ids:[11],capture_event_ids:[21],locators:[],excerpt:undefined}]);
  assert.deepEqual(JSON.parse(result.provenance_json),result.provenance);
  assert.deepEqual(JSON.parse(result.found_note),JSON.parse(JSON.stringify(result.findings)));
  assert.doesNotMatch(JSON.stringify(result),/private\.example|Private finding/);
});

test("an explicit empty citation list exposes no stored editor evidence", () => {
  const result=publicArticle(article({source_urls:"[]"}));
  assert.deepEqual(result.provenance,[]);
  assert.deepEqual(result.findings,[]);
  assert.equal(result.provenance_json,"[]");
  assert.equal(result.found_note,"[]");
});
