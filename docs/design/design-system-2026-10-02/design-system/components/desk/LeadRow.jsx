import React from 'react';
import { ScoreBadge } from './ScoreBadge.jsx';
import { EvidenceMeter } from './EvidenceMeter.jsx';
import { Chip } from '../core/Chip.jsx';
import { Button } from '../core/Button.jsx';
export function LeadRow({ lead, selected, status, onStart, onHold, onKill, onUndo, onSelect }) {
  const done = status === 'held' || status === 'killed';
  return (
    <div onClick={onSelect} style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) auto', gap: '10px 18px', padding: '18px 12px', borderBottom: '1px solid var(--line)', background: selected ? 'var(--panel)' : 'transparent', boxShadow: selected ? 'inset 4px 0 0 var(--sel, var(--yel))' : 'none', opacity: done ? 0.6 : 1, fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
      <ScoreBadge score={lead.score} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{(lead.chips || []).map((c, i) => <Chip key={i} kind={c.kind}>{c.label}</Chip>)}</div>
        <span style={{ fontWeight: 700, fontSize: 19, lineHeight: 1.25, textDecoration: status === 'killed' ? 'line-through' : 'none' }}>{lead.title}</span>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.45, color: 'var(--ink2)' }}>{lead.why}</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', alignItems: 'center', fontSize: 14, color: 'var(--ink2)' }}><EvidenceMeter opened={lead.opened} failed={lead.failed} /><span>· {lead.meta}</span></span>
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {done ? (<><b style={{ fontSize: 15, alignSelf: 'center' }}>{status === 'held' ? 'Held' : 'Killed'}</b><Button onClick={onUndo}>Undo</Button></>)
          : (<><Button variant="primary" keyHint="S" onClick={onStart}>Start story</Button><Button keyHint="H" onClick={onHold}>Hold</Button><Button variant="danger" keyHint="X" onClick={onKill}>Kill</Button></>)}
      </div>
    </div>
  );
}
