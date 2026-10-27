/**
 * The line the desk prints when a model server did not answer.
 *
 * `connectionError` (ai.ts) writes "<label> is unreachable. Check that it is
 * running and that this machine is online." and appends the thrown cause in
 * parentheses. That sentence is stored and reprinted as-is on the job card and
 * the Models page chip, where "unreachable" reads as a verdict about the model
 * rather than a report about one failed call. The screen says it plainly
 * instead, and keeps the cause behind a technical-detail disclosure.
 *
 * The label is whatever stands between the previous trail hop (or the start of
 * the text) and the sentence, so a failover note's " -> <next model>" tail and
 * its arrows survive untouched. Nothing else in the text is rewritten, except
 * that a raw host:port is replaced by the server's plain name
 * (`hideServerAddresses`) and "No model is loaded" gets its next step.
 */
import { withLocalModelNextStep } from "./desk-local-model.ts";

const SERVER_BY_PORT: Record<string, string> = {
  "1234": "LM Studio",
  "11434": "Ollama",
  "8080": "llama.cpp",
};

/** host:port, with or without a scheme and path: 127.0.0.1:1299, http://localhost:1234/v1 */
const HOST_AND_PORT =
  /(?:https?:\/\/)?(?:\d{1,3}(?:\.\d{1,3}){3}|localhost|\[[0-9a-f:]+\]|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}):(\d{2,5})(?!\w)(?:\/[^\s)"';,]*)?/gi;

/**
 * Editors never read a raw address. The server's plain name stands in where
 * the port says which server it is ("LM Studio", "Ollama"); any other address
 * becomes "the model server". Display only: the stored error keeps the address.
 */
export function hideServerAddresses(text: string): string {
  return text.replace(HOST_AND_PORT, (_whole, port: string) => SERVER_BY_PORT[port] ?? "the model server");
}

const UNREACHABLE =
  /(^|-> |→ |\n)([^\n]+?) is unreachable\. Check that it is running and that this machine is online\.(?: \(([^)]*)\))?/g;

export function plainServerWords(text: string): { text: string; detail: string | null } {
  let detail: string | null = null;
  const plain = text.replace(UNREACHABLE, (_whole, lead: string, label: string, cause: string | undefined) => {
    if (detail === null && cause) detail = cause;
    return `${lead}${label}: the model server did not answer. Check that it is running and that this machine is online.`;
  });
  return {
    text: withLocalModelNextStep(hideServerAddresses(plain)),
    detail: detail === null ? null : hideServerAddresses(detail),
  };
}
