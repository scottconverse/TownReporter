/** Preserve the provider's message for the desk while removing the key we sent. */
export function providerErrorDetail(body: unknown, apiKey?: string | null): string {
  let message: unknown = body;
  if (body && typeof body === "object") {
    const error = (body as { error?: unknown }).error;
    message = typeof error === "string" ? error
      : error && typeof error === "object" ? (error as { message?: unknown }).message
      : (body as { message?: unknown }).message;
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
