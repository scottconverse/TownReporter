export const PDF_READ_CHUNK_CHARACTERS = 40_000;
export const PDF_READ_MAX_OFFSET = 2_147_483_647;

export function characterLength(text: string): number {
  return Array.from(text).length;
}

export function pdfReadMarker(read: number, total: number): string | null {
  const shown = Math.max(0, Math.trunc(read));
  const all = Math.max(shown, Math.trunc(total));
  return shown < all
    ? `Read ${shown.toLocaleString("en-US")} of ${all.toLocaleString("en-US")} characters`
    : null;
}

function readErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "Unknown document read error";
}

export function documentReadFailureReason(_error: unknown): string {
  return "the saved copy could not be opened";
}

export function logDocumentReadFailure(error: unknown): void {
  console.error("[document reader] Could not read this document:", readErrorText(error));
}

export function pdfTextPreview(text: string, totalCharacters = characterLength(text)) {
  const characters = Array.from(text);
  const preview = characters.slice(0, PDF_READ_CHUNK_CHARACTERS).join("");
  const charactersRead =
    characters.length > PDF_READ_CHUNK_CHARACTERS ? PDF_READ_CHUNK_CHARACTERS : characters.length;
  const total = Math.max(charactersRead, Math.trunc(totalCharacters));
  return {
    text: preview,
    charactersRead,
    totalCharacters: total,
    truncationMarker: pdfReadMarker(charactersRead, total),
  };
}
