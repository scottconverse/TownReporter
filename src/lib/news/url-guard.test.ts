import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sourceIdentity } from "./url-guard.ts";

describe("sourceIdentity", () => {
  it("keeps different PrimeGov compiled packets distinct by meetingTemplateId", () => {
    const octoberPacket = sourceIdentity(
      "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=17302&compileOutputType=1",
    );
    const novemberPacket = sourceIdentity(
      "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=17363&compileOutputType=1",
    );

    assert.equal(
      octoberPacket,
      "longmont.primegov.com/public/compileddocument?meetingTemplateId=17302",
    );
    assert.notEqual(octoberPacket, novemberPacket);
  });

  it("normalizes PrimeGov parameter order and tracking variants for the same packet", () => {
    const canonical = sourceIdentity(
      "https://longmont.primegov.com/Public/CompiledDocument?meetingTemplateId=17302&compileOutputType=1",
    );
    const reorderedTracked = sourceIdentity(
      "http://www.longmont.primegov.com/Public/CompiledDocument?utm_source=reader&compileOutputType=9&meetingTemplateId=17302&utm_medium=email#packet",
    );

    assert.equal(reorderedTracked, canonical);
  });

  it("preserves host-and-path identity for ordinary URLs and other PrimeGov pages", () => {
    const ordinary = sourceIdentity("https://www.example.org/council/packets/?page=1");
    assert.equal(sourceIdentity("http://example.org/council/packets?page=2&utm_source=x"), ordinary);

    const meetingPage = sourceIdentity(
      "https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=17302",
    );
    assert.equal(
      meetingPage,
      sourceIdentity("https://longmont.primegov.com/Portal/Meeting?meetingTemplateId=17363"),
    );
  });
});
