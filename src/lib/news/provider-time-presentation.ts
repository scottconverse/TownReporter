export function providerTimePresentation(
  providerId: string,
  label: string,
): { label: string; explanation: string } {
  if (providerId === "local-model") return {
    label: "Model at a configured server",
    explanation: "How long the desk waits for one answer from the server chosen in Models, such as LM Studio, Ollama, or llama.cpp.",
  };
  if (providerId === "qwen-local") return {
    label: "Model already loaded on this computer",
    explanation: "How long the desk waits for one answer from a model already in memory. TownReporter does not load or unload it.",
  };
  return { label, explanation: "How long the desk waits for one answer before giving up. Local models need more." };
}
