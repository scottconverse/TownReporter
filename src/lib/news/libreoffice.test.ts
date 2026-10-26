import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  findSoffice,
  libreOfficeDeps,
  libreOfficeSkipMessage,
  LibreOfficeError,
  notesOnly,
  readWithLibreOffice,
  sheetOrder,
} from "./libreoffice.server.ts";
import { documentKind, libreOfficeKindForMime, libreOfficeKindForName } from "./story-document-text.ts";
import { describeExtractionMethod } from "./extraction-label.ts";
import { extractStoryDocument } from "./story-documents.server.ts";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/story-documents/${name}`, import.meta.url)));
const real = { ...libreOfficeDeps };
afterEach(() => Object.assign(libreOfficeDeps, real));
const sofficeHere = findSoffice() !== null;
const needsSoffice = sofficeHere ? {} : { skip: "LibreOffice (soffice) is not installed here" };

describe("which files LibreOffice reads", () => {
  it("knows spreadsheets, slides and Writer files by name and content type", () => {
    for (const [name, kind] of [
      ["a.xlsx", "sheet"], ["a.XLS", "sheet"], ["a.ods", "sheet"],
      ["a.pptx", "slides"], ["a.ppt", "slides"], ["a.odp", "slides"], ["a.odt", "writer"],
    ] as const) {
      assert.equal(libreOfficeKindForName(name), kind);
      assert.equal(documentKind(name), kind);
    }
    assert.equal(libreOfficeKindForName("https://x.org/b.xlsx?dl=1"), "sheet");
    assert.equal(libreOfficeKindForMime("application/vnd.openxmlformats-officedocument.presentationml.presentation; charset=x"), "slides");
    assert.equal(libreOfficeKindForName("a.exe"), null);
    assert.equal(documentKind("a.pdf"), "pdf");
    assert.equal(documentKind("a.docx"), "word");
    assert.throws(() => documentKind("a.exe"));
  });
});

describe("finding soffice", () => {
  it("tries the override, Program Files, Program Files (x86), then PATH", () => {
    const tools = join("C:/tools", "soffice.exe");
    Object.assign(libreOfficeDeps, { platform: "win32", env: { PATH: dirname(tools) } });
    const seen: string[] = [];
    libreOfficeDeps.exists = (p) => (seen.push(p), p === tools);
    assert.equal(findSoffice(), tools);
    assert.match(seen[0]!, /Program Files[\\/]LibreOffice/);
    assert.match(seen[1]!, /Program Files \(x86\)/);
    const custom = join("D:/lo", "soffice.exe");
    libreOfficeDeps.env = { TOWNREPORTER_SOFFICE: custom };
    libreOfficeDeps.exists = (p) => p === custom;
    assert.equal(findSoffice(), custom);
  });
  it("warns and skips when LibreOffice is missing, without touching the child process", async () => {
    Object.assign(libreOfficeDeps, { platform: "win32", env: {}, exists: () => false });
    libreOfficeDeps.spawn = () => assert.fail("must not start a process");
    await assert.rejects(
      extractStoryDocument(
        { id: "t", filename: "budget.xlsx", mime: "", original: fixture("two-sheets.xlsx"), full_text: null, pages: null },
        "codex-frontier", 1, async () => {},
      ),
      (e: unknown) => e instanceof LibreOfficeError && e.code === "missing",
    );
    const line = libreOfficeSkipMessage("budget.xlsx", new LibreOfficeError("missing", "x"));
    assert.match(line, /^Install LibreOffice to read Excel and PowerPoint files/);
    assert.match(line, /libreoffice\.org\/download/);
    assert.equal(
      libreOfficeSkipMessage("budget.xlsx", new LibreOfficeError("failed", "file is damaged")),
      "LibreOffice could not read budget.xlsx: file is damaged",
    );
  });
});

describe("stuck LibreOffice", () => {
  it("is stopped after the time limit, by its own PID only", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    Object.assign(libreOfficeDeps, { platform: "win32", env: { TOWNREPORTER_SOFFICE: "S" }, exists: () => true, timeoutMs: 30 });
    libreOfficeDeps.spawn = (command, args) => {
      calls.push({ command, args });
      const child = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter };
      child.pid = 4242;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      return child as never; // never closes by itself: stuck
    };
    await assert.rejects(
      readWithLibreOffice(fixture("two-sheets.xlsx"), "a.xlsx"),
      (e: unknown) => e instanceof LibreOfficeError && e.code === "timeout",
    );
    const kill = calls.find((c) => c.command === "taskkill");
    assert.deepEqual(kill?.args, ["/PID", "4242", "/T", "/F"]);
    assert.ok(calls.every((c) => c.command !== "taskkill" || !c.args.includes("/IM")));
    const start = calls[0]!;
    assert.ok(start.args.some((a) => a.startsWith("-env:UserInstallation=file:///")));
    assert.ok(start.args.includes("--headless"));
  });
});

describe("pure helpers", () => {
  it("reads sheet order from the file, not from file names", () => {
    assert.deepEqual(sheetOrder(fixture("two-sheets.xlsx"), "xlsx"), ["General Fund", "Water Fund"]);
  });
  it("keeps only the speaker notes from a notes page", () => {
    assert.equal(notesOnly("Budget Hearing\nMention the 6% rate.", "Budget Hearing"), "Mention the 6% rate.");
    assert.equal(notesOnly("Water Rates", "Water Rates"), "");
  });
  it("labels LibreOffice reads for the desk", () => {
    assert.equal(describeExtractionMethod("libreoffice:sheets:3"), "Read by LibreOffice: 3 sheets");
    assert.equal(describeExtractionMethod("libreoffice:slides:1"), "Read by LibreOffice: 1 slide");
    assert.match(describeExtractionMethod("libreoffice-missing"), /Install LibreOffice/);
  });
});

describe("real conversions", needsSoffice, () => {
  it("reads every sheet with numbers as the file shows them", async () => {
    const r = await readWithLibreOffice(fixture("two-sheets.xlsx"), "two-sheets.xlsx");
    assert.equal(r.count, 2);
    assert.equal(r.note, "Read by LibreOffice: 2 sheets");
    assert.ok(r.text.indexOf("Sheet: General Fund") < r.text.indexOf("Sheet: Water Fund"));
    assert.match(r.text, /"\$31,250,000",6%/);
    assert.match(r.text, /Pipes,1200/);
  });
  it("reads slides as pages with the notes after, keeping slide numbers right", async () => {
    const r = await readWithLibreOffice(fixture("deck-with-notes.pptx"), "deck.pptx");
    assert.equal(r.count, 3);
    assert.match(r.text, /\[deck\.pptx, slide 2, LibreOffice\]\nWater Rates/);
    assert.match(r.text, /Speaker notes, slide 1, LibreOffice\]\nMention the 6% rate increase\./);
    assert.match(r.text, /Speaker notes, slide 3, LibreOffice\]\nWrap up by 8 PM\./);
    assert.doesNotMatch(r.text, /Speaker notes, slide 2/);
    assert.ok(r.text.lastIndexOf("slide 3, LibreOffice]\nQuestions") < r.text.indexOf("Speaker notes"));
  });
  it("goes through the upload reader and reports the note for the file line", async () => {
    const out = await extractStoryDocument(
      { id: "t", filename: "deck.pptx", mime: "", original: fixture("deck-with-notes.pptx"), full_text: null, pages: null },
      "codex-frontier", 1, async () => {},
    );
    assert.equal(out.readNote, "Read by LibreOffice: 3 slides");
    assert.equal(out.pages, 3);
  });
  it("says why a damaged file could not be read instead of throwing something vague", async () => {
    await assert.rejects(
      readWithLibreOffice(new Uint8Array([1, 2, 3, 4]), "broken.xlsx"),
      (e: unknown) => e instanceof LibreOfficeError,
    );
  });
});
