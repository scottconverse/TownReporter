export function DraftScopePicker({ value, onChange, disabled }: { value: "public" | "supplied"; onChange: (value: "public" | "supplied") => void; disabled?: boolean }) {
  return <label className="block text-sm">
    <span>Drafting scope</span>
    <select className="block mt-1" value={value} disabled={disabled} onChange={e => onChange(e.target.value === "supplied" ? "supplied" : "public")}>
      <option value="public">Research public sources</option>
      <option value="supplied">Use only supplied material</option>
    </select>
    <span className="block mt-1">{value === "supplied" ? "Reads your text and opens only URLs you supply. No discovery or external searches. Choose Claude or a local/API model; Codex does not support this scope." : "Follows supplied links and searches for relevant public evidence. Use the scope control, not instructions inside pasted material, to limit research."}</span>
  </label>;
}
