import { parseHTML } from "linkedom";
import type { RoutineExtractionResult } from "./routine-notice-extract.ts";
import {
  validateRoutineNotice,
  type RoutineField,
  type UnverifiedRoutineNoticeProvenance,
} from "./routine-notice-types.ts";

const LONGMONT_PATH =
  "/waste-services-trash-recycling-composting/special-services-events/fall-leaf-collection/";
const MONTHS = new Map([
  ["jan", 1],
  ["feb", 2],
  ["mar", 3],
  ["apr", 4],
  ["may", 5],
  ["jun", 6],
  ["jul", 7],
  ["aug", 8],
  ["sep", 9],
  ["oct", 10],
  ["nov", 11],
  ["dec", 12],
]);

function field(value: string, locator: string): RoutineField {
  return { value, locator };
}

function allowedSource(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return (
      (url.hostname === "longmontcolorado.gov" || url.hostname === "www.longmontcolorado.gov") &&
      url.pathname.replace(/\/+$/, "/") === LONGMONT_PATH
    );
  } catch {
    return false;
  }
}

function dateValue(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function extractLongmontLeafCollection(
  html: string,
  context: {
    provenance: Omit<UnverifiedRoutineNoticeProvenance, "externalId">;
    issuer: string;
  },
): RoutineExtractionResult[] {
  if (!allowedSource(context.provenance.sourceUrl)) return [];
  const { document } = parseHTML(html);
  const contentAreas = [...document.querySelectorAll(".content_area")];
  const results: RoutineExtractionResult[] = [];
  for (let areaIndex = 0; areaIndex < contentAreas.length; areaIndex += 1) {
    const area = contentAreas[areaIndex];
    const areaLocator = `.content_area[${areaIndex}]`;
    const scheduleHeading = [...area.querySelectorAll("h1,h2,h3,h4,h5,h6")].find((heading) =>
      /\b(\d{4})\s+Collection\s+Schedule\b/i.test(heading.textContent ?? ""),
    );
    const yearMatch = scheduleHeading
      ? /\b(\d{4})\s+Collection\s+Schedule\b/i.exec(scheduleHeading.textContent ?? "")
      : null;
    if (!yearMatch) continue;
    const year = Number(yearMatch[1]);
    const instructions = [...area.querySelectorAll("li")]
      .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim())
      .find((value) => /bags must be out before/i.test(value));
    const listItems = [...area.querySelectorAll("li")];
    for (let itemIndex = 0; itemIndex < listItems.length; itemIndex += 1) {
      const item = listItems[itemIndex];
      const itemText = (item.textContent ?? "").replace(/\s+/g, " ").trim();
      const match = /residences located\s+(North|South) of 9th Avenue\s+([A-Za-z]{3})\.?\s+(\d{1,2})\s*[–—-]\s*(?:(?:([A-Za-z]{3})\.?)\s+)?(\d{1,2})/i.exec(
        itemText,
      );
      if (!match) continue;
      const startMonth = MONTHS.get(match[2].slice(0, 3).toLowerCase());
      const endMonth = MONTHS.get((match[4] ?? match[2]).slice(0, 3).toLowerCase());
      if (!startMonth || !endMonth) continue;
      const locator = `${areaLocator} li[${itemIndex}]`;
      const fields = {
        issuer: field(context.issuer, "OWNER_ISSUER"),
        service: field("Fall leaf collection", `${locator}.service`),
        area: field(`${match[1]} of 9th Avenue`, locator),
        serviceDate: field(dateValue(year, startMonth, Number(match[3])), locator),
        endDate: field(dateValue(year, endMonth, Number(match[5])), locator),
        ...(instructions ? { collectionInstructions: field(instructions, `${areaLocator} li[${listItems.findIndex((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim() === instructions)}]`) } : {}),
      };
      const validation = validateRoutineNotice({
        formatKey: "waste-recycling-schedule",
        variant: "regular",
        provenance: { ...context.provenance, externalId: `longmont-leaf-${year}-${match[1].toLowerCase()}` },
        fields,
      });
      results.push(
        validation.valid
          ? { status: "parsed", locator, validation }
          : { status: "refused", code: "structurally-invalid", locator, validation },
      );
    }
  }
  return results;
}
