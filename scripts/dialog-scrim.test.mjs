// guards: scrolling or an incomplete scrim gesture dismisses an editor's open work.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, stubUrl } from "./dom-harness.mjs";

test("only a complete scrim press closes work, ignoring the scrollbar region", async () => {
  const { document } = installDom();
  document.documentElement.style.getPropertyPriority = () => "";
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { DialogScrim } = await import(
    await moduleUrl("src/components/dialog.tsx", {
      "./desk-chrome": stubUrl("export const InkButton = () => null;"),
    })
  );
  const root = createRoot(document.getElementById("root"));
  let closes = 0;
  try {
    await React.act(() =>
      root.render(React.createElement(DialogScrim, { onClose: () => closes++ })),
    );
    const scrim = document.querySelector("button");
    const props = scrim[Object.keys(scrim).find((key) => key.startsWith("__reactProps$"))];
    for (const [node, width] of [
      [document.documentElement, 800],
      [scrim, 780],
    ]) {
      Object.defineProperties(node, {
        clientWidth: { value: width },
        clientHeight: { value: 600 },
        clientLeft: { value: 0 },
        clientTop: { value: 0 },
      });
    }
    scrim.getBoundingClientRect = () => ({ left: 0, top: 0 });
    document.elementFromPoint = () => scrim;
    const event = (x) => ({
      currentTarget: scrim,
      target: scrim,
      button: 0,
      pointerId: 1,
      clientX: x,
      clientY: 20,
    });
    props.onPointerDown(event(790));
    props.onPointerUp(event(790));
    assert.equal(closes, 0);
    props.onPointerUp(event(20));
    assert.equal(closes, 0);
    props.onPointerDown(event(20));
    assert.equal(closes, 0);
    props.onPointerUp(event(790));
    assert.equal(closes, 0);
    props.onPointerDown(event(20));
    props.onPointerUp(event(20));
    assert.equal(closes, 1);
  } finally {
    await React.act(() => root.unmount());
  }
});
