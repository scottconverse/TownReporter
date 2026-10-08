// guards: a failed source read could tell the editor that no relevant document exists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { parseHTML } from "linkedom";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { newPullReceipt, runPullPipeline, markPulledTodo } from "../src/lib/news/pull.server.ts";
import { emptyNotes } from "../src/lib/news/notes.ts";
import { pullTodoReason } from "../src/lib/news/pull-outcome.ts";
import { pullFailureCopy } from "../src/lib/news/desk-copy.ts";

test("Pull opens a follow-up URL and shows its failed read on the line", async () => {
  const source = await readFile(
    new URL("../src/routes/desk.story.$leadId.tsx", import.meta.url),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "row.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const row = tree.statements.find(
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === "TodoRow",
  );
  const output = ts
    .transpileModule(
      `export ${row.getText(tree)}\nconst usePaperDateFormatters = () => ({ clockTime: () => "" });`,
      {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
      },
    )
    .outputText.replaceAll(
      '"react/jsx-runtime"',
      JSON.stringify(import.meta.resolve("react/jsx-runtime")),
    );
  const { TodoRow } = await import(
    `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
  );
  const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
  const prior = {
    window: globalThis.window,
    document: globalThis.document,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(globalThis, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(window.document.getElementById("root"));
  let notes = {
    ...emptyNotes(),
    todo: [{ t: "Read https://records.example.org/packet", done: false, src: "you" }],
  };
  let pending;
  const props = () => ({
    item: notes.todo[0],
    disabled: false,
    starting: false,
    onToggle() {},
    onStop() {},
    onContinue() {},
    onPull() {
      pending = (async () => {
        const receipt = newPullReceipt({ leadId: 468, todoIndex: 0, query: notes.todo[0].t });
        receipt.checkpoint = {
          city: "Longmont",
          state: "Colorado",
          subjects: [],
          queries: [],
          queryIndex: 0,
          hits: [],
          storyUrls: [],
          indexPagesPrepared: true,
          indexPages: [],
          indexPageIndex: 0,
          indexedUrls: [],
          rankedPrepared: true,
          rankedUrls: [],
          documentIndex: 0,
          documents: [],
        };
        const final = await runPullPipeline(receipt, {
          search: async () => assert.fail("a URL line must open its address instead of searching"),
          ingest: async (url) => {
            assert.equal(url, "https://records.example.org/packet");
            throw new Error("timeout");
          },
          saveReceipt: async () => {},
          saveDocument: async () => {},
          stopRequested: async () => false,
        });
        assert.equal(final.status, "failed");
        notes = markPulledTodo(notes, 0, {
          documentFound: false,
          reason: pullTodoReason({
            status: final.status,
            failures: [],
            answered: false,
            failureReason: pullFailureCopy(
              final.readFailures?.[0]?.reason,
              final.readFailures?.[0]?.url,
            ),
          }),
        });
        root.render(createElement(TodoRow, props()));
      })();
    },
  });
  try {
    await act(async () => root.render(createElement(TodoRow, props())));
    await act(async () => {
      window.document.querySelector(".todo-pull").click();
      await pending;
    });
    const reason = window.document.querySelector(".todo-q").textContent;
    assert.match(reason, /Could not open .*records.*\(timeout\)/i);
    assert.equal(notes.todo[0].done, false);
  } finally {
    await act(async () => root.unmount());
    Object.assign(globalThis, prior);
  }
});
