import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const capturePath = new URL("./meeting-capture-ytdlp.ts", import.meta.url);
const pipelinePath = new URL("./meeting-capture.ts", import.meta.url);

describe("N-5 duration cap", () => {
  it("refuses a meeting longer than the cap with a stated reason", async () => {
    const { checkDurationCap, DEFAULT_CAPTURE_CAPS } = await import("./meeting-capture-caps.ts");
    const r = checkDurationCap(30000, DEFAULT_CAPTURE_CAPS); // 8h20m > 8h
    assert.equal(r.refused, true);
    assert.match(r.reason, /duration/i);
    assert.match(r.reason, /exceeds the duration cap/i);
  });
  it("allows a meeting within the cap", async () => {
    const { checkDurationCap, DEFAULT_CAPTURE_CAPS } = await import("./meeting-capture-caps.ts");
    assert.equal(checkDurationCap(24071, DEFAULT_CAPTURE_CAPS).refused, false);
  });
});

describe("N-5 size cap", () => {
  it("refuses a file larger than the cap with a stated reason", async () => {
    const { checkSizeCap, DEFAULT_CAPTURE_CAPS } = await import("./meeting-capture-caps.ts");
    const r = checkSizeCap(266021584 * 3, DEFAULT_CAPTURE_CAPS);
    assert.equal(r.refused, true);
    assert.match(r.reason, /size cap/i);
  });
  it("allows a file within the cap", async () => {
    const { checkSizeCap, DEFAULT_CAPTURE_CAPS } = await import("./meeting-capture-caps.ts");
    assert.equal(checkSizeCap(266021584, DEFAULT_CAPTURE_CAPS).refused, false);
  });
});

describe("N-5 defaults + settings source", () => {
  it("states defensible defaults (8h, 500 MB)", async () => {
    const { DEFAULT_CAPTURE_CAPS } = await import("./meeting-capture-caps.ts");
    assert.equal(DEFAULT_CAPTURE_CAPS.durationCapSeconds, 28800);
    assert.equal(DEFAULT_CAPTURE_CAPS.sizeCapBytes, 524288000);
  });
  it("capsFromSettings falls back to the defaults when unset", async () => {
    const { capsFromSettings, DEFAULT_CAPTURE_CAPS } = await import("./meeting-capture-caps.ts");
    assert.deepEqual(capsFromSettings(undefined), DEFAULT_CAPTURE_CAPS);
    assert.deepEqual(capsFromSettings({ duration_cap_seconds: 3600, size_cap_bytes: 1000 }), { durationCapSeconds: 3600, sizeCapBytes: 1000 });
  });
});

describe("N-5 Stop and progress", () => {
  it("the capture runner accepts an abort signal and a progress callback", () => {
    const src = readFileSync(capturePath, "utf8");
    assert.match(src, /signal\?: AbortSignal/);
    assert.match(src, /onProgress\?: \(bytes: number\) => void/);
    assert.match(src, /child\.kill\("SIGKILL"\)/);
    assert.match(src, /stopped: true/);
  });
  it("the pipeline enforces both caps and records the refusal", () => {
    const src = readFileSync(pipelinePath, "utf8");
    assert.match(src, /checkDurationCap/);
    assert.match(src, /checkSizeCap/);
    assert.match(src, /recordCaptureRefusal/);
    assert.match(src, /refused_reason/);
  });
});

describe("N-5 migration 0076", () => {
  it("adds the cap columns + refusal reason additively", () => {
    const sql = readFileSync(new URL("../../../migrations/0076_capture_bounding.sql", import.meta.url), "utf8");
    assert.match(sql, /add column if not exists duration_cap_seconds/i);
    assert.match(sql, /add column if not exists size_cap_bytes/i);
    assert.match(sql, /add column if not exists refused_reason/i);
  });
});
