import { createElement } from "react";

/**
 * The publish warnings for an opinion piece, with ONE "Publish anyway" press.
 *
 * TJA-4: that press lists every warning above it, and `onPublishAnyway` receives
 * the key of every one of them, so a single press records each override the
 * editor accepted. The confirm words name the claims acceptance when a claims
 * warning is listed.
 *
 * Plain `createElement`, not JSX, so the node test runner can load it.
 */
export function OpinionPublishWarnings({
  warnings,
  busy,
  onPublishAnyway,
}: {
  warnings: { key: string; sentence: string }[];
  busy: boolean;
  onPublishAnyway: (acknowledgedWarningKeys: string[]) => void;
}) {
  /* DHG-2: the claims warning's confirm uses the Story page's own words. */
  const claimsWarning = warnings.some((warning) => warning.key === "editorial-sources");
  const confirmWords = claimsWarning ? "Publish anyway — I accept these claims are unreviewed" : "Publish anyway";
  return createElement(
    "div",
    { className: "mt-3 border border-rule bg-paper-2 p-4", role: "alert" },
    warnings.map((warning) =>
      createElement("p", { key: warning.key, className: "text-sm text-ink" }, warning.sentence),
    ),
    createElement(
      "div",
      { className: "mt-3" },
      createElement(
        "button",
        {
          type: "button",
          className: "btn",
          disabled: busy,
          onClick: () => onPublishAnyway(warnings.map((warning) => warning.key)),
        },
        busy ? "Publishing…" : confirmWords,
      ),
    ),
  );
}
