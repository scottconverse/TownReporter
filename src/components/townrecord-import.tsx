import { useState } from "react";
import { importTownrecordEvidence } from "../lib/news/townrecord-handoff-actions";

export function TownrecordImport() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  return <details className="mt-4 border rounded p-4">
    <summary>Import reviewed TownRecord evidence</summary>
    <p>Export a published meeting from TownRecord’s operator workspace, then select its JSON file here.
      This creates an unpublished lead for your newsroom. It never publishes a story or changes an existing lead.</p>
    <form onSubmit={async event => {
      event.preventDefault(); if (!file || busy) return;
      setBusy(true); setResult("Importing…");
      try {
        if (file.size > 2_000_000) throw new Error("Choose a TownRecord export smaller than 2 MB.");
        const saved = await importTownrecordEvidence({ data: { json: await file.text() } });
        setResult(`Lead ${saved.leadId}: ${saved.unchanged ? "already imported; editorial work preserved" : "received in New, awaiting editorial review"}.`);
      } catch (error) { setResult(`Import failed. ${error instanceof Error ? error.message : "Check the export and retry."}`); }
      finally { setBusy(false); }
    }}>
      <label>TownRecord meeting export <input type="file" accept=".json,application/json" disabled={busy}
        onChange={event => { setFile(event.target.files?.[0] ?? null); setResult(""); }} /></label>
      <button type="submit" className="border rounded p-2 m-2" disabled={!file || busy}>Import as unpublished lead</button>
    </form>
    <p role="status" aria-live="polite">{result}</p>
  </details>;
}
