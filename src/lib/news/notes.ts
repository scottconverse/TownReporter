export type NoteTodo = { t: string; done: boolean; src: "you" | "machine" };
export type NoteFound = { t: string; src?: string };
export type NoteOpened = { url: string; title: string };

export type ReportingNotes = {
  news: string;
  why: string;
  angle: string;
  todo: NoteTodo[];
  found: NoteFound[];
  verify: string[];
  opened: NoteOpened[];
  scratch: string;
};

export function emptyNotes(): ReportingNotes {
  return { news: "", why: "", angle: "", todo: [], found: [], verify: [], opened: [], scratch: "" };
}

export function parseNotes(raw: string | null | undefined): ReportingNotes {
  const base = emptyNotes();
  if (!raw?.trim() || raw.trim() === "{}") return base;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object") return base;
    const strs = (v: unknown) =>
      Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, 16) : [];
    const todo: NoteTodo[] = Array.isArray(o.todo)
      ? o.todo
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const r = row as { t?: unknown; done?: unknown; src?: unknown };
            const t = String(r.t ?? "").trim();
            if (!t) return null;
            return {
              t: t.slice(0, 400),
              done: Boolean(r.done),
              src: r.src === "you" ? ("you" as const) : ("machine" as const),
            };
          })
          .filter((x): x is NoteTodo => Boolean(x))
          .slice(0, 24)
      : [];
    const found: NoteFound[] = Array.isArray(o.found)
      ? o.found
          .map((row) => {
            if (typeof row === "string" && row.trim()) return { t: row.trim().slice(0, 800) };
            if (!row || typeof row !== "object") return null;
            const r = row as { t?: unknown; src?: unknown };
            const t = String(r.t ?? "").trim();
            if (!t) return null;
            const src = String(r.src ?? "").trim();
            return src ? { t: t.slice(0, 800), src: src.slice(0, 200) } : { t: t.slice(0, 800) };
          })
          .filter((x): x is NoteFound => Boolean(x))
          .slice(0, 12)
      : [];
    const opened: NoteOpened[] = Array.isArray(o.opened)
      ? o.opened
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const r = row as { url?: unknown; title?: unknown };
            const url = String(r.url ?? "").trim();
            if (!url) return null;
            return { url: url.slice(0, 500), title: String(r.title ?? url).slice(0, 160) };
          })
          .filter((x): x is NoteOpened => Boolean(x))
          .slice(0, 16)
      : [];
    return {
      news: String(o.news ?? "").trim().slice(0, 500),
      why: String(o.why ?? o.why_it_matters ?? "").trim().slice(0, 800),
      angle: String(o.angle ?? "").trim().slice(0, 400),
      todo,
      found,
      verify: strs(o.verify),
      opened,
      scratch: String(o.scratch ?? "").slice(0, 8000),
    };
  } catch {
    return base;
  }
}

export function notesHaveMemo(n: ReportingNotes): boolean {
  return Boolean(n.news || n.why || n.angle);
}

export function notesHaveAnything(n: ReportingNotes): boolean {
  return notesHaveMemo(n) || n.todo.length > 0 || n.found.length > 0 || n.verify.length > 0 || n.opened.length > 0;
}

export function keepHumanTodos(notes: ReportingNotes): NoteTodo[] {
  return notes.todo.filter((t) => t.src === "you");
}

/** Longer than this and a to-do line stops being one errand. */
const TODO_SPLIT_AT = 160;

/**
 * Break a run-on to-do into the separate errands it actually contains.
 *
 * The desk searches a to-do line verbatim when the reporter presses PULL, so
 * length is not cosmetic. One real line read: "Get the district board's adopted
 * resolution and the certified ballot title text — those are the two documents
 * that settle rate, boundary, sunset and debt. Then the board packet and
 * minutes for the August 2026 meeting..." — six documents in one sentence. As a
 * query it matched only its own generic nouns and returned three parcel-tax
 * resolutions from school districts in California.
 *
 * Split on sentence ends and on the joins a model uses to chain errands. A
 * piece that comes out too short to search on is folded back into the one
 * before it rather than kept as a stub.
 */
