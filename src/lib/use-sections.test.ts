import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicSectionsSeed, usePublicSections, type PublicSection } from "./use-sections.ts";

/*
  README 5.6: the live front page printed stored keys such as
  "arts-culture" and "public-safety" as kickers in its server HTML. The route
  loader reads the real names and seeds the same query every reader component
  uses, so this renders the seed path with no browser hydration.
*/
describe("server-rendered public sections", () => {
  it("uses the section name from loader-seeded data, not its key", () => {
    const sections: PublicSection[] = [
      {
        key: "arts-culture",
        name: "Arts & Culture",
        visible: true,
        replacementKey: null,
      },
    ];

    function Kicker() {
      const publicSections = usePublicSections();
      return createElement("span", { className: "frontkicker" }, publicSections.sections[0]?.name);
    }

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          PublicSectionsSeed,
          { sections, children: createElement(Kicker) },
        ),
      ),
    );

    assert.match(html, /Arts &amp; Culture/);
    assert.doesNotMatch(html, /arts-culture/);
  });
});
