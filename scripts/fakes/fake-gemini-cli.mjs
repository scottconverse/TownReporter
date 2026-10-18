import { appendFileSync, readdirSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const NL = String.fromCharCode(10);

function fail(message) {
  process.stderr.write(message + NL);
  process.exit(1);
}

if (argv.length === 1 && argv[0] === "models") {
  // Lets a test count how many listing processes ran.
  if (process.env.FAKE_GEMINI_MODELS_COUNT_FILE)
    appendFileSync(process.env.FAKE_GEMINI_MODELS_COUNT_FILE, "x" + NL);
  if (process.env.FAKE_GEMINI_SIGNED_OUT === "1") {
    process.stderr.write("Please sign in with your Google account." + NL);
    process.exit(1);
  }
  process.stdout.write(
    [
      "gemini-3.8-flash-low",
      "gemini-3.8-flash-medium",
      "gemini-3.8-flash-high",
      "gemini-3.1-pro-low",
      "gemini-3.1-pro-high",
    ].join(NL) + NL,
  );
  process.exit(0);
}

function argValue(name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

const model = argValue("--model");
if (!model) fail("Missing --model.");
if (argv.length !== 11) fail("Unexpected argument count.");
if (argv[0] !== "--model" || argv[1] !== model) fail("Missing --model value.");
if (argv[2] !== "--dangerously-skip-permissions") fail("Missing tool permission bypass.");
if (argv[3] !== "--disable-slash-commands") fail("Missing --disable-slash-commands.");
if (argv[4] !== "--input-format" || argv[5] !== "stream-json") fail("Missing input format.");
if (argv[6] !== "--output-format" || argv[7] !== "stream-json") fail("Missing output format.");
if (argv[8] !== "--print-timeout" || !/^(?:[0-9]+(?:\.[0-9]+)?)s$/.test(argv[9] ?? "") || !(Number.parseFloat(argv[9]) > 0)) fail("Missing print timeout.");
if (argv[10] !== "--print=") fail("Missing --print=.");

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

const input = await readStdin();
const lines = input
  .split(NL)
  .map((line) => line.trim())
  .filter(Boolean);
if (lines.length !== 1) fail("Expected exactly one NDJSON event.");

let event;
try {
  event = JSON.parse(lines[0]);
} catch {
  fail("Invalid NDJSON.");
}

if (
  !event ||
  event.event !== "user" ||
  !event.message ||
  event.message.role !== "user" ||
  typeof event.message.content !== "string"
) {
  fail("Expected one user event with string message.content.");
}
if ("tools" in event || "permission" in event || event.message.tools || event.message.permission) {
  fail("Tools permission skip is not allowed.");
}

if (process.env.FAKE_GEMINI_SIGNED_OUT === "1") {
  process.stderr.write("Please sign in with your Google account." + NL);
  process.exit(1);
}

const cwd = process.cwd();
const files = readdirSync(cwd);

// Lets a test find the owned process and its working directory after a timeout.
if (process.env.FAKE_GEMINI_PID_FILE)
  writeFileSync(process.env.FAKE_GEMINI_PID_FILE, String(process.pid));
if (process.env.FAKE_GEMINI_CWD_FILE) writeFileSync(process.env.FAKE_GEMINI_CWD_FILE, cwd);

const delayMs = Number.parseInt(process.env.FAKE_GEMINI_DELAY_MS ?? "0", 10);
if (Number.isFinite(delayMs) && delayMs > 0) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function emit(value) {
  process.stdout.write(JSON.stringify(value) + NL);
}

emit({ event: "init", init: { model } });

let status = "SUCCESS";
let response = "";
let error = "";
if (process.env.FAKE_GEMINI_ERROR) {
  status = "ERROR";
  error = process.env.FAKE_GEMINI_ERROR;
} else if (process.env.FAKE_GEMINI_ECHO === "1") {
  response = JSON.stringify({
    prompt: event.message.content,
    argv,
    cwd,
    files,
    events: lines.length,
    env: {
      codexHome: process.env.CODEX_HOME ?? null,
      apiKeyNames: Object.keys(process.env).filter((name) => /API_KEY/i.test(name)),
      hasServerSecret: process.env.BETTER_AUTH_SECRET !== undefined,
    },
  });
} else {
  response = JSON.stringify({
    headline: "Markets steady as central banks weigh next move",
    dek: "A short, measured draft for the desk.",
    body_html:
      "<p>Markets were steady on Tuesday as investors weighed the next move from central banks.</p>",
    byline: "Staff",
    section: "Business",
  });
}

emit({
  event: "result",
  result: {
    status,
    response,
    error,
    duration_seconds: 0.01,
    // FAKE_GEMINI_NO_USAGE: a CLI that reports no counters must yield none.
    ...(process.env.FAKE_GEMINI_NO_USAGE === "1"
      ? {}
      : { usage: { input_tokens: 12, output_tokens: 24, total_tokens: 36 } }),
  },
});

if (status === "ERROR") {
  process.exit(1);
}
// FAKE_GEMINI_EXIT_CODE: a success envelope from a process that still exits non-zero.
const exitCode = Number.parseInt(process.env.FAKE_GEMINI_EXIT_CODE ?? "0", 10);
process.exit(Number.isFinite(exitCode) ? exitCode : 0);
