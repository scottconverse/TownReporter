#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cuePattern = /\b(?:i\s+(?:move|would\s+move)|motion\s+(?:to|by|passes|fails|carries|carried)|second(?:ed)?\s+(?:the\s+)?motion|all\s+in\s+favor|all\s+opposed|ayes?\s+have\s+it|that\s+(?:carries|passes|fails)|carried\s+(?:unanimously|by)|without\s+objection|roll\s+call|vote(?:d|s)?|passes|fails|unanimous(?:ly)?|future\s+agenda|direction\s+to\s+staff|consent\s+agenda|annexation|hospitality)\b/i;
const timePattern = /\b(?:(?:\d{1,2}:)?\d{1,2}:\d{2})\b/;

export function scaffold(text, { chunkLines = 80, meeting = 'unspecified meeting' } = {}) {
  if (!Number.isInteger(chunkLines) || chunkLines < 1) throw new Error('chunkLines must be a positive integer');
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const chunks = [];
  const cues = [];
  for (let start = 0; start < lines.length; start += chunkLines) {
    const end = Math.min(lines.length, start + chunkLines);
    const segment = lines.slice(start, end);
    const times = segment.map((line) => line.match(timePattern)?.[0]).filter(Boolean);
    const chunkId = `chunk-${chunks.length + 1}`;
    chunks.push({ id: chunkId, startLine: start + 1, endLine: end, startTime: times[0] ?? null, endTime: times.at(-1) ?? null, reviewed: false, gap: null });
    segment.forEach((line, offset) => {
      if (!cuePattern.test(line)) return;
      cues.push({ id: `cue-${cues.length + 1}`, chunkId, line: start + offset + 1, timestamp: line.match(timePattern)?.[0] ?? null, excerpt: line.trim().slice(0, 300), disposition: 'unresolved', actionId: null });
    });
  }
  return {
    meeting,
    warning: 'Cue detection is only a finding aid. Read every transcript line or recording range before marking reviewed.',
    chunks,
    cues,
    actions: [],
    reconciliation: { agendaCompared: false, minutesStatus: 'not checked', unexplainedMismatches: [] },
    reviewerAttestation: { fullChronologicalReview: false, allSubstantiveActionsLogged: false },
  };
}

function parse(args) {
  const result = { chunkLines: 80 };
  for (let i = 0; i < args.length; i++) {
    if (['--input', '--output', '--meeting', '--chunk-lines'].includes(args[i])) {
      const key = { '--input': 'input', '--output': 'output', '--meeting': 'meeting', '--chunk-lines': 'chunkLines' }[args[i]];
      result[key] = args[++i];
    } else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (!result.input || !result.output) throw new Error('Usage: node scripts/transcript-ledger.mjs --input transcript.txt --output coverage.json [--meeting NAME] [--chunk-lines 80]');
  result.chunkLines = Number(result.chunkLines);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2));
    const ledger = scaffold(readFileSync(options.input, 'utf8'), options);
    writeFileSync(options.output, JSON.stringify(ledger, null, 2) + '\n');
    console.log(`Created ${ledger.chunks.length} unreviewed chunks and ${ledger.cues.length} unresolved cues at ${options.output}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
