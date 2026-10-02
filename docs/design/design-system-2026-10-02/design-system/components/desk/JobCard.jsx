import React from 'react';
const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.max(0, s) % 60).padStart(2, '0');
export function JobCard({ job, compact, stallSeconds = 60, onCancel, onOpen, onRetry, onRetryNext, onKeepWaiting, now }) {
  const [, tick] = React.useState(0);
  React.useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  const t = now || Date.now();
  const running = job.state === 'running';
  const elapsed = Math.floor(((job.endedAt || t) - job.startedAt) / 1000);
  const quiet = job.beatAt ? Math.floor((t - job.beatAt) / 1000) : 0;
  const stalled = running && quiet >= stallSeconds;
  const col = job.state === 'done' ? 'var(--ok)' : job.state === 'failed' ? 'var(--danger)' : stalled ? 'var(--warn)' : 'var(--yel)';
  const btn = { minHeight: 44, padding: '0 12px', fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, cursor: 'pointer', borderRadius: 0, background: 'transparent', color: 'var(--ink)' };
  const primary = { ...btn, background: 'var(--yel)', color: '#111', border: 0, fontWeight: 800 };
  return (
    <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: compact ? 8 : 10, padding: compact ? 12 : 16, background: 'var(--panel)', border: '1px solid var(--line)', borderLeft: '4px solid ' + col, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
          <span className="tr-pulse" style={{ width: 12, height: 12, flex: 'none', background: col, animation: running && !stalled ? 'trPulse 1.2s ease-in-out infinite' : 'none' }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><b style={{ fontSize: 16 }}>{job.title}</b><span style={{ fontSize: 14, color: 'var(--ink2)' }}>{job.model}{job.pct != null && running ? ' · ' + job.pct + '%' : ''}</span></span>
        </div>
        <b style={{ fontSize: 16, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{job.state === 'done' ? 'Done ' : job.state === 'failed' ? 'Stopped ' : ''}{fmt(elapsed)}</b>
      </div>
      {!compact && job.stages && job.stages.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 6px' }}>
          {job.stages.map((s, i) => { const done = i < job.stage || job.state === 'done'; const cur = i === job.stage && running;
            return <span key={i} style={{ fontSize: 14, fontWeight: 700, padding: '1px 7px', ...(cur ? { background: 'var(--yel)', color: '#111' } : done ? { color: 'var(--ok)', border: '1px solid var(--ok)' } : { color: 'var(--ink2)', border: '1px dashed var(--line)' }) }}>{done ? '✓ ' : ''}{s}</span>; })}
        </div>) : null}
      <div style={{ position: 'relative', height: 8, background: 'var(--line)', overflow: 'hidden' }}>
        {job.pct != null || !running
          ? <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: (job.state === 'done' ? 100 : job.pct || 0) + '%', background: col, transition: 'width .6s' }} />
          : <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '33%', background: col, animation: stalled ? 'none' : 'trSlide 1.4s linear infinite' }} />}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px', fontSize: 14 }}>
        <b style={{ color: job.state === 'failed' ? 'var(--danger)' : 'var(--ink)' }}>{job.state === 'failed' ? job.error : job.state === 'done' ? job.result : 'Now: ' + job.now}</b>
        {running && !stalled ? <span style={{ color: 'var(--ink2)' }}>Last activity {fmt(quiet)} ago</span> : null}
      </div>
      {stalled ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', border: '2px solid var(--warn)' }}>
          <b style={{ fontSize: 15, color: 'var(--warn)' }}>No activity for {fmt(quiet)}. The model may be slow, or it may have stalled.</b>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><button type="button" onClick={onKeepWaiting} style={{ ...btn, border: '2px solid var(--ink)', minHeight: 44 }}>Keep waiting</button><button type="button" onClick={onRetryNext} style={{ ...primary, minHeight: 44 }}>Retry on next model</button></div>
        </div>) : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {running ? <button type="button" onClick={onCancel} style={{ ...btn, border: '2px solid var(--danger)', color: 'var(--danger)' }}>Cancel</button> : null}
        {job.state === 'done' ? <button type="button" onClick={onOpen} style={primary}>{job.openLabel || 'Open result'}</button> : null}
        {job.state === 'failed' ? <><button type="button" onClick={onRetry} style={primary}>Retry</button><button type="button" onClick={onRetryNext} style={{ ...btn, border: '2px solid var(--ink)' }}>Retry on another model</button></> : null}
      </div>
    </div>
  );
}
