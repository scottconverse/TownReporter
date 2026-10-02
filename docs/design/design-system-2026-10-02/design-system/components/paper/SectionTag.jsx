import React from 'react';
export function SectionTag({ children }) {
  return <span style={{ alignSelf: 'flex-start', display: 'inline-block', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, background: 'var(--yel)', color: '#111', padding: '3px 10px' }}>{children}</span>;
}
