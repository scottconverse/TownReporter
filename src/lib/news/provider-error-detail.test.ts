import { it } from "node:test";
import assert from "node:assert/strict";
import { providerErrorDetail, providerResponseDetail } from "./provider-error-detail.ts";
import { scanPreflight } from "./preflight.ts";

it("keeps an unknown provider's structured and plain-text messages under the guidance", async () => {
  for (const body of [JSON.stringify({ error: { message: "Model gemini-3.5-flash is unavailable for key test-key" } }), "Model gemini-3.5-flash is unavailable for key test-key"]) {
    const detail = await providerResponseDetail(new Response(body, { status: 400 }), "test-key");
    assert.equal(detail, "Model gemini-3.5-flash is unavailable for key [redacted]");
    const preflight = scanPreflight({ ok: false, error: `Custom AI readiness check failed (400).\n\n${detail}` });
    assert.equal(preflight.ok, false);
    if (preflight.ok) continue;
    assert.equal(preflight.kind, "unknown");
    assert.ok(preflight.guidance.indexOf("provider's own message is below") < preflight.guidance.indexOf("Model gemini"));
    assert.doesNotMatch(preflight.guidance, /test-key/);
  }
});

it("limits diagnostic text and never prints an object or the key", () => {
  assert.equal(providerErrorDetail({ error: { code: 400 } }), "");
  assert.equal(providerErrorDetail("key " + "x".repeat(5000), "key").length, 4000);
});
