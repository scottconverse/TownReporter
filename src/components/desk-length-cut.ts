import { createElement } from "react";
import { readSuppliedMaterialCut } from "../lib/news/supplied-material-cap.ts";

/**
 * What the editor is told when their pasted material was cut for length.
 *
 * Unit B8P. The cut happens before the model call (see
 * `./lib/news/supplied-material-cap.ts`, and `suppliedMaterialHeading` in
 * `./lib/news/editorial.ts` for what the model is told), and the counts are
 * stored WITH the piece in `drafts.research_json`, so this reads them off the
 * stored draft rather than off a job's memory: it is still there after a
 * reload, and it is still there next week.
 *
 * `role="status"`, matching `DeskNameCheck` -- the other note that lives in the
 * same blob and is read the same way.
 *
 * Renders NOTHING when nothing was cut, and nothing when the stored record is
 * malformed or describes no real cut (`readSuppliedMaterialCut` refuses both),
 * so a piece that was sent whole can never be shown a "the rest was cut"
 * sentence.
 *
 * Written without JSX, the way `CheckGates` is, so `node --experimental-strip-types`
 * can load it in the test beside it.
 */
export function DeskLengthCut({ research }: { research: string | null | undefined }) {
  const cut = readSuppliedMaterialCut(research);
  if (!cut) return null;
  return createElement(
    "p",
    { role: "status", className: "rounded-lg border border-rule bg-paper-2 p-3 text-sm" },
    cut.note,
  );
}
