import { useEffect, useId, useState } from "react";
import { USE_LOADED_RECOMMENDED_LABEL, deskLocalModelSentence } from "@/lib/news/desk-local-model";
import type { LocalCatalog } from "@/lib/news/local-models";

const TITLE = "The desk's local model";

type Pair = { baseUrl: string; id: string };

export function DeskLocalModelBox({
  isOwner,
  choice,
  pending,
  onUseLoaded,
}: {
  isOwner: boolean;
  choice:
    | {
        override: Pair | null;
        storedPick?: Pair | null;
        catalog: LocalCatalog;
        notice: string | null;
      }
    | undefined;
  pending: boolean;
  onUseLoaded: () => void;
}) {
  const group = useId();
  const [mode, setMode] = useState<"loaded" | "named">("named");
  const storedBaseUrl = choice?.storedPick?.baseUrl;
  const storedId = choice?.storedPick?.id;

  useEffect(() => {
    setMode(storedBaseUrl === "*" && storedId === "*" ? "loaded" : "named");
  }, [storedBaseUrl, storedId]);

  if (!choice) {
    return (
      <section
        aria-label={TITLE}
        style={{
          gridColumn: "1 / -1",
          border: "2px solid var(--fg)",
          padding: 20,
          color: "var(--fg)",
          fontSize: 16,
          overflowWrap: "anywhere",
        }}
      >
        <h3 className="text-xl font-extrabold" style={{ margin: "0 0 12px" }}>
          {TITLE}
        </h3>
        <p style={{ margin: 0 }}>Checking the desk's local model…</p>
      </section>
    );
  }

  const sentence = deskLocalModelSentence({ override: choice.override, catalog: choice.catalog });

  return (
    <section
      aria-label={TITLE}
      style={{
        gridColumn: "1 / -1",
        border: "2px solid var(--fg)",
        padding: 20,
        color: "var(--fg)",
        fontSize: 16,
        overflowWrap: "anywhere",
      }}
    >
      <h3 className="text-xl font-extrabold" style={{ margin: "0 0 12px" }}>
        {TITLE}
      </h3>
      <p style={{ margin: "0 0 12px" }}>{sentence}</p>
      {isOwner ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <label
            style={{
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              border: "1px solid var(--fg)",
              color: "var(--fg)",
            }}
          >
            <input
              type="radio"
              name={group}
              checked={mode === "loaded"}
              disabled={pending}
              onChange={() => {
                setMode("loaded");
                onUseLoaded();
              }}
            />
            {USE_LOADED_RECOMMENDED_LABEL}
          </label>
          <label
            style={{
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              border: "1px solid var(--fg)",
              color: "var(--fg)",
            }}
          >
            <input
              type="radio"
              name={group}
              checked={mode === "named"}
              disabled={pending}
              onChange={() => setMode("named")}
            />
            Always use one model
          </label>
        </div>
      ) : null}

      {isOwner && mode === "named" ? (
        <p style={{ margin: "12px 0 0" }}>
          Press Use this one beside the model you want below. The first writing request can load
          that model and take a minute.
        </p>
      ) : null}

      {!isOwner ? <p style={{ margin: "12px 0 0" }}>Only the owner can change this.</p> : null}
      {choice.notice ? <p style={{ margin: "12px 0 0" }}>{choice.notice}</p> : null}
    </section>
  );
}
