import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleUrl } from './dom-harness.mjs';

const helperUrl = await moduleUrl('src/lib/news/desk-warning.ts');
const { deskWarning, withDeskOverride, bulkDeskWarnings, bulkDeskRetry, bulkWarningSentence } = await import(helperUrl);

test('deskWarning recognizes exact server warning envelopes and rejects malformed and plain refusals', () => {
  const warning = deskWarning({
    ok: false,
    warning: { key: 'lead-status-drafted', sentence: 'This lead already has a written draft.' },
    error: 'Warning',
  });
  assert.deepEqual(warning, {
    key: 'lead-status-drafted',
    sentence: 'This lead already has a written draft.',
  });
  assert.equal(deskWarning({ ok: false, error: 'Nope' }), null);
  assert.equal(deskWarning({ ok: false, warning: null, error: 'Nope' }), null);
  assert.equal(deskWarning({ ok: false, warning: { key: 7, sentence: 'x' }, error: 'Nope' }), null);
  assert.equal(deskWarning({ ok: false, warning: { key: 'k', sentence: '' }, error: 'Nope' }), null);
  assert.equal(deskWarning({ ok: true, warning: { key: 'k', sentence: 's' } }), null);
  assert.equal(deskWarning('plain refusal'), null);
  assert.equal(deskWarning(undefined), null);
});

test('withDeskOverride appends override keys, dedupes duplicates, and leaves the original payload untouched', () => {
  const request = {
    id: 42,
    status: 'killed',
    killReason: 'Duplicate',
    restore: 'drafted',
    override: ['other'],
  };
  const result = withDeskOverride(request, ['lead-status-drafted', 'lead-status-drafted']);
  assert.deepEqual(result, {
    id: 42,
    status: 'killed',
    killReason: 'Duplicate',
    restore: 'drafted',
    override: ['other', 'lead-status-drafted'],
  });
  assert.deepEqual(request.override, ['other']);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'lead-status-drafted'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'lead-status-published'), false);

  const bothResult = withDeskOverride(request, ['lead-status-drafted', 'lead-status-published']);
  assert.deepEqual(bothResult.override, ['other', 'lead-status-drafted', 'lead-status-published']);
  assert.deepEqual(request.override, ['other']);

  const deduped = withDeskOverride(
    { id: 7, override: ['lead-status-drafted', 'other', 'lead-status-drafted'] },
    ['other', 'lead-status-published'],
  );
  assert.deepEqual(deduped.override, ['lead-status-drafted', 'other', 'lead-status-published']);

  const withoutExisting = withDeskOverride({ id: 9 }, ['lead-status-published']);
  assert.deepEqual(withoutExisting, { id: 9, override: ['lead-status-published'] });
});

test('bulkDeskWarnings separates successes, rejections, plain failures, and mixed per-lead keys', async () => {
  const ids = [1, 2, 3, 4];
  const settled = await Promise.allSettled([
    Promise.resolve({ ok: true, id: 1 }),
    Promise.reject(new Error('network')),
    Promise.resolve({
      ok: false,
      warning: { key: 'lead-status-drafted', sentence: 'Already drafted.' },
      error: 'Warning',
    }),
    Promise.resolve({ ok: false, error: 'Plain failure' }),
  ]);
  const warnings = bulkDeskWarnings(ids, settled);
  assert.deepEqual(warnings, [
    { id: 3, key: 'lead-status-drafted', sentence: 'Already drafted.' },
  ]);

  const mixedIds = [10, 11, 12];
  const mixedSettled = await Promise.allSettled([
    Promise.resolve({
      ok: false,
      warning: { key: 'lead-status-drafted', sentence: 'Drafted.' },
      error: 'Warning',
    }),
    Promise.resolve({
      ok: false,
      warning: { key: 'lead-status-published', sentence: 'Published.' },
      error: 'Warning',
    }),
    Promise.resolve({ ok: true, id: 12 }),
  ]);
  const mixed = bulkDeskWarnings(mixedIds, mixedSettled);
  assert.deepEqual(mixed.map((entry) => entry.id), [10, 11]);
  assert.deepEqual(mixed.map((entry) => entry.key), [
    'lead-status-drafted',
    'lead-status-published',
  ]);
  assert.equal(
    bulkWarningSentence(mixed),
    '2 of the selected leads have a written draft or a published story.',
  );
  assert.equal(
    bulkWarningSentence([{ id: 1, key: 'lead-status-drafted', sentence: 'Drafted.' }]),
    '1 of the selected leads have a written draft.',
  );
  assert.equal(
    bulkWarningSentence([{ id: 1, key: 'lead-status-published', sentence: 'Published.' }]),
    '1 of the selected leads have a published story.',
  );
});

test("bulk retry sends only warned IDs with their own exact keys and keeps the shared reason", () => {
  const press = { ids: [1, 2, 3], status: "killed", killReason: "Duplicate", completedIds: [1], overrideById: { 2: ["earlier-key"] } };
  const retry = bulkDeskRetry(press, [
    { id: 2, key: "lead-status-drafted", sentence: "Saved draft." },
    { id: 3, key: "lead-status-published", sentence: "Published story." },
  ]);
  assert.deepEqual(retry, { ...press, ids: [2, 3], overrideById: { 2: ["earlier-key", "lead-status-drafted"], 3: ["lead-status-published"] } });
  assert.deepEqual(press.ids, [1, 2, 3]);
});
