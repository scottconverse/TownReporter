import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import {
  readRegistryVerification,
  recordRegistryVerification,
} from "@/lib/news/registry/registry-verify";
import { VERIFY_METHODS, verifyMethodWords } from "@/lib/news/registry/registry-verify-methods";
import { usePaperDateFormatters } from "@/lib/paper-context-state";

/**
 * The Verify form and history of one entry (spec 24, Phase 3), shown in the
 * entry editor. An editor records that they checked the entry: how (the
 * method), what they checked (the basis, desk-only, never on the public page)
 * and an optional link. Saving the entry never verifies it; only this form does.
 *
 * The history lists the latest check, the older ones newest first, and the date
 * older versions of the desk set on every save, labelled for what it is.
 * "Changed since verified" lists the key facts that differ from the last check.
 *
 * Every line is the page's normal body size and full-contrast text.
 */

type Verification = Awaited<ReturnType<typeof readRegistryVerification>>;
type Record_ = NonNullable<Verification["latest"]>;

export const BASIS_MAX = 2000;
const VERIFY_KEY = (serviceId: number) => ["registry-verification", serviceId];

/** The method's public words, capitalized for the select ("By phone"). */
const methodLabel = (key: string): string => {
  const words = verifyMethodWords(key);
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
};

const box = "w-full border border-rule bg-paper p-2 text-base";

function CheckLine({
  record,
  when,
}: {
  record: Record_;
  when: (value: string | Date | null | undefined) => string;
}) {
  const how = verifyMethodWords(record.method);
  return (
    <div data-testid="verification-record">
      <p className="text-base">
        {when(record.checkedAt)}
        {how ? `, ${how}` : ""}, by {record.checkedBy}
      </p>
      <p className="text-base">Basis: {record.basis}</p>
      {record.sourceUrl ? (
        <p className="text-base">
          Source:{" "}
          <a className="inline-link" href={record.sourceUrl} target="_blank" rel="noreferrer">
            {record.sourceUrl} ↗
          </a>
        </p>
      ) : null}
    </div>
  );
}

