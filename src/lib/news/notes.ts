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
};

export function emptyNotes(): ReportingNotes {
  return { news: "", why: "", angle: "", todo: [], found: [], verify: [], opened: [] };
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

export function machineTodosFrom(parts: (string | undefined | null)[]): NoteTodo[] {
  const seen = new Set<string>();
  const out: NoteTodo[] = [];
  for (const raw of parts) {
    const t = String(raw ?? "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ t: t.slice(0, 400), done: false, src: "machine" });
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
  patch: { todos?: NoteTodo[]; toggle?: number; add?: string },
): ReportingNotes {
  let next = notes;
  if (patch.todos && patch.todos.length) next = { ...next, todo: sanitizeTodos(patch.todos) };
  if (typeof patch.toggle === "number") next = toggleTodo(next, patch.toggle);
  if (patch.add) next = addHumanLine(next, patch.add);
  return next;
}
