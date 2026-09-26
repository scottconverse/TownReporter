import React from 'react';
export function ScoreBadge({ score, label = true }) {
  const s = score >= 14 ? { background: 'var(--yel)', color: '#111' } : score >= 10 ? { border: '2px solid var(--ink)' } : { border: '1px solid var(--line)' };
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, fontFamily: 'var(--font-display)' }}>
      <span style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 20, fontVariantNumeric: 'tabular-nums', boxSizing: 'border-box', ...s }}>{score}</span>
      {label ? <span style={{ fontSize: 14, color: 'var(--ink2)' }}>score</span> : null}
    </span>
  );
}
