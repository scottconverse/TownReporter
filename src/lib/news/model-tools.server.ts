import { spawn } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";

const definitions = [
  [
    "web_search",
    "Search the web using the desk's search providers.",
    { query: { type: "string" } },
  ],
  ["fetch_page", "Read text from a web page.", { url: { type: "string" } }],
  ["read_file", "Read a UTF-8 file at the supplied path.", { path: { type: "string" } }],
  [
    "write_file",
    "Write UTF-8 content to the supplied file path.",
    { path: { type: "string" }, content: { type: "string" } },
  ],
  ["list_dir", "List entries in the supplied directory.", { path: { type: "string" } }],
  [
    "run_command",
    "Execute a shell command as the signed-in user.",
    { command: { type: "string" } },
  ],
] as const;

export const modelTools = definitions.map(([name, description, properties]) => ({
  name,
  description,
  input_schema: { type: "object" as const, properties, required: Object.keys(properties) },
}));
export const openAiModelTools = modelTools.map(({ name, description, input_schema }) => ({
  type: "function",
  function: { name, description, parameters: input_schema },
}));

/** Only explicit rejection of the tool surface permits a tools-free retry. */
export function rejectsTools(status: number | undefined, detail: string): boolean {
  return (
    [400, 404, 422, 501].includes(status ?? 0) &&
    (/(?:tools?|tool_choice|function calling)["'`]?(?:\s+\w+){0,5}\s+(?:not supported|unsupported|not allowed|not available|disabled)/i.test(
      detail,
    ) ||
      /(?:does not support|doesn't support|unsupported)\s+(?:(?:the|parameter|field|argument|function)\s+)*["'`]*(?:tools?\b|tool_choice\b|function calling)/i.test(
        detail,
      ) ||
      /(?:unknown|unrecognized|unexpected|not permitted)\s+(?:request\s+)?(?:(?:parameter|field|argument)\s*)?(?:supplied\s*)?[:"'`\s]*(?:tools?\b|tool_choice\b)/i.test(
        detail,
      ) ||
      /unsupported\s+(?:parameter|field|argument)\s*:\s*["']?(?:tools?\b|tool_choice\b)/i.test(
        detail,
      ))
  );
}

/** Includes response bodies, imports and tools in the transport's one deadline. */
export async function withinDeadline<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export async function executeModelTool(
  name: string,
  input: unknown,
  signal: AbortSignal,
): Promise<string> {
  return withinDeadline(signal, async () => {
    try {
      const args = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
      if (!args || typeof args !== "object") throw new Error("Tool input must be an object");
      const value = (key: string): string => {
        const v = (args as Record<string, unknown>)[key];
        if (typeof v !== "string") throw new Error(`Missing string argument: ${key}`);
        return v;
      };
      let result: unknown;
      switch (name) {
        case "web_search": {
          const { searchWithFallback } = await import("./search-web.ts");
          signal.throwIfAborted();
          result = await searchWithFallback(
            value("query"),
            undefined,
            undefined,
            undefined,
            signal,
          );
          break;
        }
        case "fetch_page": {
          const { fetchSourceText } = await import("./fetch-url.ts");
          signal.throwIfAborted();
          result = await fetchSourceText(value("url"), signal);
          break;
        }
        case "read_file":
          result = await readFile(value("path"), "utf8");
          break;
        case "write_file":
          await writeFile(value("path"), value("content"), "utf8");
          result = { written: true };
          break;
        case "list_dir":
          result = await readdir(value("path"));
          break;
        case "run_command": {
          result = await new Promise((resolve, reject) => {
            // Streaming collection avoids buffered execution's default output-size budget.
            const child = spawn(value("command"), { shell: true, signal, windowsHide: true });
            let stdout = "";
            let stderr = "";
            child.stdout?.setEncoding("utf8");
            child.stderr?.setEncoding("utf8");
            child.stdout?.on("data", (chunk: string) => {
              stdout += chunk;
            });
            child.stderr?.on("data", (chunk: string) => {
              stderr += chunk;
            });
            child.once("error", reject);
            child.once("close", (code, killedBy) =>
              resolve({ stdout, stderr, code, signal: killedBy }),
            );
          });
          break;
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return JSON.stringify(result);
    } catch (error) {
      signal.throwIfAborted();
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
