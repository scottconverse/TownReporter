/** Whether this is Google's OpenAI-compatible Gemini endpoint. */
export function isGeminiOpenAiEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === "generativelanguage.googleapis.com" &&
      url.pathname.replace(/\/+$/, "") === "/v1beta/openai"
    );
  } catch {
    return false;
  }
}

/** Normalize provider-specific model resource names at an OpenAI boundary. */
export function normalizeProviderModelId(baseUrl: string, id: string): string {
  return isGeminiOpenAiEndpoint(baseUrl) && id.startsWith("models/")
    ? id.slice("models/".length)
    : id;
}
