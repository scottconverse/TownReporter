import type { RoutineExtractionResult } from "./routine-notice-extract.ts";
import type { PdfPage } from "./ingest.ts";
import {
  validateRoutineNotice,
  type RoutineField,
  type UnverifiedRoutineNoticeProvenance,
} from "./routine-notice-types.ts";

const SPORTS_BROCHURE_PATH = "/wp-content/uploads/2026/07/f26_sports.pdf";
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

export function isLongmontSportsBrochure(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return (
      (url.hostname === "longmontcolorado.gov" || url.hostname === "www.longmontcolorado.gov") &&
      url.pathname === SPORTS_BROCHURE_PATH
    );
  } catch {
    return false;
  }
}

function field(value: string, locator: string): RoutineField {
  return { value, locator };
}

function dateValue(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function extractLongmontSportsRegistrationDeadlines(
  input: { pages: PdfPage[] },
  provenance: Omit<UnverifiedRoutineNoticeProvenance, "externalId">,
): RoutineExtractionResult[] {
  if (!isLongmontSportsBrochure(provenance.sourceUrl)) return [];
  const results: RoutineExtractionResult[] = [];
  for (let index = 0; index < input.pages.length; index += 1) {
    const page = input.pages[index]!;
    const text = page.text.replace(/\s+/g, " ").trim();
    const yearMatch = /\bFall\s+(\d{4})\b/i.exec(text);
    if (!yearMatch) continue;
    const match =
      /\bYouth Basketball League\s*:\s*(Grades\s+3-12)\b[\s\S]*?\bRegistration deadline\s*(?:is|:)\s*([A-Za-z]{3,9})\.?\s+(\d{1,2})\b/i.exec(
        text,
      );
    if (!match) continue;
    const month = MONTHS.get(match[2]!.slice(0, 3).toLowerCase());
    const day = Number(match[3]);
    if (!month || !Number.isInteger(day) || day < 1 || day > 31) continue;
    const registration = /(?:https?:\/\/)?(?:www\.)?bit\.ly\/[A-Za-z0-9_-]+/i.exec(text);
    if (!registration) continue;
    const registrationUrl = registration[0]!.startsWith("http")
      ? registration[0]!
      : `https://${registration[0]!}`;
    const pageNumber = page.page ?? index + 1;
    const locator = `page[${pageNumber}]`;
    const deadlineLocator = `${locator}: Registration deadline`;
    const validation = validateRoutineNotice({
      formatKey: "registration-deadline",
      variant: "deadline",
      provenance: {
        ...provenance,
        externalId: `${provenance.sourceUrl}#${pageNumber}:youth-basketball-league`,
      },
      fields: {
        issuer: field("City of Longmont", `${locator}: Fall ${yearMatch[1]}`),
        program: field("Youth Basketball League", `${locator}: Youth Basketball League`),
        eligibility: field(match[1]!, `${locator}: ${match[1]}`),
        deadline: field(dateValue(Number(yearMatch[1]), month, day), deadlineLocator),
        registrationUrl: field(registrationUrl, `${locator}: ${registration[0]}`),
      },
    });
    results.push(
      validation.valid
        ? { status: "parsed", locator, validation }
        : { status: "refused", code: "structurally-invalid", locator, validation },
    );
  }
  return results;
}
