import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeskShell, Field, InkButton, inkSolid, inputClass, areaClass } from "@/components/desk-chrome";
import { EmptyState, ListSkeleton, Notice } from "@/components/states";
import { fileLead, listLeads, setLeadStatus } from "@/lib/news/desk";
import { TOPICS, formatShortDate } from "@/lib/paper";

export const Route = createFileRoute("/desk/queue")({ component: QueuePage });

function QueuePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: leads = [], isPending } = useQuery({
    queryKey: ["leads"],
    queryFn: () => listLeads(),
    placeholderData: keepPreviousData,
  });
  const setStatus = useMutation({
    mutationFn: (input: { id: number; status: "held" | "killed" | "new" }) =>
      setLeadStatus({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
  const [headline, setHeadline] = useState("");
  const [why, setWhy] = useState("");
  const [topic, setTopic] = useState("council");
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const file = useMutation({
    mutationFn: () => fileLead({ data: { headline, why, topic, url } }),
    onSuccess: async (res) => {
      if (!res.ok) {
        setFormError(res.error);
        return;
      }
      setHeadline("");
      setWhy("");
      setUrl("");
      setFormError(null);
      await qc.invalidateQueries({ queryKey: ["leads"] });
      await navigate({ to: "/desk/story/$leadId", params: { leadId: String(res.id) } });
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Could not file that lead.");
    },
  });

  return (
    <DeskShell title="Queue" kicker="Leads">
      <p className="max-w-2xl text-ink-2">
        What is news. Grok can file leads from a scan when it is attached. You
        can always file one yourself, write the recap, and put it on the paper.
      </p>

      <form
        className="mt-6 max-w-2xl space-y-3 border border-rule bg-paper p-4"
        onSubmit={(event) => {
          event.preventDefault();
          setFormError(null);
          file.mutate();
        }}
      >
        <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
          File a lead
        </p>
        <Field label="Headline">
          <input
            className={inputClass}
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            required
            minLength={8}
            placeholder="What happened"
          />
        </Field>
        <Field label="Why now">
          <textarea
            className={areaClass}
            rows={3}
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            required
            minLength={8}
            placeholder="Why this is news in Longmont today"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Topic">
            <select
              className={inputClass}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            >
              {TOPICS.filter((t) => t !== "about").map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Source URL (optional)">
            <input
              className={inputClass}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
          </Field>
        </div>
        {formError ? <Notice kind="err">{formError}</Notice> : null}
        <InkButton disabled={file.isPending} type="submit">
          {file.isPending ? "Filing…" : "File lead"}
        </InkButton>
      </form>

      {isPending && leads.length === 0 ? (
        <ListSkeleton rows={4} />
      ) : leads.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            kicker="Leads"
            title="Queue is empty"
            body="File a lead above, or wait until a scan with Grok attached fills this list. Nothing prints until you open a lead and publish."
            action={
              <Link to="/desk/scan" className={inkSolid}>
                Scan sources
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="stagger-in mt-6 space-y-4">
          {leads.map((l) => (
            <li
              key={l.id}
              className="story-card border border-rule bg-paper p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[11px] tracking-[0.14em] text-muted uppercase">
                  {l.topic} · {formatShortDate(l.created_at)}
                  {l.newsworthiness != null ? ` · ${l.newsworthiness}/20` : ""}
                </p>
                <StatusChip status={l.status} />
              </div>
              <h2 className="mt-1 font-display text-2xl">
                <Link
                  to="/desk/story/$leadId"
                  params={{ leadId: String(l.id) }}
                  className="transition-[color] duration-150 ease-out hover:text-rust"
                >
                  {l.headline}
                </Link>
              </h2>
              <p className="mt-2 text-ink-2">{l.why}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/desk/story/$leadId"
                  params={{ leadId: String(l.id) }}
                  className={inkSolid}
                >
                  Open
                </Link>
                {l.article_slug ? (
                  <Link
                    to="/articles/$slug"
                    params={{ slug: l.article_slug }}
                    className="pressable inline-flex min-h-11 items-center border border-ink px-4 text-sm hover:bg-paper-2"
                  >
                    On the paper
                  </Link>
                ) : null}
                {l.status !== "held" && l.status !== "published" && (
                  <InkButton
                    tone="ghost"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: l.id, status: "held" })}
                  >
                    Hold
                  </InkButton>
                )}
                {l.status !== "killed" && l.status !== "published" && (
                  <InkButton
                    tone="danger"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: l.id, status: "killed" })}
                  >
                    Kill
                  </InkButton>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </DeskShell>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === "published"
      ? "border-rust text-rust"
      : status === "killed"
        ? "border-danger text-danger"
        : status === "held"
          ? "border-rule text-muted"
          : "border-ink text-ink";
  return (
    <span
      className={
        "inline-flex items-center border px-2 py-0.5 text-[11px] tracking-[0.12em] uppercase " +
        tone
      }
    >
      {status}
    </span>
  );
}
