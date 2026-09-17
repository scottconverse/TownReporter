import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { assertOwner } from "../news/desk-auth.ts";
import { ForbiddenError } from "../news/membership.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * ENG-01: `getOpsHealth` and `runOpsAction` used to be gated only by
 * `deskMiddleware` (signed-in + newsroom member), with the owner check living
 * solely in `src/routes/desk.ops.tsx`'s React (`isOwner` hiding the panel).
 * Both handlers now call `assertOwner(context.role)` as the first line, the
 * same guard `src/lib/news/provider-login.ts` has used since before this fix
 * (it re-exports the same function, now lifted into `desk-auth.ts`).
 *
 * The runtime, real-editor-session proof of the refusal lives in
 * `src/lib/news/two-editors.e2e.test.ts` (a live cookie against a live built
 * server). This file mirrors `provider-login.test.ts`'s static "every server
 * function here is gated" check, applied to the ops dashboard.
 */
describe("ops dashboard owner-only (ENG-01)", () => {
  it("refuses an invited editor", () => {
    assert.throws(() => assertOwner("editor"), ForbiddenError);
    assert.throws(() => assertOwner("editor"), /Only the owner/);
  });

  it("lets the owner through", () => {
    assert.doesNotThrow(() => assertOwner("owner"));
  });

  it("both ops server functions are gated by deskMiddleware AND assertOwner", () => {
    const src = readFileSync(join(ROOT, "src/lib/ops/dashboard.ts"), "utf8");
    const names = [...src.matchAll(/export const (\w+) = createServerFn/g)].map((m) => m[1]);
    assert.deepEqual(names.sort(), ["getOpsHealth", "runOpsAction"]);
    for (const name of names) {
      const start = src.indexOf(`export const ${name} = createServerFn`);
      const next = names
        .map((n) => src.indexOf(`export const ${n} = createServerFn`))
        .filter((i) => i > start);
      const body = src.slice(start, next.length ? Math.min(...next) : src.length);
      assert.match(body, /\.middleware\(\[deskMiddleware\]\)/, `${name} has no deskMiddleware`);
      assert.match(body, /assertOwner\(context\.role\)/, `${name} has no owner check`);
      // The guard must be the FIRST statement inside `.handler(async (...) => {`,
      // ahead of any allowlist check or import -- an editor must never reach
      // even the id-validation branch, let alone a real action.
      const handlerBody = body.slice(body.indexOf(".handler("));
      const firstStatement = handlerBody
        .slice(handlerBody.indexOf("=> {") + 4)
        .trimStart()
        .split("\n")[0];
      assert.match(
        firstStatement,
        /assertOwner\(context\.role\)/,
        `${name}'s handler must call assertOwner before anything else`,
      );
    }
  });
});
