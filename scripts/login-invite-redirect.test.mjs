import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { screenModule } from "./screen-render-harness.mjs";

const screen = await screenModule(
  "src/routes/login.tsx",
  {
    createFileRoute: `() => options => ({...options, useSearch: () => ({invite: globalThis.loginInvite})})`,
    useCurrentUserState: `() => ({user: {id: 'new-editor'}})`,
    useNavigate: `() => () => {}`,
    Navigate: `() => h('span', {'data-redirect': 'desk'})`,
    Link: `({children, ...props}) => h('a', props, children)`,
    inputClass: `'login-input'`,
    inkSolid: `'bg-ink text-paper'`,
    inkGhost: `'text-ink'`,
  },
  ["@/lib/news/desk-copy"],
);

test("a signup session stays on the invite form until the editor is seated", () => {
  globalThis.loginInvite = "fixture-invite";
  globalThis.screenData = {
    "desk-claim": { claimed: true },
    invite: { ok: true, email: "editor@example.test" },
  };
  const html = renderToStaticMarkup(createElement(screen.Route.component));
  assert.doesNotMatch(html, /data-redirect/);
  assert.match(html, /You&#x27;re invited to this desk/);
  assert.match(html, /Create editor account/);
});

test("an ordinary signed-in editor still goes straight to the claimed desk", () => {
  globalThis.loginInvite = undefined;
  globalThis.screenData = { "desk-claim": { claimed: true } };
  assert.match(renderToStaticMarkup(createElement(screen.Route.component)), /data-redirect="desk"/);
});

test("a signed-in first owner still has a form to retry claiming the desk", () => {
  globalThis.loginInvite = undefined;
  globalThis.screenData = { "desk-claim": { claimed: false, tokenRequired: true } };
  const html = renderToStaticMarkup(createElement(screen.Route.component));
  assert.doesNotMatch(html, /data-redirect/);
  assert.match(html, /Setup code/);
});
