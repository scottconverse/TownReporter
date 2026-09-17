const fs = require("fs");
let s = fs.readFileSync("src/lib/news/provider-login.test.ts", "utf8");
const anchor = '  it("only knows two providers", () => {';
const i = s.indexOf(anchor);
if (i < 0) { console.error("anchor missing"); process.exit(1); }
const block = [
"  it(\"a successful signed-in probe supersedes an older failed-login record\", async () => {",
"    const dir = mkdtempSync(join(tmpdir(), 'tr-supersede-'));",
"    const sql = await getSql();",
"    await ensureProviderLoginsSchema();",
"    const inserted = await sql.query<{ id: number }>(",
"      \"insert into provider_logins (newsroom_id, provider, status, detail, finished_at) values ($1, $2, 'failed', 'Error loading configuration: failed to parse model_catalog_json', now()) returning id\",",
"      [NEWSROOM, \"claude\"],",
"    );",
"    const failedId = inserted[0]!.id;",
"",
"    // The fake CLI reports signed in, so the status read supersedes the failure.",
"    const restore = withEnv({",
"      CLAUDE_CLI_PATH: FAKE_CLAUDE,",
"      FAKE_CLAUDE_SIGNED_IN: \"1\",",
"    });",
"    const { resetClaudeCliCache, probeClaudeCode } = await import(\"./ai-claude-code.server.ts\");",
"    resetClaudeCliCache();",
"    try {",
"      assert.equal((await probeClaudeCode()).ok, true);",
"      const statuses = await providerStatuses(NEWSROOM);",
"      const claude = statuses.find((s) => s.provider === \"claude\");",
"      assert.ok(claude?.signedIn, \"the probe says signed in\");",
"",
"      // A resolved failure is history: the row stays reviewable, never deleted.",
"      const row = await getProviderLogin(failedId, NEWSROOM);",
"      assert.equal(row?.status, \"done\");",
"      assert.equal(row?.detail, \"\");",
"      const rows = await sql.query<{ id: number }>(",
"        \"select id from provider_logins where id = $1\",",
"        [failedId],",
"      );",
"      assert.equal(rows.length, 1);",
"    } finally {",
"      restore();",
"      resetClaudeCliCache();",
"    }",
"  });",
""].join("\n");
s = s.slice(0, i) + block + s.slice(i);
fs.writeFileSync("src/lib/news/provider-login.test.ts", s);
console.log("test inserted");
