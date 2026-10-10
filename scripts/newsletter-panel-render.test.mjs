import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/*
  The two newsletter surfaces, rendered from the REAL components.

  NewsletterMailbox (src/components/newsletter-mailbox.tsx) and SourceNewsletter
  (src/components/source-newsletter.tsx) are the whole of this feature: the
  paper's mailbox card and the per-source sender/signup row. Both are `.tsx`
  with hooks, so the only honest way to check them without a browser is to
  transpile the real source and render it with react-dom/server -- the same
  stub-everything-but-React pattern as scripts/paper-setup-panel-render.test.mjs
  and scripts/sections-setup-render.test.mjs. No mailbox, no server, no network,
  no database is touched: the two react-query hooks are an in-memory stand-in
  keyed on `queryKey[0]`, handed the shape the server would return.

  What the made-up-element tests in newsletter-mailbox.test.ts could not see,
  and why this file exists: whether the components themselves render the three
  unconfigured sentences, escape a hostile sender/subject/link label, refuse an
  unsafe confirmation URL by drawing no link at all, keep the password box a
  real `type="password"` that is never pre-filled, and gate the "Subscribe the
  paper" control on a usable URL and a paper address.
*/

function moduleUrl(source, fileName, imports = {}) {
  let output = ts.transpileModule(source, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) {
    output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const REACT_URL = import.meta.resolve("react");
const JSX_URL = import.meta.resolve("react/jsx-runtime");
const inlineModule = (source) =>
  `data:text/javascript;base64,${Buffer.from(source.replaceAll('"react"', JSON.stringify(REACT_URL))).toString("base64")}`;

// The real copy module: its exact sentences are half of what is asserted here.
const copyUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/newsletter-copy.ts", import.meta.url), "utf8"),
  "newsletter-copy.ts",
);

// The real desk-chrome-utils, minus the desk-toast import it reaches for.
const utilsUrl = moduleUrl(
  await readFile(new URL("../src/components/desk-chrome-utils.ts", import.meta.url), "utf8"),
  "desk-chrome-utils.ts",
  {
    "@/components/desk-toast": inlineModule(
      "export function deskToast() {}\nexport function deskToastHostMounted() { return false; }",
    ),
  },
);

// Minimal stand-ins for the shell pieces the panels draw through. Nothing under
// test is a stand-in; these are the Field/InkButton/Link/FormError they render.
const deskChromeStub = inlineModule(`
  import { createElement } from "react";
  export const InkButton = ({ children, type, disabled }) =>
    createElement("button", { type: type || "button", disabled: disabled || undefined }, children);
  export const Field = ({ label, hint, htmlFor, children }) =>
    createElement(
      "div",
      null,
      createElement("label", { htmlFor }, label),
      children,
      hint ? createElement("span", null, hint) : null,
    );
`);
const routerStub = inlineModule(`
  import { createElement } from "react";
  export function Link({ to, children, ...rest }) {
    return createElement("a", { href: String(to ?? "#"), ...rest }, children);
  }
`);
const formErrorStub = inlineModule(`
  import { createElement } from "react";
  export const FormError = ({ children }) => createElement("div", { role: "alert" }, children);
`);
// editorActionError: the real one folds a server dump into plain words; here we
// only need it to exist and return a plain sentence for the failure path.
const deskCopyStub = inlineModule(`
  export function editorActionError(raw) {
    return raw && String(raw).trim() ? "The mailbox did not save." : null;
  }
`);

/*
  One in-memory react-query. `scenario` is what the server would have answered
  for each query root; `mutations` reports how a save/test resolved, so the
  Error/disabled paths can be driven without a network.
*/
function buildQueryStub(scenario) {
  return inlineModule(`
    export const __state = ${JSON.stringify(scenario)};
    export function useQuery({ queryKey, enabled }) {
      const root = queryKey[0];
      const entry = __state[root];
      // A disabled query has not run: it hands back no data, like the real one.
      const active = enabled === undefined ? true : !!enabled;
      return {
        data: active && entry ? entry.data : undefined,
        isPending: active ? !!(entry && entry.isPending) : false,
        isError: !!(entry && entry.isError),
        error: null,
        refetch: async () => {},
      };
    }
    export function useQueryClient() {
      return { invalidateQueries: async () => {}, setQueryData: () => {} };
    }
    export function useMutation() {
      return {
        mutate: () => {},
        mutateAsync: async () => {},
        isPending: !!__state.__pending,
        isError: false,
        error: null,
      };
    }
  `);
}

// The server functions the panels import. This static render never invokes
// them -- no click can happen -- so they only have to exist and be shaped right.
const serverStub = inlineModule(`
  export async function getNewsletterMailboxFn() { return null; }
  export async function saveNewsletterMailboxFn() { return { ok: true }; }
  export async function testNewsletterMailboxFn() { return { ok: true, message: "" }; }
  export async function getSourceNewsletterFn() { return null; }
  export async function saveSourceNewsletterFn() { return { ok: true }; }
`);

// react-query is stubbed per scenario, so the component module is re-transpiled
// for each render with that scenario's query stub baked in.
async function renderMailbox(scenario) {
  const mod = await import(
    moduleUrl(
      await readFile(new URL("../src/components/newsletter-mailbox.tsx", import.meta.url), "utf8"),
      "newsletter-mailbox.tsx",
      {
        "@tanstack/react-query": buildQueryStub(scenario),
        "@/components/desk-chrome": deskChromeStub,
        "@/components/form-error": formErrorStub,
        "@/components/desk-chrome-utils": utilsUrl,
        "@/lib/news/desk-copy": deskCopyStub,
        "@/lib/news/newsletters": serverStub,
        "@/lib/news/newsletter-copy": copyUrl,
        react: REACT_URL,
        "react/jsx-runtime": JSX_URL,
      },
    )
  );
  return renderToStaticMarkup(createElement(mod.NewsletterMailbox, {}));
}

/*
  The source row seeds its two boxes from the query in an effect, and
  renderToStaticMarkup never runs effects -- so the "Subscribe the paper"
  control (which reads that seeded URL) is invisible to a server render. To
  check it for real the component is mounted into a linkedom document with
  react-dom/client and `act` flushes the effect. Still no browser, no server,
  no network: only the query stub's data reaches the component.
*/
async function renderSource(scenario, sourceId = 7, { open = true } = {}) {
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const rootEl = window.document.getElementById("root");
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    const mod = await import(
      moduleUrl(
        await readFile(new URL("../src/components/source-newsletter.tsx", import.meta.url), "utf8"),
        "source-newsletter.tsx",
        {
          "@tanstack/react-router": routerStub,
          "@tanstack/react-query": buildQueryStub(scenario),
          "@/components/desk-chrome": deskChromeStub,
          "@/components/desk-chrome-utils": utilsUrl,
          "@/lib/news/newsletters": serverStub,
          "@/lib/news/newsletter-copy": copyUrl,
          react: REACT_URL,
          "react/jsx-runtime": JSX_URL,
        },
      )
    );
    const root = createRoot(rootEl);
    await act(async () => {
      root.render(createElement(mod.SourceNewsletter, { sourceId }));
    });
    // The read is deferred until the section is opened; opening it is a real
    // toggle on the real <details>.
    if (open) {
      await act(async () => {
        const details = rootEl.querySelector("details");
        details.open = true;
        details.dispatchEvent(new window.Event("toggle"));
      });
    }
    const html = rootEl.innerHTML;
    await act(async () => {
      root.unmount();
    });
    return html;
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.IS_REACT_ACT_ENVIRONMENT = previous.IS_REACT_ACT_ENVIRONMENT;
  }
}

