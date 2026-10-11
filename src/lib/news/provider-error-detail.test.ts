import { it } from "node:test";
import assert from "node:assert/strict";
import { providerErrorDetail, providerResponseDetail, providerHttpError } from "./provider-error-detail.ts";
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

it("preserves Google's overload message from array, object, and plain-text responses", async () => {
  const message = "The model is overloaded. Please try again later.";
  const error = { code: 503, message, status: "UNAVAILABLE" };
  for (const body of [JSON.stringify([{ error }]), JSON.stringify({ error }), message]) {
    assert.equal(await providerResponseDetail(new Response(body, { status: 503 })), message);
    assert.equal(providerHttpError("Gemini (gemini-3.5-flash)", 503, body), `Gemini (gemini-3.5-flash): Google says: ${message} (503)`);
  }
});

it("uses Google's status word when its message is missing or blank and redacts array details", () => {
  for (const message of [undefined, "", "  "]) {
    for (const body of [{ error: { code: 503, message, status: "UNAVAILABLE" } }, [{ error: { code: 503, message, status: "UNAVAILABLE" } }]]) {
      assert.equal(providerErrorDetail(body), "UNAVAILABLE");
      assert.equal(providerHttpError("Gemini", 503, body), "Gemini: Google says: UNAVAILABLE (503)");
    }
  }
  assert.equal(providerErrorDetail([{ error: { message: "Overloaded for test-key" } }], "test-key"), "Overloaded for [redacted]");
  assert.equal(providerErrorDetail([{ error: { status: "test-key" } }], "test-key"), "[redacted]");
  assert.equal(providerErrorDetail([]), "");
});
