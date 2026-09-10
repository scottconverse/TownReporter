import { useState, type FormEvent } from "react";
import { Field, InkButton, inputClass } from "./desk-chrome";
import type {
  CustomAiConnectionInput,
  PublicCustomAiConnection,
  ConnectionProbeResult,
} from "@/lib/news/custom-ai-settings";
import { capabilityStatus, managementActionsLocked } from "@/lib/news/custom-ai-settings";

type Props = {
  connections: PublicCustomAiConnection[];
  onSave(input: CustomAiConnectionInput & { id?: string }): Promise<void>;
  onDiscover(id: string): Promise<string[]>;
  onTest(id: string): Promise<ConnectionProbeResult>;
  onEnable(id: string, enabled: boolean): Promise<void>;
  onDelete(id: string): Promise<void>;
};

export function CustomAiConnections({
  connections,
  onSave,
  onDiscover,
  onTest,
  onEnable,
  onDelete,
}: Props) {
  const [form, setForm] = useState<CustomAiConnectionInput>({
    name: "",
    baseUrl: "",
    apiKey: "",
    modelId: "",
  });
  const [editingId, setEditingId] = useState<string | undefined>();
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const locked = managementActionsLocked(busy, busyAction);
  async function act(key: string, work: () => Promise<void>) {
    setBusyAction(key);
    setResult(null);
    try {
      await work();
    } catch (e) {
      setResult(e instanceof Error ? e.message : "That action could not be completed.");
    } finally {
      setBusyAction(null);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      await onSave({ ...form, id: editingId });
      setEditingId(undefined);
      setModels([]);
      setForm({ name: "", baseUrl: "", apiKey: "", modelId: "" });
      setResult("Connection saved. Your current model choice did not change.");
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Connection could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="custom-ai-heading" className="grid gap-4">
      <h2 id="custom-ai-heading">Add your own AI API</h2>
      <p className="meta">
        Connect an OpenAI-compatible endpoint, including LiteLLM. Saving does not call a model,
        spend provider credit, or change the desk default.
      </p>
      <p className="meta">
        Using LiteLLM?{" "}
        <a href="https://docs.litellm.ai/docs/proxy/quick_start" target="_blank" rel="noopener noreferrer" className="underline">
          Open the official setup guide (new tab)
        </a>
        . LiteLLM is optional and runs separately from TownReporter.
      </p>
      <form onSubmit={save} className="grid gap-4">
        <Field label="Connection name">
          <input
            className={inputClass}
            required
            maxLength={80}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Base URL">
          <input
            className={inputClass}
            required
            type="url"
            placeholder="http://127.0.0.1:4000/v1"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
        </Field>
        <Field
          label="API key (optional)"
          hint="Stored encrypted on the server. It is never shown again."
        >
          <input
            className={inputClass}
            type="password"
            autoComplete="new-password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value, removeApiKey: false })}
          />
        </Field>
        {editingId && (
          <label className="meta">
            <input
              type="checkbox"
              checked={form.removeApiKey === true}
              onChange={(e) =>
                setForm({
                  ...form,
                  removeApiKey: e.target.checked,
                  apiKey: e.target.checked ? "" : form.apiKey,
                })
              }
            />{" "}
            Remove the stored API key
          </label>
        )}
        <Field label="Model id (optional)">
          <input
            className={inputClass}
            value={form.modelId}
            onChange={(e) => setForm({ ...form, modelId: e.target.value })}
          />
        </Field>
        {!!models.length && (
          <Field label="Discovered models">
            <select
              className={inputClass}
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
            >
              <option value="">Choose a model</option>
              {models.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          <InkButton disabled={locked} type="submit">
            {busy ? "Saving…" : editingId ? "Save changes" : "Save connection"}
          </InkButton>
          {editingId && (
            <InkButton
              tone="ghost"
              disabled={locked}
              onClick={() => {
                setEditingId(undefined);
                setModels([]);
                setForm({ name: "", baseUrl: "", apiKey: "", modelId: "" });
              }}
            >
              Cancel edit
            </InkButton>
          )}
        </div>
      </form>
      {result && <p role="status">{result}</p>}
      {!connections.length && <p className="meta">No custom connections saved.</p>}
      {connections.map((row) => (
        <article key={row.id} className="border border-rule p-4 grid gap-3">
          <h3>{row.name}</h3>
          <p className="meta break-all">
            {row.baseUrl} · {row.modelId || "model not chosen"} ·{" "}
            {row.hasApiKey ? "key stored" : "no key"}
          </p>
          <div className="flex flex-wrap gap-2">
            <InkButton
              small
              tone="ghost"
              disabled={locked}
              onClick={() => {
                setEditingId(row.id);
                setModels([]);
                setForm({
                  name: row.name,
                  baseUrl: row.baseUrl,
                  apiKey: "",
                  modelId: row.modelId || "",
                });
                setResult("Editing this connection. Leave API key blank to keep the stored key.");
              }}
            >
              Edit
            </InkButton>
            <InkButton
              small
              tone="ghost"
              disabled={locked}
              onClick={() =>
                act(`discover-${row.id}`, async () => {
                  const found = await onDiscover(row.id);
                  setEditingId(row.id);
                  setModels(found);
                  setForm({
                    name: row.name,
                    baseUrl: row.baseUrl,
                    apiKey: "",
                    modelId: row.modelId || "",
                  });
                  setResult(
                    found.length
                      ? "Choose a discovered model, then save changes."
                      : "No models were reported; enter the model id manually.",
                  );
                })
              }
            >
              {busyAction === `discover-${row.id}` ? "Discovering…" : "Discover models"}
            </InkButton>
            <InkButton
              small
              tone="ghost"
              disabled={locked}
              onClick={() => {
                if (
                  !confirm(
                    "Testing sends a small prompt to this provider and may incur a charge. Continue?",
                  )
                )
                  return;
                void act(`test-${row.id}`, async () => {
                  const r = await onTest(row.id);
                  setResult(
                    `${r.ok ? "Success" : "Test failed"}: ${r.message} Chat completions: ${capabilityStatus(r.capabilities.chatCompletions)}; responses: ${capabilityStatus(r.capabilities.responses)}; model discovery: ${capabilityStatus(r.capabilities.modelDiscovery)}. (${r.latencyMs} ms)`,
                  );
                });
              }}
            >
              {busyAction === `test-${row.id}` ? "Testing…" : "Test connection"}
            </InkButton>
            <InkButton
              small
              tone="ghost"
              disabled={locked}
              onClick={() =>
                act(`enable-${row.id}`, async () => {
                  await onEnable(row.id, !row.enabled);
                  setResult(`${row.name} ${row.enabled ? "disabled" : "enabled"}.`);
                })
              }
            >
              {busyAction === `enable-${row.id}` ? "Saving…" : row.enabled ? "Disable" : "Enable"}
            </InkButton>
            <InkButton
              small
              tone="quiet-danger"
              disabled={locked}
              onClick={() => {
                if (confirm(`Delete ${row.name}? This cannot be undone.`))
                  void act(`delete-${row.id}`, async () => {
                    await onDelete(row.id);
                    setResult(`${row.name} deleted.`);
                  });
              }}
            >
              {busyAction === `delete-${row.id}` ? "Deleting…" : "Delete"}
            </InkButton>
          </div>
        </article>
      ))}
    </section>
  );
}
