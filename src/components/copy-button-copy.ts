/*
  Pure wording for CopyButton (copy-button.tsx), split into a plain .ts file
  on purpose: this repo's unit suite runs `node --experimental-strip-types
  --test` over every src test file (scripts/run-tests-safe.mjs), which
  strips TS types only -- it does not transform JSX, so a .test.ts file cannot
  import anything from a .tsx module. Keeping the testable logic here, with
  no JSX in this file, is what lets copy-button.test.ts exercise it directly
  instead of needing the render-harness workaround scripts/*-render.test.mjs
  uses elsewhere (see desk-text-size-render.test.mjs's docstring: "this
  repo's test toolchain has no jsdom to mount a real, interactive DOM and
  click through it").
*/

export const COPY_IDLE_LABEL = "Copy";
export const COPY_DONE_LABEL = "Copied";
export const COPY_FAILURE_MESSAGE = "Could not copy. Select the text and copy it by hand.";
export const COPIED_LABEL_MS = 2000;

/** The button's own label given whether the last click landed. */
export function copyButtonLabel(justCopied: boolean): string {
  return justCopied ? COPY_DONE_LABEL : COPY_IDLE_LABEL;
}