const SENTENCES = [
  "Use a mailbox owned by the paper.",
  "Subscribe it to newsletters from your sources.",
  "The desk reads allowed senders every 30 minutes.",
];

test("an unconfigured mailbox explains itself in three plain sentences", async () => {
  const html = await renderMailbox({
    "newsletter-mailbox": {
      data: {
        configured: false,
        address: "",
        host: "imap.hostinger.com",
        port: 993,
        ssl: true,
        hasPassword: false,
        lastPollAt: null,
        ignoredCount: 0,
        lastError: null,
        waiting: [],
      },
    },
  });

  for (const sentence of SENTENCES) {
    assert.match(html, new RegExp(sentence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), sentence);
  }
  // Never the word "error" for a state that is merely unset.
  assert.doesNotMatch(html, /error|failed|invalid|broken/i);
});

test("a configured mailbox lists waiting confirmations, escaping hostile labels", async () => {
  const html = await renderMailbox({
    "newsletter-mailbox": {
      data: {
        configured: true,
        address: "paper@example.org",
        host: "imap.hostinger.com",
        port: 993,
        ssl: true,
        hasPassword: true,
        lastPollAt: "3:12 PM",
        ignoredCount: 12,
        lastError: null,
        waiting: [
          {
            id: 1,
            // A sender and subject a stranger chose: they must arrive as text,
            // never as markup.
            sender: '<img src=x onerror="alert(1)">@evil.example',
            subject: 'Confirm <script>alert("x")</script> & "click"',
            date: "Sep 2",
            links: [
              {
                text: '<b>Click</b> & confirm',
                url: "https://news.example/confirm?token=abc",
              },
              // An unsafe link: no anchor at all, only the safe one is drawn.
              { text: "javascript:", url: "javascript:alert(1)" },
            ],
          },
        ],
      },
    },
  });

  // The safe link is really there, new-tab and noopener.
  assert.match(html, /href="https:\/\/news\.example\/confirm\?token=abc"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  // An unsafe URL renders no anchor: exactly one link in the whole card body.
  const anchors = html.match(/<a\b/g) ?? [];
  assert.equal(anchors.length, 1, "only the safe confirmation link may be an anchor");
  assert.doesNotMatch(html, /javascript:/i);

  // The hostile sender/subject/label are escaped, not executed: the raw tags
  // are gone and their escaped text remains.
  assert.doesNotMatch(html, /<img src=x/i);
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /<b>/i);
  assert.match(html, /&lt;img src=x onerror=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
});

test("the password box is type=password and never carries a stored credential", async () => {
  const SECRET = "hunter2-should-never-render";
  const html = await renderMailbox({
    "newsletter-mailbox": {
      data: {
        configured: true,
        address: "paper@example.org",
        host: "imap.hostinger.com",
        port: 993,
        ssl: true,
        hasPassword: true,
        lastPollAt: "3:12 PM",
        ignoredCount: 0,
        lastError: null,
        waiting: [],
      },
    },
  });

  const passwordBox = html.match(/<input[^>]*id="newsletter-password"[^>]*>/);
  assert.ok(passwordBox, "the password input must render");
  assert.match(passwordBox[0], /type="password"/);
  // The box is blank: the browser must never receive the stored credential.
  assert.match(passwordBox[0], /value=""/);
  assert.doesNotMatch(html, /value="[^"]*password/i);
  assert.doesNotMatch(html, new RegExp(SECRET));
  // The stored state is stated in words, not read back from the box.
  assert.match(html, /A password is stored on the desk\./);
  assert.match(html, /Leaving the box blank keeps the stored password\./);
});

