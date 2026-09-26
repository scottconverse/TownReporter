import React from 'react';
export function EvidenceMeter({ opened = 0, failed = 0 }) {
  const sq = [];
  for (let i = 0; i < opened; i++) sq.push(<i key={'o' + i} style={{ width: 12, height: 12, background: 'var(--ink)' }} />);
  for (let i = 0; i < failed; i++) sq.push(<i key={'f' + i} style={{ width: 12, height: 12, boxSizing: 'border-box', border: '2px solid var(--danger)' }} />);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-display)', fontSize: 14 }}>
      <span aria-hidden="true" style={{ display: 'inline-flex', gap: 3 }}>{sq}</span>
      <b>{opened} opened{failed ? ' · ' + failed + ' could not open' : ''}</b>
    </span>
  );
}
