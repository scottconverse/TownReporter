#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkCoverage(ledger) {
  const gaps = [];
  if (!Array.isArray(ledger.chunks) || ledger.chunks.length === 0) gaps.push('no transcript chunks');
  if (!Array.isArray(ledger.cues)) gaps.push('cue inventory missing');
  if (!Array.isArray(ledger.actions)) gaps.push('action inventory missing');
  for (const chunk of ledger.chunks ?? []) {
    if (chunk.reviewed !== true || chunk.gap) gaps.push(`${chunk.id}: unreviewed or gap recorded`);
  }
  for (const cue of ledger.cues ?? []) {
    if (!['action', 'routine', 'duplicate', 'not-action'].includes(cue.disposition)) gaps.push(`${cue.id}: unresolved cue`);
    if (cue.disposition === 'action' && !ledger.actions?.some((action) => action.action_id === cue.actionId)) gaps.push(`${cue.id}: action row missing`);
  }
  for (const action of ledger.actions ?? []) {
    for (const key of ['action_id', 'timestamp', 'agenda_item', 'motion_or_action', 'outcome', 'vote', 'policy_stage', 'evidence', 'disposition']) {
      if (!action[key]) gaps.push(`${action.action_id ?? 'unnamed action'}: missing ${key}`);
    }
    if (action.timestamp === 'unknown') gaps.push(`${action.action_id}: timestamp unresolved`);
    if (action.vote === 'unverified') gaps.push(`${action.action_id}: vote unverified`);
    if (action.outcome === 'unresolved' || action.disposition === 'unresolved') gaps.push(`${action.action_id}: action unresolved`);
  }
  if (ledger.reconciliation?.agendaCompared !== true) gaps.push('agenda comparison incomplete');
  if (!ledger.reconciliation?.minutesStatus || ledger.reconciliation.minutesStatus === 'not checked') gaps.push('minutes status unchecked');
  if (ledger.reconciliation?.unexplainedMismatches?.length) gaps.push('unexplained agenda/minutes mismatches');
  if (ledger.reviewerAttestation?.fullChronologicalReview !== true) gaps.push('full chronological review not attested');
  if (ledger.reviewerAttestation?.allSubstantiveActionsLogged !== true) gaps.push('all substantive actions not attested');
  return { readyForEditorialReview: gaps.length === 0, gaps };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/check-coverage.mjs coverage.json');
    const result = checkCoverage(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log(result.readyForEditorialReview ? 'READY FOR EDITORIAL REVIEW (mechanical checks passed; semantic completeness still needs human judgment)' : `PARTIAL: ${result.gaps.join('; ')}`);
    if (!result.readyForEditorialReview) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
