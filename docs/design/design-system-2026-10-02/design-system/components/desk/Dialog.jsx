import React from 'react';
export function Dialog({ open, title, subtitle, children, footNote, primaryLabel, onPrimary, altLabel, onAlt, onClose }) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && onClose) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '60px 24px', background: 'rgba(10,9,8,.62)', overflowY: 'auto' }}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} style={{ width: 820, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 18, padding: '26px 28px 24px', background: 'var(--bg)', color: 'var(--ink)', border: '2px solid var(--ink)', boxShadow: '0 20px 50px rgba(0,0,0,.45)', fontFamily: 'var(--font-display)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}><span style={{ fontWeight: 800, fontSize: 28, letterSpacing: '-.02em', lineHeight: 1.1 }}>{title}</span>{subtitle ? <span style={{ fontSize: 15, color: 'var(--ink2)', lineHeight: 1.4 }}>{subtitle}</span> : null}</div>
          <button type="button" aria-label="Close" onClick={onClose} style={{ minWidth: 44, minHeight: 44, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>
        {children}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 14, color: 'var(--ink2)', flex: '1 1 280px' }}>{footNote}</span>
          <div style={{ display: 'grid', gridAutoFlow: 'column', gap: 8 }}>
            <button type="button" onClick={onClose} style={{ minHeight: 48, padding: '0 16px', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>Cancel</button>
            {altLabel ? <button type="button" onClick={onAlt} style={{ minHeight: 48, padding: '0 16px', border: '2px solid var(--ink)', background: 'transparent', color: 'var(--ink)', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>{altLabel}</button> : null}
            <button type="button" onClick={onPrimary} style={{ minHeight: 48, padding: '0 20px', border: 0, background: 'var(--yel)', color: '#111', fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>{primaryLabel}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
export function ChoiceCard({ label, note, selected, onSelect }) {
  return (
    <button type="button" role="radio" aria-checked={selected} onClick={onSelect} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 14px', textAlign: 'left', cursor: 'pointer', color: 'var(--ink)', background: selected ? 'var(--panel)' : 'transparent', border: selected ? '2px solid var(--ink)' : '1px solid var(--line)', fontFamily: 'var(--font-display)', width: '100%' }}>
      <span style={{ width: 18, height: 18, flex: 'none', marginTop: 2, boxSizing: 'border-box', border: '2px solid var(--ink)', background: selected ? 'var(--yel)' : 'transparent' }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><b style={{ fontSize: 16 }}>{label}</b>{note ? <span style={{ fontSize: 14, color: 'var(--ink2)' }}>{note}</span> : null}</span>
    </button>
  );
}
