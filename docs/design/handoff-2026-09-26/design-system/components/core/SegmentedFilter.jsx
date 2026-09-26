import React from 'react';
export function SegmentedFilter({ options, value, onChange }) {
  return (
    <div role="group" style={{ display: 'inline-flex', flexWrap: 'wrap', border: '1px solid var(--line)' }}>
      {options.map((o) => {
        const on = o.value === value;
        return <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange && onChange(o.value)} style={{ minHeight: 44, padding: '0 14px', border: 0, borderRadius: 0, cursor: 'pointer', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--bg)' : 'var(--ink)' }}>{o.label}</button>;
      })}
    </div>
  );
}
