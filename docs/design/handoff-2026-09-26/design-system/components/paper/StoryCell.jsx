import React from 'react';
export function StoryCell({ section, title, date, read, href = '#' }) {
  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '26px 32px', background: 'var(--bg)', fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
      <span style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>{section}</span>
      <a href={href} style={{ margin: 0, fontWeight: 700, fontSize: 23, lineHeight: 1.15, letterSpacing: '-.01em', color: 'var(--ink)', textDecoration: 'none', textWrap: 'balance' }}>{title}</a>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--ink2)' }}>{date} · {read} read</span>
    </article>
  );
}
export function StoryGrid({ children, columns = 3 }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(' + columns + ',minmax(0,1fr))', gap: 1, background: 'var(--grid)' }}>{children}</div>;
}
