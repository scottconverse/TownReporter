import React from 'react';
const K = {
  new: { background: 'var(--yel)', color: '#111' },
  changed: { background: 'var(--yel)', color: '#111' },
  ok: { border: '1px solid var(--ok)', color: 'var(--ok)' },
  absent: { background: 'var(--ink)', color: 'var(--bg)' },
  fail: { border: '2px dashed var(--danger)', color: 'var(--danger)' },
  warn: { border: '2px solid var(--warn)', color: 'var(--warn)' },
  printed: { border: '1px dashed var(--ink2)', color: 'var(--ink2)' },
  neutral: { border: '1px solid var(--ink2)', color: 'var(--ink2)' },
};
export function Chip({ kind = 'neutral', children, style }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', alignSelf: 'flex-start', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 800, padding: '1px 8px', whiteSpace: 'nowrap', boxSizing: 'border-box', ...K[kind], ...style }}>{children}</span>;
}
