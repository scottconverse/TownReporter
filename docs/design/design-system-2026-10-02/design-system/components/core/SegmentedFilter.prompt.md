A filter row for list screens (Queue, Drafts, Follow-ups, Sources, Published). The selected segment is ink-filled.

```jsx
<SegmentedFilter value={f} onChange={setF} options={[{ value: 'open', label: 'Open · 12' }, { value: 'held', label: 'Held · 3' }]} />
```

**Props and rules**
- `options`: `{ value, label }[]`; put the count in the label
- `value`, `onChange(value)`
- Each segment is at least 44px tall and uses `aria-pressed`
