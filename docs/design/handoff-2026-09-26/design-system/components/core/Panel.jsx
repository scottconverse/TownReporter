import React from 'react';
export function Panel({ title, meta, emphasis, stateColor, dark, children, style }) {
  const s = { display: 'flex', flexDirection: 'column', gap: 10, padding: 18, background: dark ? 'var(--dd)' : 'var(--panel)', color: dark ? 'var(--block-ink)' : 'var(--ink)', border: emphasis ? '2px solid var(--yel)' : '1px solid var(--line)', ...(stateColor ? { borderLeft: '4px solid ' + stateColor } : {}), fontFamily: 'var(--font-display)', boxSizing: 'border-box', ...style };
  return (
    <section style={s}>
      {title ? <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}><span style={{ fontWeight: 800, fontSize: 20 }}>{title}</span>{meta ? <span style={{ fontSize: 14, color: 'var(--ink2)' }}>{meta}</span> : null}</div> : null}
      {children}
    </section>
  );
}
