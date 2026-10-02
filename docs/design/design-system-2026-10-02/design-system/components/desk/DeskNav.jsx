import React from 'react';
export function DeskNav({ items, active, onNavigate, running = [], themeLabel = 'Light', onToggleTheme }) {
  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 230, minHeight: '100%', padding: '20px 14px', boxSizing: 'border-box', background: 'var(--panel)', borderRight: '1px solid var(--line)', fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 10px 18px' }}><b style={{ fontWeight: 800, fontSize: 24, letterSpacing: '-.03em' }}>TownReporter</b><span style={{ alignSelf: 'flex-start', fontSize: 14, fontWeight: 700, background: 'var(--yel)', color: '#111', padding: '2px 8px' }}>Editor’s desk</span></div>
      {running.length ? (
        <button type="button" onClick={() => onNavigate && onNavigate('Today')} style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '0 0 10px', padding: '10px 12px', border: '2px solid var(--yel)', background: 'transparent', color: 'var(--ink)', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit' }}>
          <b style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 15 }}><span style={{ width: 10, height: 10, background: 'var(--yel)', animation: 'trPulse 1.2s ease-in-out infinite' }} />Running · {running.length}</b>
          {running.slice(0, 3).map((j, i) => <span key={i} style={{ fontSize: 14, lineHeight: 1.3 }}><b>{j.title}</b><br /><span style={{ color: 'var(--ink2)' }}>{j.line}</span></span>)}
        </button>) : null}
      {items.map((it) => (
        <button key={it.label} type="button" onClick={() => onNavigate && onNavigate(it.label)} aria-current={it.label === active ? 'page' : undefined} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, padding: '0 12px', border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 16, color: 'var(--ink)', background: it.label === active ? 'var(--bg)' : 'transparent', boxShadow: it.label === active ? 'inset 4px 0 0 var(--sel, var(--yel))' : 'none', textAlign: 'left' }}>
          <span>{it.label}</span><span style={{ fontSize: 14, color: 'var(--ink2)' }}>{it.count || ''}</span>
        </button>))}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 18, borderTop: '1px solid var(--line)' }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 12px', border: '2px solid var(--ink)', color: 'var(--ink)', fontWeight: 700, fontSize: 15, textDecoration: 'none' }}>View the paper ↗</a>
        <button type="button" onClick={onToggleTheme} style={{ minHeight: 44, border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', fontWeight: 700, fontSize: 15, cursor: 'pointer', fontFamily: 'inherit' }}>{themeLabel}</button>
      </div>
    </nav>
  );
}
