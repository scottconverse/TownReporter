/*
  Reads Excel, PowerPoint and LibreOffice files through headless LibreOffice.

  - Spreadsheets become one text table per sheet ("Sheet: <name>"), with the
    numbers as the file shows them ("$31,250,000", "6%").
  - Slides become a PDF that the desk's PDF reader (unpdf) reads, so page N is
    slide N. Speaker notes come from a second, notes-only PDF and are added
    after the slides ("Speaker notes, slide N").
  - Writer (.odt) files become a PDF and are read like a document.

  Safety, by design:
  - LibreOffice gets its OWN temporary profile folder and output folder, so a
    LibreOffice window the owner has open is never touched. Both are deleted
    after every read.
  - One conversion at a time; each stops after two minutes. A stuck process is
    stopped by its own PID (and its children) only, never by program name.
  - Macros never run: the temporary profile sets macro security to "very high"
    and disables macro execution, and headless conversion does not run them.
*/
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";
import { libreOfficeKindForName, type LibreOfficeKind } from "./story-document-text.ts";

export const LIBREOFFICE_DOWNLOAD_URL = "https://www.libreoffice.org/download/";
export const LIBREOFFICE_INSTALL_MESSAGE = "Install LibreOffice to read Excel and PowerPoint files";
export const LIBREOFFICE_TIMEOUT_MS = 2 * 60 * 1000;

export class LibreOfficeError extends Error {
  readonly code: "missing" | "failed" | "timeout";
  constructor(code: "missing" | "failed" | "timeout", message: string) {
    super(message);
    this.name = "LibreOfficeError";
    this.code = code;
  }
}

/** The line the file shows when LibreOffice could not be used for it. */
export function libreOfficeSkipMessage(filename: string, error: unknown): string {
  if (error instanceof LibreOfficeError && error.code === "missing")
    return `${LIBREOFFICE_INSTALL_MESSAGE} (${LIBREOFFICE_DOWNLOAD_URL})`;
  const reason = error instanceof Error ? error.message : String(error);
  return `LibreOffice could not read ${filename}: ${reason}`;
}

/**
 * The reason line for a failed conversion. LibreOffice's own Python can print a start-up note
 * ("Could not find platform independent libraries <prefix>") before the real error, so an
 * "Error:" line wins, and start-up notes are passed over.
 */
export function libreOfficeReason(output: string, code: number | null): string {
  const lines = output.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const startupNote = /^(Could not find platform (in)?dependent libraries|Consider setting \$PYTHONHOME)/i;
  const line = lines.find((l) => /^Error\b/i.test(l)) ?? lines.find((l) => !startupNote.test(l));
  return line?.slice(0, 200) || `LibreOffice stopped with code ${code}`;
}

/** Things tests replace; production leaves them alone. */
export const libreOfficeDeps = {
  spawn: nodeSpawn as (command: string, args: string[], options: object) => ChildProcess,
  exists: existsSync as (path: string) => boolean,
  env: process.env as Record<string, string | undefined>,
  platform: process.platform as NodeJS.Platform,
  timeoutMs: LIBREOFFICE_TIMEOUT_MS,
};