/*
  Source row: the panel renders the input fields always, but "Subscribe the
  paper" is gated. `paperAddress` empty -> tell the editor to set up a mailbox.
  An unsafe signup URL -> no Subscribe control at all.
*/
test("a source with a paper address and a valid signup URL offers Subscribe", async () => {
  const html = await renderSource({
    "source-newsletter": {
      data: {
        newsletterSender: "news@planning.example",
        signupUrl: "https://planning.example/newsletter",
        paperAddress: "paper@example.org",
      },
    },
  });

  assert.match(html, /<summary[^>]*>Newsletter sender and signup<\/summary>/);
  // The Subscribe control, its valid href, and the paper address to subscribe.
  assert.match(html, /Subscribe the paper/);
  assert.match(html, /href="https:\/\/planning\.example\/newsletter"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /paper@example\.org/);
  // No mailbox-missing hint while the mailbox is set.
  assert.doesNotMatch(html, /The paper has no newsletter mailbox yet\./);
});

test("a source row asks the server nothing until its section is opened", async () => {
  const stored = {
    "source-newsletter": {
      data: {
        newsletterSender: "news@planning.example",
        signupUrl: "https://planning.example/newsletter",
        paperAddress: "",
      },
    },
  };
  // Closed: the deferred read has not run, so nothing from the server is in the
  // boxes and the mailbox-missing sentence it would carry is absent.
  const closed = await renderSource(stored, 7, { open: false });
  assert.doesNotMatch(closed, /value="news@planning\.example"/);
  assert.doesNotMatch(closed, /value="https:\/\/planning\.example\/newsletter"/);
  assert.doesNotMatch(closed, /The paper has no newsletter mailbox yet\./);
  // Opened: the same row now reads and shows what is stored.
  const opened = await renderSource(stored, 7);
  assert.match(opened, /value="news@planning\.example"/);
  assert.match(opened, /The paper has no newsletter mailbox yet\./);
});

test("a source with no paper mailbox points to Paper setup and offers no Subscribe", async () => {
  const html = await renderSource({
    "source-newsletter": {
      data: {
        newsletterSender: "news@planning.example",
        signupUrl: "https://planning.example/newsletter",
        paperAddress: "",
      },
    },
  });

  assert.match(html, /The paper has no newsletter mailbox yet\./);
  assert.match(html, /Open Paper setup/);
  assert.doesNotMatch(html, /Subscribe the paper/);
});

test("a source with an unsafe signup URL draws no Subscribe control", async () => {
  const html = await renderSource({
    "source-newsletter": {
      data: {
        newsletterSender: "news@planning.example",
        signupUrl: "javascript:alert(1)",
        paperAddress: "paper@example.org",
      },
    },
  });

  assert.doesNotMatch(html, /Subscribe the paper/);
  // The stored value legitimately sits in the editable box; what must never
  // exist is an anchor that would open it.
  assert.doesNotMatch(html, /<a\b[^>]*href="javascript:/i);
  assert.doesNotMatch(html, /<a\b/);
  // The mailbox is set, so no setup hint either: simply no subscribe surface.
  assert.doesNotMatch(html, /The paper has no newsletter mailbox yet\./);
});
