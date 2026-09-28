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
  assert.deepEqual(JSON.parse(result.provenance_json!),result.provenance);
  assert.deepEqual(JSON.parse(result.found_note!),JSON.parse(JSON.stringify(result.findings)));
  assert.doesNotMatch(JSON.stringify(result),/private\.example|Private finding/);
});

test("an explicit empty citation list exposes no stored editor evidence", () => {
  const result=publicArticle(article({source_urls:"[]"}));
  assert.deepEqual(result.provenance,[]);
  assert.deepEqual(result.findings,[]);
  assert.equal(result.provenance_json,"[]");
  assert.equal(result.found_note,"[]");
});

/*
  A record the report NAMED and did not link.

  A pasted report cites "September 22 budget packet (Attachment G)" the way an
  editor writes in their notes -- by naming it. There is no URL to fetch and
  none is invented (`provenanceFromCitations`), so the row has an empty `url`
  and the story's `source_urls` is legitimately empty for it. The public
  filter matched stored rows against `source_urls`, so an empty string could
  never match anything and every named record was dropped: the reader got
  "No separate public source records are attached to this story" on a story
  that cited three documents, while `ProvenanceBlock`'s own branch for a row
  with no page to open was unreachable code.
*/
test("a record the report named but did not link reaches the reader", () => {
  const cited = {
    url:"",
    title:"September 22 budget packet (Attachment G)",
    organization:"",
    document_date:"",
    captured_at:null,
    version_id:null,
    version_count:null,
    capture_event_id:null,
    disappeared:false,
    role:"cited",
  };
  const result=publicArticle(article({source_urls:"[]",provenance_json:JSON.stringify([cited])}));
  assert.deepEqual(result.provenance,[cited]);
  assert.deepEqual(JSON.parse(result.provenance_json!),result.provenance);
});

test("a named record rides beside the linked ones, and neither hides the other", () => {
  const cited = {
    url:"",
    title:"September 22 budget packet (Attachment G)",
    organization:"",
    document_date:"",
    captured_at:null,
    version_id:null,
    version_count:null,
    capture_event_id:null,
    disappeared:false,
    role:"cited",
  };
  const linked = {url:"https://public.example/record",version_id:11,capture_event_id:21,role:"record"};
  const result=publicArticle(article({
    provenance_json:JSON.stringify([linked,cited,{url:"https://private.example/corroboration",version_id:12,capture_event_id:22,role:"corroboration"}]),
  }));
  assert.deepEqual(result.provenance,[linked,cited]);
  assert.doesNotMatch(JSON.stringify(result),/private\.example/);
});
