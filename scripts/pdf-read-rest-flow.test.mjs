import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl } from "./dom-harness.mjs";

const window = installDom();
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { PDF_READ_CHUNK_CHARACTERS, pdfTextPreview } = await import(
  await moduleUrl("src/lib/news/pdf-read.ts")
);
const { ReadMoreText } = await import(
  await moduleUrl("src/components/read-more-text.tsx", {
    "@/lib/news/pdf-read": await moduleUrl("src/lib/news/pdf-read.ts"),
  })
);

// guards: the editor mistakes a partial PDF for the whole document
test("a long PDF shows its cut and appends the next read when pressed", async () => {
  const preview = pdfTextPreview("a".repeat(212_000));
  assert.equal(preview.truncationMarker, "Read 40,000 of 212,000 characters");
  const container = window.document.querySelector("#root");
  const root = createRoot(container);
  let requestedOffset = -1;
  await act(async () =>
    root.render(
      React.createElement(ReadMoreText, {
        text: preview.text,
        totalCharacters: preview.totalCharacters,
        onReadRest: async (offset) => {
          requestedOffset = offset;
          return "b".repeat(PDF_READ_CHUNK_CHARACTERS);
        },
      }),
    ),
  );
  assert.match(container.textContent, /Read 40,000 of 212,000 characters/);
  const button = container.querySelector('button[aria-label="Read the rest"]');
  assert.ok(button, "the next part is available from the reader");
  await act(async () => button.dispatchEvent(new window.Event("click", { bubbles: true })));
  assert.equal(requestedOffset, PDF_READ_CHUNK_CHARACTERS);
  assert.equal(container.querySelector(".read-full").textContent.length, 80_000);
  assert.match(container.textContent, /Read 80,000 of 212,000 characters/);
  await act(async () => root.unmount());
});
