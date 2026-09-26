import React from 'react';
const ORDER = ['Longmont', 'Nearby', 'Boulder County', 'Colorado'];
export function GeoPills({ active = 'Longmont', places = ORDER, hrefFor = () => '#' }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700 }}>
      {places.map((p) => { const on = p === active;
        return <a key={p} href={hrefFor(p)} aria-current={on ? 'page' : undefined} style={{ display: 'flex', alignItems: 'center', minHeight: 44, padding: on ? '0 14px' : '0 12px', boxSizing: 'border-box', textDecoration: 'none', ...(on ? { background: 'var(--ink)', color: 'var(--bg)' } : { border: '2px solid var(--ink)', color: 'var(--ink)' }) }}>{p}</a>; })}
    </div>
  );
}
