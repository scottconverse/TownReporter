import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  SUBSCRIBE_GLOBAL_HOURLY,
  SUBSCRIBE_PER_EMAIL_HOURLY,
  subscribeEmail,
} from "./public.ts";
import { slugify } from "../paper.ts";

/** Call the server fn the way the front page does. */
async function subscribe(email: string) {
  return subscribeEmail(email);
}

/**
 * Bare `node --test` has no Vite, so `import.meta.glob` never applies
 * `migrations/*.sql` (see src/lib/db.ts). Create the one table this path needs.
 */
async function freshTables() {
  const sql = await getSql();
  await sql.query(`
    create table if not exists subscribers (
      id serial primary key,
      email text not null unique,
      created_at timestamptz not null default now()
    )
  `);
  await sql.query(`
    create table if not exists newsletter_attempts (
      id serial primary key,
      email_key text not null,
      created_at timestamptz not null default now()
    )
  `);
  await sql`delete from newsletter_attempts`;
}

describe("newsletter signup", () => {
  it("rejects an address that is not one", async () => {
    await freshTables();
    const res = await subscribe("not-an-email");
    assert.equal(res.ok, false);
  });

  it("returns the same shape for a new address and an existing one", async () => {
    await freshTables();
    const email = `dup-${Date.now()}@example.com`;

    const first = await subscribe(email);
    assert.equal(first.ok, true);
    assert.ok(first.confirmPath, "a new subscriber gets a confirm link");

    const second = await subscribe(email);
    assert.equal(second.ok, true);
    assert.ok(
      second.confirmPath,
      "an existing subscriber must ALSO get a link — returning null told the " +
        "caller this address was already confirmed, which enumerated the list",
    );
    assert.notEqual(
      first.confirmPath,
      second.confirmPath,
      "a fresh token each time, so the responses are not distinguishable by reuse",
    );
  });

  it("rate limits repeats of an address that already exists", async () => {
    await freshTables();
    const email = `repeat-${Date.now()}@example.com`;
    let blockedAt = -1;
    for (let i = 0; i < SUBSCRIBE_PER_EMAIL_HOURLY + 3; i += 1) {
      const res = await subscribe(email);
      if (!res.ok) {
        blockedAt = i;
        break;
      }
    }
    // The old code counted `subscribers` rows. A repeat took the UPDATE branch,
    // wrote no row, and was never counted — so this loop ran forever.
    assert.notEqual(blockedAt, -1, "a repeated address must eventually be refused");
    assert.ok(
      blockedAt <= SUBSCRIBE_PER_EMAIL_HOURLY + 1,
      `expected a block by attempt ${SUBSCRIBE_PER_EMAIL_HOURLY + 1}, got ${blockedAt}`,
    );
  });

  it("one address burning its own limit does not lock out everybody else", async () => {
    await freshTables();
    const noisy = `noisy-${Date.now()}@example.com`;
    for (let i = 0; i < SUBSCRIBE_PER_EMAIL_HOURLY + 2; i += 1) await subscribe(noisy);

    const bystander = await subscribe(`bystander-${Date.now()}@example.com`);
    assert.equal(
      bystander.ok,
      true,
      "the global cap used to be 40 site-wide, so a handful of throwaway " +
        "signups took the form down for every real visitor",
    );
  });

  it("keeps a global backstop well above any real signup rate", () => {
    assert.ok(SUBSCRIBE_GLOBAL_HOURLY > SUBSCRIBE_PER_EMAIL_HOURLY * 10);
  });
});

describe("slugify", () => {
  it("never ends in a separator after the length cut", () => {
    // 72 chars lands mid-space here, which used to leave a trailing dash in the
    // public URL.
    const headline = "a".repeat(71) + " " + "b".repeat(20);
    const slug = slugify(headline);
    assert.ok(slug.length <= 72);
    assert.doesNotMatch(slug, /-$/, `got "${slug}"`);
  });

  it("never starts with a separator", () => {
    assert.doesNotMatch(slugify("   — Council votes"), /^-/);
  });

  it("falls back to a usable slug for a headline with no latin characters", () => {
    assert.equal(slugify("———"), "item");
  });
});
