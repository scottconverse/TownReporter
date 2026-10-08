// guards: unrelated follow-ups could enter the editor's research queue.
import { test } from "node:test";
import assert from "node:assert/strict";
import { gateFrontierRelevance } from "./frontier-relevance.ts";

test("closes off-topic investigation links and accepts a Longmont council link", () => {
  const context = { subject: "City YouTube Sept PrimeGov council meeting", town: "Longmont" };
  const items: Array<{ label: string; why: string; status?: string; closed_reason?: string }> = [
    {
      label: "https://unitedkingdominbusiness.co.uk/Company/2076451/Aggregate-Silverton-Aggregates/Walton-Road-Kirby-Le-Soken-0-CO130D-Frinton-on-Sea-01255851777",
      why: "Attachment/document link on https://unitedkingdominbusiness.co.uk/Company/3128504/Aggregate-Aylett-Gravel-Ltd/Princess-Margaret-Road-East-Tilbury-0-RM188P-Tilbury",
    },
    { label: "http://www.trefoiltechnology.co.uk/rtal/index.html", why: 'Search hit for "rtal" Longmont' },
    {
      label: "https://longmontcolorado.gov/news/",
      why: "City Council meeting agenda for the Sept 1 meeting",
    },
  ];
  const result = items.map((item) => gateFrontierRelevance(item, context));
  assert.deepEqual(result.map((item) => item.status ?? "open"), ["closed", "closed", "open"]);
  assert.equal(result[0]?.closed_reason, "off-topic: no link to the subject or the town");
});
