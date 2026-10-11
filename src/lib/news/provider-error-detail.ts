/** Preserve the provider's message for the desk while removing the key we sent. */
export function providerErrorDetail(body: unknown, apiKey?: string | null): string {
  if (Array.isArray(body)) body = body[0];
  let message: unknown = body;
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    const detail = error && typeof error === "object" ? error as { message?: unknown; status?: unknown } : body as { message?: unknown; status?: unknown };
    message = typeof error === "string" ? error
      : typeof detail.message === "string" && detail.message.trim() ? detail.message : detail.status;
  }
  if (typeof message !== "string") return "";
  const redacted = apiKey && apiKey !== "not-needed" ? message.replaceAll(apiKey, "[redacted]") : message;
  return redacted.trim().slice(0, 4000);
}

export async function providerResponseDetail(response: Response, apiKey?: string | null): Promise<string> {
  const text = await response.text().catch(() => "");
  try { return providerErrorDetail(JSON.parse(text), apiKey); }
  catch { return providerErrorDetail(text, apiKey); }
}

/** Short, credential-free words shared by the progress card and switch receipt. */
export function providerHttpError(label: string, status: number, body: unknown, apiKey?: string | null): string {
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* Plain provider text. */ } }
  const detail = providerErrorDetail(body, apiKey).replace(/\s+/g, " ").slice(0, 200);
  const speaker = /gemini|google/i.test(label) ? "Google" : "Provider";
  return `${label.replace(/^Custom provider /, "")}: ${speaker} says: ${detail || "The request failed without an explanatory message."} (${status})`;
}
