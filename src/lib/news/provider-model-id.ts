/** Normalize provider-specific model resource names at an OpenAI boundary. */
export function normalizeProviderModelId(baseUrl: string, id: string): string {
  try {
    const url = new URL(baseUrl);
    const isGeminiOpenAiEndpoint =
      url.protocol === "https:" &&
      url.hostname === "generativelanguage.googleapis.com" &&
      url.pathname.replace(/\/+$/, "") === "/v1beta/openai";
    return isGeminiOpenAiEndpoint && id.startsWith("models/")
      ? id.slice("models/".length)
      : id;
  } catch {
    return id;
  }
}
