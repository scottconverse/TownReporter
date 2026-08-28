import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FACTORY_RESET_MARKER,
  FINGERPRINT_SLUGS,
  WIPE_TABLES,
  maybeFactoryReset,
  quoteIdent,
  shouldFactoryReset,
} from "./factory-reset.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("factory reset is not a SQL migration (self-hosters would inherit a landmine)", () => {
  const names = readdirSync(join(ROOT, "migrations")).filter((n) => n.endsWith(".sql"));
  assert.equal(
    names.some((n) => /reset|wipe|truncate/i.test(n)),
    false,
  );
  assert.equal(FACTORY_RESET_MARKER.endsWith(".sql"), false);
});

test("factory reset is not a public HTTP route", () => {
  assert.equal(existsSync(join(ROOT, "src/routes/api/ops.reset.ts")), false);
  assert.equal(existsSync(join(ROOT, "src/routes/api/reset.ts")), false);
  const cron = readFileSync(join(ROOT, "src/routes/api/cron.monitors.ts"), "utf8");
  assert.doesNotMatch(cron, /TRUNCATE|factory reset|delete from articles/i);
});

test("fingerprint is the populated grok.me paper, not a fresh box", () => {
  assert.ok(FINGERPRINT_SLUGS.includes("longmont-church-commits-40-000-toward-san-lazaro-park-resident-purchase"));
  assert.ok(FINGERPRINT_SLUGS.includes("council-books-six-hour-airport-vision-session-sept-26-at-375-airport-roa"));
  assert.equal(
    FINGERPRINT_SLUGS.includes("welcome-to-townreporter"),
    false,
    "welcome exists on every fresh box — must not be the fingerprint",
  );
});

test("shouldFactoryReset requires both slugs and a missing marker", () => {
  const both = [...FINGERPRINT_SLUGS];
  assert.equal(shouldFactoryReset({ applied: [], presentSlugs: both }), true);
  assert.equal(
    shouldFactoryReset({ applied: [FACTORY_RESET_MARKER], presentSlugs: both }),
    false,
  );
  assert.equal(shouldFactoryReset({ applied: [], presentSlugs: [both[0]] }), false);
  assert.equal(shouldFactoryReset({ applied: [], presentSlugs: [] }), false);
  assert.equal(shouldFactoryReset({ applied: [], presentSlugs: ["welcome-to-townreporter"] }), false);
});

test("wipe list clears paper, desk, members, and auth — not schema bookkeeping", () => {
  for (const t of ["articles", "leads", "newsroom_members", "user", "session", "desk_jobs", "investigations"]) {
    assert.ok(WIPE_TABLES.includes(t), t);
  }
  assert.equal(WIPE_TABLES.includes("_migrations"), false);
  assert.equal(WIPE_TABLES.includes("newsrooms"), false);
});

test("quoteIdent wraps reserved Better Auth table names", () => {
  assert.equal(quoteIdent("user"), `"user"`);
  assert.equal(quoteIdent("articles"), `"articles"`);
});

test("maybeFactoryReset truncates then records the marker when fingerprint hits", async () => {
  /** @type {string[]} */
  const sql = [];
  const client = {
    async query(text, params) {
      sql.push(text);
      if (/pg_tables/.test(text)) {
        return {
          rows: [
            ...WIPE_TABLES.map((tablename) => ({ tablename })),
            { tablename: "newsrooms" },
            { tablename: "articles" },
          ],
        };
      }
      if (/SELECT slug FROM articles/.test(text)) {
        return { rows: FINGERPRINT_SLUGS.map((slug) => ({ slug })) };
      }
      return { rows: [] };
    },
  };
  const ran = await maybeFactoryReset(client, []);
  assert.equal(ran, true);
  assert.ok(sql.some((s) => /^TRUNCATE TABLE/i.test(s)));
  assert.ok(sql.some((s) => /INSERT INTO articles/.test(s)));
  assert.ok(sql.some((s) => /INSERT INTO _migrations/.test(s)));
  const trunc = sql.find((s) => /^TRUNCATE TABLE/i.test(s)) ?? "";
  assert.match(trunc, /"articles"/);
  assert.match(trunc, /"user"/);
  assert.doesNotMatch(trunc, /"_migrations"/);
});

test("maybeFactoryReset is a no-op when the marker is already recorded", async () => {
  let queries = 0;
  const client = {
    async query() {
      queries += 1;
      return { rows: [] };
    },
  };
  const ran = await maybeFactoryReset(client, [FACTORY_RESET_MARKER]);
  assert.equal(ran, false);
  assert.equal(queries, 0);
});

test("maybeFactoryReset is a no-op without the fingerprint stories", async () => {
  const client = {
    async query(text) {
      if (/pg_tables/.test(text)) return { rows: [{ tablename: "articles" }] };
      if (/SELECT slug FROM articles/.test(text)) {
        return { rows: [{ slug: "welcome-to-townreporter" }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const ran = await maybeFactoryReset(client, []);
  assert.equal(ran, false);
});

test("migrate.mjs calls the factory reset after SQL files", () => {
  const src = readFileSync(join(ROOT, "scripts/migrate.mjs"), "utf8");
  assert.match(src, /maybeFactoryReset/);
  assert.match(src, /from "\.\/factory-reset\.mjs"/);
});
