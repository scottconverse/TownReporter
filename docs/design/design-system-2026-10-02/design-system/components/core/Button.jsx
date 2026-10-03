import React from 'react';
// Follows README §6 Buttons (updated 2026-10-02). Primary has a 2px #111 edge in light, fill-colored edge in dark (--yel-edge).
const BASE = { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 44, padding: '0 14px', fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, lineHeight: 1.2, cursor: 'pointer', background: 'transparent', color: 'var(--ink)', border: '2px solid transparent', borderRadius: 0, textDecoration: 'none', whiteSpace: 'nowrap', boxSizing: 'border-box' };
const VARIANTS = {
  primary: { background: 'var(--yel)', color: '#111', fontWeight: 800, border: '2px solid var(--yel-edge, #111)' },
  secondary: { border: '2px solid var(--ink)' },
  quiet: { border: '1px solid var(--ink2)' },
  danger: { border: '2px solid var(--danger)', color: 'var(--danger)' },
  gated: { border: '2px dashed var(--ink2)', color: 'var(--ink2)', cursor: 'not-allowed', fontWeight: 800 },
};
export function Button({ variant = 'secondary', size = 'md', keyHint, disabled, children, style, ...rest }) {
  const v = disabled && variant === 'primary' ? 'gated' : variant;
  const s = { ...BASE, ...VARIANTS[v], ...(size === 'lg' ? { minHeight: 48, padding: '0 20px', fontSize: 16 } : {}), ...(disabled && v !== 'gated' ? { opacity: 0.55, cursor: 'not-allowed' } : {}), ...style };
  return (
    <button type="button" disabled={disabled} aria-disabled={disabled} style={s} {...rest}>
      {children}
      {keyHint ? <span aria-hidden="true" style={{ fontSize: 14, fontWeight: 700, padding: '0 5px', border: '1px solid currentColor', lineHeight: 1.3 }}>{keyHint}</span> : null}
    </button>
  );
}
