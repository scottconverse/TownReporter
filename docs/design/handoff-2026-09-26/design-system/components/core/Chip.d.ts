import * as React from 'react';
/** A state label. Always words; color only reinforces. "ok" (no change) and "fail" (could not check) must never be swapped. */
export interface ChipProps {
  /** new/changed = yellow · ok = ✓ supported/no change · absent = verified not found · fail = could not check (dashed red) · warn = needs review · printed = ≈ printed · neutral = waiting/paused */
  kind?: 'new' | 'changed' | 'ok' | 'absent' | 'fail' | 'warn' | 'printed' | 'neutral';
  children: React.ReactNode;
  style?: React.CSSProperties;
}
export function Chip(props: ChipProps): JSX.Element;
