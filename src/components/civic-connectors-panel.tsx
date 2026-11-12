import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  configureCivicConnectorSource, exportCivicConnectorEvidence, fileCivicConnectorLead,
  getCivicConnectorDesk, readCivicConnectorSource, reopenCivicConnectorEvidence,
  searchCivicConnectorEvidence, writeCivicConnectorSource,
  decodeConnectorResponse, type CivicConnectorDeskData,
} from "@/lib/news/civic-connectors-actions";
import type { OperationResult } from "quorumrelay-client";

function dataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function CivicConnectorsPanel() {
  const qc = useQueryClient();
  const desk = useQuery({ queryKey: ["civic-connectors"], queryFn: () => decodeConnectorResponse<CivicConnectorDeskData>(getCivicConnectorDesk()) });
  const [sourceId, setSourceId] = useState("");
  const [provider, setProvider] = useState("");
  const [inputFormat, setInputFormat] = useState("");
  const [namespace, setNamespace] = useState("");
  const [options, setOptions] = useState("{}");
  const [fetchFields, setFetchFields] = useState("{}");
  const [mode, setMode] = useState<"live" | "saved">("saved");
  const [writeEnabled, setWriteEnabled] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [contentBase64, setContentBase64] = useState<string>();
  const [term, setTerm] = useState("");
  const [phrase, setPhrase] = useState("");
  const [body, setBody] = useState("");
  const [recordType, setRecordType] = useState("");
  const [changes, setChanges] = useState("[]");
  const [approved, setApproved] = useState(false);
  const [plan, setPlan] = useState<{ plan_id: string; plan_hash: string }>();
  const [result, setResult] = useState<OperationResult>();
  const [opened, setOpened] = useState<unknown>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const value = desk.data;
  const providerData = dataObject(dataObject(value?.providers).data);
  const providers = Array.isArray(providerData.providers) ? providerData.providers.map(dataObject) : [];
  const current = value?.sources.find((source) => source.id === Number(sourceId));
  const selectedProvider = providers.find((row) => row.provider === provider || row.id === provider || row.connector === provider);
  const providerKey = (row: Record<string, unknown>) => String(row.provider ?? row.id ?? row.connector ?? "");
  const field = "input";

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
      await qc.invalidateQueries({ queryKey: ["civic-connectors"] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Connector operation failed.");
    } finally {
      setBusy(false);
    }
  }
  const dates = () => ({
    ...(dateFrom ? { date_from: dateFrom } : {}),
    ...(dateTo ? { date_to: dateTo } : {}),
  });
  const read = (preview: boolean, operation: "discover" | "fetch" = "discover") =>
    action(async () => {
      const response = await decodeConnectorResponse<{ saved: number; result: OperationResult }>(readCivicConnectorSource({ data: { sourceId: Number(sourceId), contentBase64, preview, operation,
        ...(operation === "fetch" ? { fetchFields: JSON.parse(fetchFields) } : {}) } }));
      setResult(response.result);
      setMessage(preview ? "Preview only. No newsroom evidence saved." : `Saved ${response.saved} new evidence revision(s). ${response.result.status}.`);
    });

  return (
    <details className="paper-panel" data-testid="civic-connectors-panel">
      <summary><strong>Civic data connectors</strong>, shared source discovery, cited evidence and export</summary>
      <p>Read-only ingestion never publishes a story or edits a provider. Source scans retrieve listed documents where available; unavailable text and the 100-document scan limit are reported as partial coverage. Saved captures and partial catalogs remain limited. Service 0.1.0.dev8, schema 2.0.0.</p>
      {desk.isPending ? <p>Checking connector configuration…</p> : null}
      {desk.error ? <p role="alert">Could not load connector evidence.</p> : null}
      {value?.serviceError ? <p role="status">{value.serviceError} Operator guide: <code>docs/civic-connectors.md</code>.</p> : null}
      <p>{providers.length} provider families available. Showing the newest 100 saved evidence revisions.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,240px),1fr))", gap: 12 }}>
        <label>Accepted source
          <select aria-label="Connector accepted source" className={field} value={sourceId} onChange={(event) => {
            const id = event.target.value;
            setSourceId(id);
            const source = value?.sources.find((row) => row.id === Number(id));
            const config = dataObject(source?.source_json);
            setProvider(String(config.provider ?? ""));
            setInputFormat(String(config.input_format ?? ""));
            setNamespace(String(config.namespace ?? ""));
            setOptions(JSON.stringify(dataObject(config.options), null, 2));
            setMode(source?.mode === "live" ? "live" : "saved");
            setWriteEnabled(source?.write_enabled === true);
            setPlan(undefined);
            setApproved(false);
          }}>
            <option value="">Choose an accepted source</option>
            {value?.sources.map((source) => <option key={source.id} value={source.id}>{source.title || source.url}</option>)}
          </select>
        </label>
        <label>Provider
          <select aria-label="Connector provider" className={field} value={provider} onChange={(event) => { setProvider(event.target.value); setInputFormat(""); }}>
            <option value="">Choose shared provider</option>
            {providers.map((row) => <option key={providerKey(row)} value={providerKey(row)}>{String(row.name ?? row.label ?? providerKey(row))}</option>)}
          </select>
        </label>
        <label>Input format
          <select aria-label="Connector input format" className={field} value={inputFormat} onChange={(event) => setInputFormat(event.target.value)}>
            <option value="">Provider discovery default</option>
            {(Array.isArray(selectedProvider?.formats) ? selectedProvider.formats : []).map((format: unknown) => {
              const row = dataObject(format);
              const name = typeof format === "string" ? format : String(row.key ?? row.input_format ?? row.id ?? "");
              return <option key={name} value={name}>{String(row.label ?? name)}</option>;
            })}
          </select>
        </label>
        <label>Source mode
          <select aria-label="Connector source mode" className={field} value={mode} onChange={(event) => setMode(event.target.value as "live" | "saved")}>
            <option value="saved">Saved capture only, no live discovery</option>
            <option value="live">Configured live discovery</option>
          </select>
        </label>
        <label>From date, inclusive<input aria-label="Connector from date" className={field} type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
        <label>Through date, inclusive<input aria-label="Connector through date" className={field} type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
      </div>
      <details><summary>Source identity and provider options</summary>
        <p>Use the provider's exact namespace and documented options. Credentials are configured separately by the service operator.</p>
        <label>Source namespace (optional)<input aria-label="Connector namespace" className={field} value={namespace} onChange={(event) => setNamespace(event.target.value)} /></label>
        <label>Provider options JSON<textarea aria-label="Connector options" className={field} value={options} onChange={(event) => setOptions(event.target.value)} /></label>
      </details>
      {selectedProvider ? <details><summary>Shared provider capability evidence</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(selectedProvider, null, 2)}</pre></details> : null}
      <label><input type="checkbox" checked={writeEnabled} onChange={(event) => setWriteEnabled(event.target.checked)} disabled={value?.role !== "owner"} /> Explicitly allow authorized provider planning/commit for this source (owner only; service policy still applies)</label>
      <p><button type="button" className="btn quiet" disabled={busy || !current || !provider || value?.role !== "owner"} onClick={() => action(async () => {
        const response = await decodeConnectorResponse<{ saved: boolean; result: OperationResult }>(configureCivicConnectorSource({ data: {
          sourceId: Number(sourceId), source: { provider, url: current!.url, ...(inputFormat ? { input_format: inputFormat } : {}),
            ...(namespace.trim() ? { namespace: namespace.trim() } : {}), options: JSON.parse(options) },
          bounds: dates(), mode, writeEnabled,
        } }));
        setResult(response.result);
        setMessage(response.saved ? "Connector source configuration saved." : "Source validation did not complete.");
        setPlan(undefined);
        setApproved(false);
      })}>Save connector configuration</button></p>
      <label>Saved provider capture (HTML, JSON, PDF or iCalendar; maximum 16 MiB)
        <input aria-label="Connector saved capture" type="file" onChange={(event) => {
          const file = event.target.files?.[0];
          setContentBase64(undefined);
          if (!file) return;
          if (file.size > 16 * 1024 * 1024) { setMessage("Saved parser input exceeds 16 MiB."); return; }
          const reader = new FileReader();
          reader.onload = () => setContentBase64(String(reader.result).split(",")[1]);
          reader.onerror = () => setMessage("Could not read the selected saved capture.");
          reader.readAsDataURL(file);
        }} />
      </label>
      <p style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="btn quiet" disabled={busy || !sourceId} onClick={() => read(true)}>Preview capture</button>
        <button type="button" className="btn solid" disabled={busy || !sourceId} onClick={() => read(false)}>Discover and save evidence</button>
        <button type="button" className="btn quiet" disabled={busy || !sourceId} onClick={() => read(false, "fetch")}>Retrieve and save capture</button>
      </p>
      <details><summary>Authorized account fetch fields</summary>
        <p>Account reads require a separately configured, namespace-bound service credential. Enter documented request fields only; do not enter credentials. Ordinary date and body filters do not apply.</p>
        <label>Provider fetch fields JSON<textarea aria-label="Connector fetch fields" className={field} value={fetchFields} onChange={(event) => setFetchFields(event.target.value)} /></label>
      </details>
      <fieldset>
        <legend>Search this source's captured evidence, not the live web</legend>
        <label>Exact term<input aria-label="Connector exact term" className={field} value={term} onChange={(event) => setTerm(event.target.value)} /></label>
        <label>Exact phrase<input aria-label="Connector exact phrase" className={field} value={phrase} onChange={(event) => setPhrase(event.target.value)} /></label>
        <label>Body filter<input aria-label="Connector body filter" className={field} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        <label>Record type filter<input aria-label="Connector record type filter" className={field} value={recordType} onChange={(event) => setRecordType(event.target.value)} /></label>
        <button type="button" className="btn quiet" disabled={busy || !sourceId} onClick={() => action(async () => setResult(await decodeConnectorResponse<OperationResult>(searchCivicConnectorEvidence({ data: {
          sourceId: Number(sourceId), terms: term ? [term] : [], phrases: phrase ? [phrase] : [], ...dates(),
          ...(body ? { body } : {}), ...(recordType ? { record_types: [recordType] } : {}),
        } }))))}>Search captured evidence</button>
      </fieldset>
      {message ? <p role="status">{message}</p> : null}
      {result ? <details open><summary>Operation: {result.status}</summary><pre data-testid="connector-result" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 500, overflow: "auto" }}>{JSON.stringify(result, null, 2)}</pre></details> : null}
      <h3>Saved cited evidence</h3>
      {value?.evidence.map((row) => (
        <article key={row.id} data-testid="connector-evidence">
          <h4>{String(row.record_json.normalized.title ?? row.record_json.identity.external_id)}</h4>
          <p><a href={/^https?:\/\//i.test(row.record_json.source_url) ? row.record_json.source_url : undefined} target="_blank" rel="noreferrer">Original citation</a> · {row.record_json.identity.provider} · {row.record_json.identity.namespace}</p>
          <p>{row.record_json.text?.length ? "Supplied text available; inspect its completeness and anchors." : "Metadata only. No complete document text or transcript."}</p>
          <p style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" className="btn quiet" disabled={busy} onClick={() => action(async () => setOpened(await decodeConnectorResponse<unknown>(reopenCivicConnectorEvidence({ data: row.id }))))}>Reopen cited evidence</button>
            <button type="button" className="btn quiet" disabled={busy} onClick={() => action(async () => {
              const filed = await fileCivicConnectorLead({ data: row.id });
              setMessage(`Review lead ${filed.leadId} ${filed.unchanged ? "already exists" : "filed"}. Nothing published.`);
            })}>File review lead</button>
            {(["json", "jsonl", "zip", "csv", "icalendar"] as const).map((format) =>
              <button key={format} type="button" className="btn quiet" disabled={busy} onClick={() => action(async () => {
                const exported = await decodeConnectorResponse<OperationResult>(exportCivicConnectorEvidence({ data: { importId: row.import_id, format } }));
                setResult(exported);
                const data = dataObject(exported.data);
                if (typeof data.content_base64 !== "string") return;
                const bytes = Uint8Array.from(atob(data.content_base64), (character) => character.charCodeAt(0));
                const link = document.createElement("a");
                const url = URL.createObjectURL(new Blob([bytes], { type: String(data.content_type ?? "application/octet-stream") }));
                link.href = url;
                link.download = `civic-evidence.${format === "icalendar" ? "ics" : format}`;
                link.click();
                URL.revokeObjectURL(url);
              })}>Export {format}</button>)}
          </p>
        </article>
      ))}
      {opened ? <details open><summary>Reopened saved record, coverage and citation</summary><pre data-testid="connector-reopened" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 500, overflow: "auto" }}>{JSON.stringify(opened, null, 2)}</pre></details> : null}
      {value?.runs.length ? <details><summary>Recent incomplete or failed source operations</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(value.runs, null, 2)}</pre></details> : null}
      {value?.role === "owner" && writeEnabled ? <details><summary>Separate authorized provider operation (never publication)</summary>
        <p>This candidate uses synthetic writes only. Configure supported native fields from the shared capability evidence. Review the exact plan before approving.</p>
        <label>Changes JSON<textarea aria-label="Connector provider changes" className={field} rows={5} value={changes} onChange={(event) => { setChanges(event.target.value); setPlan(undefined); setApproved(false); }} /></label>
        <button type="button" className="btn quiet" disabled={busy || !sourceId} onClick={() => action(async () => {
          const response = await decodeConnectorResponse<OperationResult>(writeCivicConnectorSource({ data: { sourceId: Number(sourceId), action: "plan", input: { changes: JSON.parse(changes) } } }));
          setResult(response);
          const data = dataObject(response.data);
          if (typeof data.plan_id === "string" && typeof data.plan_hash === "string") setPlan({ plan_id: data.plan_id, plan_hash: data.plan_hash });
          setApproved(false);
        })}>Plan provider operation</button>
        {plan ? <><p>Exact plan: <code>{plan.plan_id}</code>, hash <code style={{ overflowWrap: "anywhere" }}>{plan.plan_hash}</code></p>
          <label><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /> I authorize this exact plan, target and values.</label>
          <button type="button" className="btn quiet" disabled={busy || !approved} onClick={() => action(async () => setResult(await decodeConnectorResponse<OperationResult>(writeCivicConnectorSource({ data: { sourceId: Number(sourceId), action: "commit", input: { ...plan, approved } } }))))}>Commit exact provider plan</button>
          <button type="button" className="btn quiet" disabled={busy} onClick={() => action(async () => setResult(await decodeConnectorResponse<OperationResult>(writeCivicConnectorSource({ data: { sourceId: Number(sourceId), action: "receipt", input: { plan_id: plan.plan_id } } }))))}>Read receipt</button>
        </> : null}
      </details> : null}
    </details>
  );
}
