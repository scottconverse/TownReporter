import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LINKED_SOURCES_PER_DAY,
  MAX_REGISTRY_SOURCES_TOTAL,
  REGISTRY_REREAD_INTERVAL_MS,
  isOfficialDomain,
  isRedirectorUrl,
  isSocialUrl,
  registryRereadDue,
  sameSite,
  selectLinkedRegistrySources,
} from "./registry-auto-grow.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-20T12:00:00Z");

test("a registry source is due its weekly re-read after seven days, or if never read", () => {
  assert.equal(REGISTRY_REREAD_INTERVAL_MS, 7 * DAY);
  assert.equal(registryRereadDue(null, NOW), true);
  assert.equal(registryRereadDue(undefined, NOW), true);
  assert.equal(registryRereadDue("not-a-date", NOW), true);
  assert.equal(registryRereadDue(new Date(NOW - 6 * DAY), NOW), false);
  assert.equal(registryRereadDue(new Date(NOW - 7 * DAY).toISOString(), NOW), true);
  assert.equal(registryRereadDue(new Date(NOW - 30 * DAY), NOW), true);
});

test("same-site means one host is the other or a subdomain", () => {
  assert.equal(sameSite("https://www.example.org/a", "https://example.org/list"), true);
  assert.equal(sameSite("https://help.example.org/a", "https://example.org/list"), true);
  assert.equal(sameSite("https://other.org/a", "https://example.org/list"), false);
});

test("official domains are government, education, military and nonprofit public service", () => {
  assert.equal(isOfficialDomain("https://longmontcolorado.gov/x"), true);
  assert.equal(isOfficialDomain("https://ci.longmont.co.us/x"), true);
  assert.equal(isOfficialDomain("https://ourschool.edu/x"), true);
  assert.equal(isOfficialDomain("https://ourcenter.org/x"), true);
  assert.equal(isOfficialDomain("https://random-blog.example/x"), false);
});

test("search results, redirectors and social media are never registry sources", () => {
  assert.equal(isRedirectorUrl("https://bit.ly/abc"), true);
  assert.equal(isRedirectorUrl("https://example.org/redirect?to=x"), true);
  assert.equal(isRedirectorUrl("https://example.org/page"), false);
  assert.equal(isSocialUrl("https://www.facebook.com/ourcenter"), true);
  assert.equal(isSocialUrl("https://www.ourcenter.org/"), false);
});

function page(pageUrl: string, ...urls: string[]) {
  return { pageUrl, links: urls.map((url) => ({ url, title: "" })) };
}

test("a directory page's own pages and official domains are kept, and nothing else", () => {
  const selected = selectLinkedRegistrySources({
    pages: [
      page(
        "https://longmontcolorado.gov/resources",
        "https://longmontcolorado.gov/resources/food",
        "https://www.ourcenter.org/referral-program/",
        "https://www.facebook.com/ourcenter",
        "https://bit.ly/food",
        "https://www.google.com/search?q=food",
        "https://random-blog.example/post",
        "https://longmontcolorado.gov/resources",
      ),
    ],
    existingIdentities: new Set(),
    dailyRemaining: MAX_LINKED_SOURCES_PER_DAY,
    totalRemaining: MAX_REGISTRY_SOURCES_TOTAL,
  });

  assert.deepEqual(
    selected.map((row) => row.url),
    [
      "https://longmontcolorado.gov/resources/food",
      "https://www.ourcenter.org/referral-program/",
    ],
  );
  assert.equal(selected[0]!.registryRole, "service", "a same-site page is a service feed");
  assert.equal(selected[1]!.registryRole, "organization", "an official external page is an organization feed");
});

test("an existing source and a repeat link are added once, never twice", () => {
  const selected = selectLinkedRegistrySources({
    pages: [
      page(
        "https://longmontcolorado.gov/resources",
        "https://www.ourcenter.org/",
        "https://www.ourcenter.org/",
        "https://www.211colorado.org/",
      ),
    ],
    // `http://www.` and `https://` are the same page.
    existingIdentities: new Set(["211colorado.org"]),
    dailyRemaining: 25,
    totalRemaining: 2000,
  });
  assert.deepEqual(selected.map((row) => row.url), ["https://www.ourcenter.org/"]);
});

test("the daily and total caps bound how many links are followed", () => {
  const links = Array.from({ length: 40 }, (_, index) => `https://www.org${index}.org/`);
  const daily = selectLinkedRegistrySources({
    pages: [page("https://longmontcolorado.gov/resources", ...links)],
    existingIdentities: new Set(),
    dailyRemaining: 3,
    totalRemaining: 2000,
  });
  assert.equal(daily.length, 3, "no more than the day's remaining allowance");

  const total = selectLinkedRegistrySources({
    pages: [page("https://longmontcolorado.gov/resources", ...links)],
    existingIdentities: new Set(),
    dailyRemaining: 25,
    totalRemaining: 2,
  });
  assert.equal(total.length, 2, "no more than the registry's remaining room");
});
