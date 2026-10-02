import React from 'react';
const link = { display: 'flex', alignItems: 'center', minHeight: 44, color: 'var(--ink)', fontWeight: 700, fontSize: 15, textDecoration: 'underline', textDecorationColor: 'var(--yel)', textDecorationThickness: 3, textUnderlineOffset: 4 };
export function SourceCard({ role, title, host, captured, currentHref, capturedHref, compareHref }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '20px 22px', background: 'var(--bg)', fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
      <span style={{ fontSize: 14, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink2)' }}>{role}</span>
      <b style={{ fontSize: 19, lineHeight: 1.25 }}>{title}</b>
      <span style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--ink2)' }}>{host}{captured ? ' · Captured ' + captured : ''}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 18px', marginTop: 'auto' }}>
        <a href={currentHref} style={link}>Current source</a>
        {capturedHref ? <a href={capturedHref} style={link}>View captured version</a> : null}
        {compareHref ? <a href={compareHref} style={link}>Compare versions</a> : null}
      </div>
    </div>
  );
}