export function RegistryVerificationPanel({ serviceId }: { serviceId: number }) {
  const qc = useQueryClient();
  const { formatListDateTime, formatShortDate } = usePaperDateFormatters();
  const query = useQuery({
    queryKey: VERIFY_KEY(serviceId),
    queryFn: () => readRegistryVerification({ data: { serviceId } }),
  });
  const [method, setMethod] = useState("");
  const [basis, setBasis] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [problems, setProblems] = useState<Partial<Record<"method" | "basis" | "sourceUrl", string>>>({});
  const [status, setStatus] = useState<{ kind: "ok" | "refused"; text: string; count: number } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  const say = (kind: "ok" | "refused", text: string) =>
    setStatus((previous) => ({ kind, text, count: (previous?.count ?? 0) + 1 }));

  const submit = async () => {
    if (running.current) return;
    // The server checks these too; saying so here saves the editor a round trip.
    const local: typeof problems = {};
    if (!method) local.method = "Choose how you checked this entry.";
    if (basis.trim() === "") local.basis = "Say what you checked. This is required.";
    else if (basis.length > BASIS_MAX) local.basis = `Keep this under ${BASIS_MAX} characters.`;
    const url = sourceUrl.trim();
    if (url !== "" && !/^https?:\/\/\S+$/i.test(url)) {
      local.sourceUrl = "The link must start with http:// or https://.";
    }
    setProblems(local);
    if (Object.keys(local).length > 0) {
      say("refused", "Nothing was recorded. Fix the lines marked below.");
      return;
    }
    running.current = true;
    setPending(true);
    try {
      const result = await recordRegistryVerification({
        data: { serviceId, method, basis, sourceUrl: url === "" ? null : url },
      });
      if (result.ok) {
        setProblems({});
        setMethod("");
        setBasis("");
        setSourceUrl("");
        await qc.invalidateQueries({ queryKey: VERIFY_KEY(serviceId) });
        await qc.invalidateQueries({ queryKey: ["registry-needs-checking"] });
        say("ok", result.message);
      } else {
        setProblems(result.problems);
        say("refused", "Nothing was recorded. Fix the lines marked below.");
      }
    } catch (error) {
      say(
        "refused",
        (error instanceof Error ? error.message : "") ||
          "The verification was not recorded. Nothing was changed.",
      );
    } finally {
      running.current = false;
      setPending(false);
    }
  };

  const data = query.data;
  const older = data ? data.history.filter((record) => record.id !== data.latest?.id) : [];

  return (
    <section className="mt-4 border border-rule p-3" aria-label="Verification">
      <h4 className="mb-2 font-display text-xl">Verification</h4>
      {query.isError ? (
        <p className="text-base text-rust" role="alert">
          {query.error instanceof Error ? query.error.message : "The verification could not be loaded."}
        </p>
      ) : !data ? (
        <p className="text-base" role="status">
          Loading the verification…
        </p>
      ) : (
        <div className="grid gap-2">
          {data.latest ? (
            <div>
              <p className="text-base font-semibold">Latest verification</p>
              <CheckLine record={data.latest} when={formatListDateTime} />
            </div>
          ) : (
            <p className="text-base font-semibold">Not verified yet.</p>
          )}
          {data.changedFacts.length > 0 ? (
            <p className="text-base font-semibold text-ink" data-testid="changed-facts">
              Changed since verified: {data.changedFacts.join(", ")}
            </p>
          ) : null}
          {data.legacy?.at ? (
            <p className="text-base" data-testid="legacy-date">
              Legacy date (set by saves, not a check): {formatShortDate(data.legacy.at)}
            </p>
          ) : null}
          {older.length > 0 ? (
            <div>
              <p className="text-base font-semibold">Older verifications</p>
              <ul className="grid gap-2">
                {older.map((record) => (
                  <li key={record.id}>
                    <CheckLine record={record} when={formatListDateTime} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}

      <form
        className="mt-3 grid gap-3"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="text-base">
          Record that you checked this entry. The basis stays on the desk; readers see only the
          date and how it was checked.
        </p>
        <label className="block text-base">
          How you checked
          <select
            name="method"
            className={box}
            value={method}
            onChange={(event) => setMethod(event.target.value)}
          >
            <option value="">Choose one…</option>
            {VERIFY_METHODS.map((key) => (
              <option key={key} value={key}>
                {methodLabel(key)}
              </option>
            ))}
          </select>
          {problems.method ? (
            <span className="mt-1 block text-base text-rust" role="alert">
              {problems.method}
            </span>
          ) : null}
        </label>
        <label className="block text-base">
          What you checked (required, up to {BASIS_MAX} characters)
          <textarea
            name="basis"
            className={box}
            rows={3}
            maxLength={BASIS_MAX}
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          {problems.basis ? (
            <span className="mt-1 block text-base text-rust" role="alert">
              {problems.basis}
            </span>
          ) : null}
        </label>
        <label className="block text-base">
          Source link (optional)
          <input
            name="sourceUrl"
            type="url"
            className={box}
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
          />
          {problems.sourceUrl ? (
            <span className="mt-1 block text-base text-rust" role="alert">
              {problems.sourceUrl}
            </span>
          ) : null}
        </label>
        {status ? (
          <p
            ref={statusRef}
            tabIndex={-1}
            className={"text-base " + (status.kind === "refused" ? "text-rust" : "text-ink")}
            role={status.kind === "refused" ? "alert" : "status"}
            aria-live={status.kind === "refused" ? "assertive" : "polite"}
            data-testid="verification-status"
          >
            {status.text}
          </p>
        ) : null}
        <div>
          <InkButton type="submit" tone="solid" pending={pending} pendingLabel="Recording…">
            Record verification
          </InkButton>
        </div>
      </form>
    </section>
  );
}
