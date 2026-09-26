import React from 'react';
export function DatesPanel({ title = 'This week', items, footLink }) {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', padding: '28px 32px', background: 'var(--block)', color: 'var(--block-ink)', fontFamily: 'var(--font-display)' }}>
      <span style={{ fontWeight: 800, fontSize: 28, letterSpacing: '-.02em', color: 'var(--yel)', marginBottom: 8 }}>{title}</span>
      {items.map((d, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', gap: 14, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.18)' }}>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}><b style={{ fontSize: 14, color: 'var(--yel)' }}>{d.dow}</b><b style={{ fontSize: 24, fontWeight: 800 }}>{d.day}</b></span>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.4 }}>{d.what}</span>{d.note ? <span style={{ fontSize: 14, opacity: .8 }}>{d.note}</span> : null}</span>
        </div>))}
      {footLink ? <a href={footLink.href} style={{ marginTop: 16, fontSize: 15, fontWeight: 700, color: 'var(--yel)' }}>{footLink.label}</a> : null}
    </aside>
  );
}