/** Override, then Program Files, then Program Files (x86), then PATH. */
export function findSoffice(): string | null {
  const { env, exists, platform } = libreOfficeDeps;
  const exe = platform === "win32" ? "soffice.exe" : "soffice";
  const override = env.TOWNREPORTER_SOFFICE?.trim();
  if (override && exists(override)) return override;
  const candidates: string[] = [];
  if (platform === "win32") {
    for (const base of [env.ProgramFiles ?? "C:\\Program Files", env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"])
      candidates.push(join(base, "LibreOffice", "program", exe));
  } else {
    candidates.push("/usr/bin/soffice", "/usr/local/bin/soffice", "/opt/libreoffice/program/soffice");
  }
  for (const candidate of candidates) if (exists(candidate)) return candidate;
  for (const dir of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exe);
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** For the Server page: whether LibreOffice can be found on this machine. */
export function libreOfficeStatus(): { found: boolean; path: string | null } {
  const path = findSoffice();
  return { found: path !== null, path };
}

let queue: Promise<unknown> = Promise.resolve();
/** One conversion at a time. */
function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

function stopByPid(child: ChildProcess) {
  const pid = child.pid;
  if (!pid) return;
  if (libreOfficeDeps.platform === "win32") {
    // By PID, with its children (soffice.exe starts soffice.bin). Never by name.
    const killer = libreOfficeDeps.spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => undefined);
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

function runSoffice(soffice: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    let output = "";
    let done = false;
    const child = libreOfficeDeps.spawn(soffice, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      stopByPid(child);
      reject(new LibreOfficeError("timeout", "LibreOffice took longer than 2 minutes and was stopped"));
    }, libreOfficeDeps.timeoutMs);
    const collect = (chunk: Buffer | string) => {
      if (output.length < 4000) output += String(chunk);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);
    child.on("error", (error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(new LibreOfficeError("failed", `LibreOffice would not start (${error.message})`));
    });
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

const MACRO_SAFE_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

type Work = {
  dir: string;
  input: string;
  out: string;
  convert: (filter: string, outDir: string) => Promise<void>;
};

/** Runs `job` with a fresh temporary profile + output folder, then deletes them. */
async function withWorkDir<T>(bytes: Uint8Array, ext: string, job: (work: Work) => Promise<T>): Promise<T> {
  const soffice = findSoffice();
  if (!soffice) throw new LibreOfficeError("missing", LIBREOFFICE_INSTALL_MESSAGE);
  return serialized(async () => {
    const dir = await mkdtemp(join(tmpdir(), "tr-lo-"));
    try {
      const profile = join(dir, "profile");
      await mkdir(join(profile, "user"), { recursive: true });
      await writeFile(join(profile, "user", "registrymodifications.xcu"), MACRO_SAFE_PROFILE);
      const input = join(dir, `doc.${ext}`);
      await writeFile(input, bytes);
      const out = join(dir, "out");
      await mkdir(out);
      const convert = async (filter: string, outDir: string) => {
        await mkdir(outDir, { recursive: true });
        const result = await runSoffice(soffice, [
          `-env:UserInstallation=${pathToFileURL(profile).href}`,
          "--headless",
          "--norestore",
          "--nologo",
          "--nolockcheck",
          "--nodefault",
          "--convert-to",
          filter,
          "--outdir",
          outDir,
          input,
        ]);
        if (result.code !== 0) throw new LibreOfficeError("failed", libreOfficeReason(result.output, result.code));
      };
      return await job({ dir, input, out, convert });
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
    }
  });
}

/* ---- sheet order, read straight from the file (xlsx and ods are zip files) ---- */

function zipEntry(buf: Buffer, wanted: string): Buffer | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && at + 46 <= buf.length && buf.readUInt32LE(at) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    if (name === wanted) {
      const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(dataAt, dataAt + size);
      return method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    }
    at += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function xmlDecode(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

/** Sheet names in workbook order, or [] when the order cannot be read. */
export function sheetOrder(bytes: Uint8Array, ext: string): string[] {
  try {
    const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (ext === "xlsx") {
      const xml = zipEntry(buf, "xl/workbook.xml")?.toString("utf8");
      return xml ? [...xml.matchAll(/<sheet\b[^>]*?\bname="([^"]*)"/g)].map((m) => xmlDecode(m[1]!)) : [];
    }
    if (ext === "ods") {
      const xml = zipEntry(buf, "content.xml")?.toString("utf8");
      return xml ? [...xml.matchAll(/<table:table\b[^>]*?\btable:name="([^"]*)"/g)].map((m) => xmlDecode(m[1]!)) : [];
    }
  } catch {
    /* fall back to file-name order */
  }
  return [];
}

/* ---- readers ---- */

export type LibreOfficeRead = {
  kind: LibreOfficeKind;
  text: string;
  /** Sheets, slides or pages. */
  count: number;
  unit: "sheets" | "slides" | "pages";
  /** "Read by LibreOffice: 3 sheets" */
  note: string;
};

const CSV_FILTER = "csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,true,false,false,-1";

function noteFor(count: number, unit: LibreOfficeRead["unit"]) {
  const word = count === 1 ? unit.slice(0, -1) : unit;
  return `Read by LibreOffice: ${count} ${word}`;
}

function extensionOf(filename: string) {
  return /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase() ?? "";
}

async function pdfPages(pdf: Uint8Array): Promise<string[]> {
  const { extractText } = await import("unpdf");
  const result = await extractText(Uint8Array.from(pdf), { mergePages: false });
  const pages = Array.isArray(result.text) ? result.text : [String(result.text ?? "")];
  return pages.map((page) => String(page ?? "").trim());
}

async function readSheets(bytes: Uint8Array, ext: string): Promise<LibreOfficeRead> {
  const files = await withWorkDir(bytes, ext, async (work) => {
    await work.convert(CSV_FILTER, work.out);
    const names = (await readdir(work.out)).filter((name) => name.endsWith(".csv"));
    const found = new Map<string, string>();
    for (const name of names) {
      const sheet = name.replace(/^doc-/, "").replace(/\.csv$/, "");
      const raw = await readFile(join(work.out, name), "utf8");
      found.set(sheet, raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"));
    }
    return found;
  });
  if (!files.size) throw new LibreOfficeError("failed", "LibreOffice produced no sheets");
  const ordered: string[] = [];
  for (const name of sheetOrder(bytes, ext)) if (files.has(name) && !ordered.includes(name)) ordered.push(name);
  for (const name of [...files.keys()].sort()) if (!ordered.includes(name)) ordered.push(name);
  const text = ordered
    .map((name) => {
      const body = files.get(name)!;
      const empty = !body.replace(/[,\s"]/g, "");
      return `Sheet: ${name}\n${empty ? "(This sheet is empty.)" : body.trimEnd()}`;
    })
    .join("\n\n");
  return { kind: "sheet", text, count: ordered.length, unit: "sheets", note: noteFor(ordered.length, "sheets") };
}

/** Drops lines of a notes page that are the slide's own text (the thumbnail). */
export function notesOnly(notesPage: string, slidePage: string): string {
  const slideLines = new Map<string, number>();
  for (const line of slidePage.split(/\r?\n/)) {
    const key = line.trim();
    if (key) slideLines.set(key, (slideLines.get(key) ?? 0) + 1);
  }
  const kept: string[] = [];
  for (const line of notesPage.split(/\r?\n/)) {
    const key = line.trim();
    const left = slideLines.get(key);
    if (key && left) slideLines.set(key, left - 1);
    else kept.push(line);
  }
  return kept.join("\n").trim();
}

async function readSlides(bytes: Uint8Array, ext: string, filename: string): Promise<LibreOfficeRead> {
  const { slides, notes } = await withWorkDir(bytes, ext, async (work) => {
    await work.convert("pdf", join(work.dir, "slides"));
    const slidePdf = await readFile(join(work.dir, "slides", "doc.pdf"));
    let notePdf: Buffer | null = null;
    try {
      await work.convert(
        'pdf:impress_pdf_Export:{"ExportNotesPages":{"type":"boolean","value":"true"},"ExportOnlyNotesPages":{"type":"boolean","value":"true"}}',
        join(work.dir, "notes"),
      );
      notePdf = await readFile(join(work.dir, "notes", "doc.pdf"));
    } catch (error) {
      // Notes are an extra: a timeout or crash here must not lose the slides.
      if (error instanceof LibreOfficeError && error.code === "timeout") throw error;
    }
    return { slides: await pdfPages(slidePdf), notes: notePdf ? await pdfPages(notePdf) : [] };
  });
  if (!slides.length) throw new LibreOfficeError("failed", "LibreOffice produced no slides");
  const parts = slides.map(
    (page, i) => `[${filename}, slide ${i + 1}, LibreOffice]\n${page || "[No text on this slide.]"}`,
  );
  if (notes.length === slides.length)
    notes.forEach((page, i) => {
      const note = notesOnly(page, slides[i]!);
      if (note) parts.push(`[${filename}, Speaker notes, slide ${i + 1}, LibreOffice]\n${note}`);
    });
  return {
    kind: "slides",
    text: parts.join("\n\n"),
    count: slides.length,
    unit: "slides",
    note: noteFor(slides.length, "slides"),
  };
}

async function readWriter(bytes: Uint8Array, ext: string, filename: string): Promise<LibreOfficeRead> {
  const pages = await withWorkDir(bytes, ext, async (work) => {
    await work.convert("pdf", join(work.dir, "pdf"));
    return pdfPages(await readFile(join(work.dir, "pdf", "doc.pdf")));
  });
  if (!pages.length) throw new LibreOfficeError("failed", "LibreOffice produced no pages");
  const text = pages.map((page, i) => `[${filename}, page ${i + 1}, LibreOffice]\n${page}`).join("\n\n");
  return { kind: "writer", text, count: pages.length, unit: "pages", note: noteFor(pages.length, "pages") };
}

/** Reads one Excel / PowerPoint / LibreOffice file. Throws LibreOfficeError. */
export async function readWithLibreOffice(
  bytes: Uint8Array,
  filename: string,
  kind: LibreOfficeKind | null = libreOfficeKindForName(filename),
): Promise<LibreOfficeRead> {
  if (!kind) throw new LibreOfficeError("failed", "this file type is not one LibreOffice reads for the desk");
  const ext = extensionOf(filename) || (kind === "sheet" ? "xlsx" : kind === "slides" ? "pptx" : "odt");
  if (kind === "sheet") return readSheets(bytes, ext);
  if (kind === "slides") return readSlides(bytes, ext, filename);
  return readWriter(bytes, ext, filename);
}