export function splitTodoLine(line: string, limit = TODO_SPLIT_AT): string[] {
  const text = line.trim();
  if (text.length <= limit) return text ? [text] : [];

  const pieces: string[] = [];
  for (const raw of text.split(/(?<=[.;])\s+|\s+(?:Then|And then|Also)\s+/i)) {
    const piece = raw.replace(/\s+/g, " ").replace(/^[\s,;.—-]+|[\s,;]+$/g, "").trim();
    if (!piece) continue;
    if (piece.length < 24 && pieces.length) {
      pieces[pieces.length - 1] = `${pieces[pieces.length - 1]} ${piece}`;
      continue;
    }
    pieces.push(piece);
  }
  return pieces.length ? pieces : [text];
}

export function machineTodosFrom(parts: (string | undefined | null)[]): NoteTodo[] {
  const seen = new Set<string>();
  const out: NoteTodo[] = [];
  for (const raw of parts) {
    const whole = String(raw ?? "").trim();
    if (!whole) continue;
    for (const t of splitTodoLine(whole)) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ t: t.slice(0, 400), done: false, src: "machine" });
      if (out.length >= 16) return out;
    }
  }
  return out.slice(0, 16);
}

export function toggleTodo(notes: ReportingNotes, index: number): ReportingNotes {
  if (index < 0 || index >= notes.todo.length) return notes;
  return {
    ...notes,
    todo: notes.todo.map((t, i) => (i === index ? { ...t, done: !t.done } : t)),
  };
}

export function addHumanLine(notes: ReportingNotes, line: string): ReportingNotes {
  const t = line.trim().slice(0, 400);
  if (!t) return notes;
  if (notes.todo.some((x) => x.t.toLowerCase() === t.toLowerCase() && x.src === "you")) return notes;
  return { ...notes, todo: [...notes.todo, { t, done: false, src: "you" as const }].slice(0, 24) };
}

export function sanitizeTodos(raw: unknown): NoteTodo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const r = row as { t?: unknown; done?: unknown; src?: unknown };
      const t = String(r.t ?? "").trim();
      if (!t) return null;
      return {
        t: t.slice(0, 400),
        done: Boolean(r.done),
        src: r.src === "you" ? ("you" as const) : ("machine" as const),
      };
    })
    .filter((x): x is NoteTodo => Boolean(x))
    .slice(0, 24);
}

export function applyTodoPatch(
  notes: ReportingNotes,
  patch: { todos?: NoteTodo[]; toggle?: number; add?: string; scratch?: string },
): ReportingNotes {
  let next = notes;
  if (patch.todos && patch.todos.length) next = { ...next, todo: sanitizeTodos(patch.todos) };
  if (typeof patch.toggle === "number") next = toggleTodo(next, patch.toggle);
  if (patch.add) next = addHumanLine(next, patch.add);
  if (typeof patch.scratch === "string") next = { ...next, scratch: patch.scratch.slice(0, 8000) };
  return next;
}

/**
 * The passage of a document that actually answers the pulled line.
 *
 * Pull used to take the FIRST 1,600 characters of the page with every line
 * break flattened to a space. Two failures in one: the top of a civic page is
 * navigation and boilerplate, not the record, and prose without paragraph
 * breaks is a wall (operator finding, 2026-08-30). This scores each paragraph
 * against the meaningful words of the pulled line and returns the
 * best-scoring run of consecutive paragraphs, breaks intact.
 *
 * When nothing matches (a scanned PDF whose text mangles, a page about
 * something else), it falls back to the first SUBSTANTIAL paragraphs --
 * short nav-ish lines are skipped even then, so the old menu-dump cannot
 * come back through the fallback.
 */
export function selectExcerpt(text: string, query: string, cap = 1600): string {
  const paragraphs = text
    .split(/\n{2,}|\r\n{2,}|(?:\r?\n)(?=\S)/)
    .map((p) => p.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
  if (!paragraphs.length) return "";

  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const score = (p: string) => {
    const low = p.toLowerCase();
    let n = 0;
    for (const w of words) if (low.includes(w)) n += 1;
    return n;
  };

  /*
    Only PROSE can anchor the excerpt. The first live walk of this function
    anchored on a page's own <title> line -- "…NextLight discount - City of
    Longmont" scores on the pulled words too -- and the next two "paragraphs"
    were "Skip to main content" and a survey banner. A line too short to be a
    sentence about anything is scenery, whatever words it contains: it cannot
    start the excerpt, and while collecting it is skipped unless it genuinely
    matches the pulled line.

    A loop, not Math.max(...spread): a long PDF splits into thousands of
    paragraphs and a spread that size can blow the argument limit.
  */
  const PROSE_MIN = 60;
  const scores = paragraphs.map(score);
  let best = 0;
  let start = -1;
  for (let i = 0; i < paragraphs.length; i++) {
    if (paragraphs[i]!.length < PROSE_MIN) continue;
    if (scores[i]! > best) {
      best = scores[i]!;
      start = i;
    }
  }
  if (start < 0 || best === 0) {
    // Fallback: first paragraph long enough to be prose, not a menu row.
    start = paragraphs.findIndex((p) => p.length >= 80);
    if (start < 0) start = 0;
  }

  const out: string[] = [];
  let used = 0;
  for (let i = start; i < paragraphs.length && out.length < 3; i++) {
    const p = paragraphs[i]!;
    if (p.length < PROSE_MIN && scores[i] === 0) continue; // scenery between prose
    if (used + p.length > cap && out.length > 0) break;
    out.push(p.length > cap ? p.slice(0, cap) : p);
    used += p.length + 2;
  }
  return out.join("\n\n").slice(0, cap);
}

export function formatPullDump(
  query: string,
  rows: { title: string; url: string; excerpt: string }[],
): string {
  if (!rows.length) {
    return `Pulled: ${query}\nNothing public found. Try a more specific line, or paste a URL.\n`;
  }
  return rows
    .map((r) => `${r.title}\n${r.url}\n\n${r.excerpt.trim()}\n`)
    .join("\n");
}

export function appendScratch(notes: ReportingNotes, chunk: string): ReportingNotes {
  const add = chunk.trim();
  if (!add) return notes;
  const scratch = notes.scratch.trim() ? `${notes.scratch.trim()}\n\n${add}` : add;
  return { ...notes, scratch: scratch.slice(0, 8000) };
}

/**
 * Serialize notes to fit a column budget WITHOUT cutting the JSON in half.
 *
 * The three call sites all used to write `JSON.stringify(notes).slice(0, N)`.
 * Once a lead's notes grew past N — a few pulls will do it, since each dump is
 * up to 1,600 characters per document — that wrote a string ending mid-token.
 * `parseNotes` then failed and returned empty notes, so the memo, the found
 * facts, the opened documents and every pulled excerpt vanished at the next
 * read, and the lead page quietly reseeded a bare to-do list from the draft.
 * From the desk it looked like a pull that did nothing.
 *
 * Nothing shouted. The write succeeded, the parse "succeeded", and the loss
 * only showed up as absence.
 *
 * Trims in order of what a reporter can least afford to lose last: the scratch
 * tail first (it is the rawest and the most re-pullable), then the oldest
 * opened documents, then the found list. The memo and the to-do list are never
 * dropped — if they alone do not fit, the caller gets valid JSON of just those.
 */
export function packNotes(notes: ReportingNotes, limit = 16000): string {
  const fits = (n: ReportingNotes) => {
    const s = JSON.stringify(n);
    return s.length <= limit ? s : null;
  };

  let out = fits(notes);
  if (out) return out;

  const work: ReportingNotes = { ...notes };

  /*
    Scratch is halved first, but only down to a floor: the tail is the newest
    pull, and a reporter losing the excerpt they just fetched is the exact
    failure this function exists to stop. Below the floor, shed structured
    lists instead — those can be rebuilt from the draft, the excerpts cannot.
  */
  const SCRATCH_FLOOR = 400;
  while (work.scratch.length > SCRATCH_FLOOR) {
    work.scratch = work.scratch.slice(-Math.max(SCRATCH_FLOOR, Math.floor(work.scratch.length / 2)));
    out = fits(work);
    if (out) return out;
  }

  while (work.opened.length > 0) {
    work.opened = work.opened.slice(0, -1);
    out = fits(work);
    if (out) return out;
  }

  while (work.found.length > 0) {
    work.found = work.found.slice(0, -1);
    out = fits(work);
    if (out) return out;
  }

  work.verify = [];
  out = fits(work);
  if (out) return out;

  work.scratch = "";
  out = fits(work);
  if (out) return out;

  // Last resort: the memo and the to-do list only. Still valid JSON.
  return JSON.stringify({
    news: work.news,
    why: work.why,
    angle: work.angle,
    todo: work.todo,
    found: [],
    verify: [],
    opened: [],
    scratch: "",
  });
}
