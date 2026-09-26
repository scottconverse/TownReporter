/**
 * One slice of the ordinary test suite.
 *
 * The suite outgrew its gate. The `src/**` group runs one file at a time on
 * purpose (several of those tests each stand up an embedded PGLite, and running
 * them together exhausts memory -- see scripts/suite-runs-serially.test.mjs),
 * so the only way to make the gate finish sooner is to run the files on more
 * than one machine. 0.6.64 was cancelled at thirty minutes while still passing
 * tests steadily, and the timeout was raised to fifty rather than fixed.
 *
 * A shard is that fix. `TOWNREPORTER_TEST_SHARD=2` with
 * `TOWNREPORTER_TEST_SHARD_TOTAL=6` means "run the second sixth of the
 * discovered files". Nothing is skipped: the runner still discovers every file
 * through the same globs, and `node --test-shard` hands each file to exactly
 * one shard, so the shards together are the whole suite. With neither variable
 * set -- a developer's `npm test`, and any job that does not opt in -- there is
 * no shard and the run is the complete suite, exactly as before.
 *
 * Both variables must be set together. A shard index with no total (or a total
 * with no index) is how a run silently becomes a slice, or silently stops being
 * one, so it is an error rather than a default.
 */

const INDEX = "TOWNREPORTER_TEST_SHARD";
const TOTAL = "TOWNREPORTER_TEST_SHARD_TOTAL";

function wholeNumber(name, raw) {
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(`${name} must be a whole number, not "${raw}".`);
  }
  return Number(raw);
}

/** `{ index, total }` for this process, or `null` for the complete suite. */
export function parseShard(env = process.env) {
  const index = (env[INDEX] ?? "").trim();
  const total = (env[TOTAL] ?? "").trim();
  if (!index && !total) return null;
  if (!index || !total) {
    throw new Error(
      `${INDEX} and ${TOTAL} must be set together. One without the other runs ` +
        `a different set of files than the caller asked for, which is how part of ` +
        `the suite stops running without anyone being told.`,
    );
  }
  const shard = { index: wholeNumber(INDEX, index), total: wholeNumber(TOTAL, total) };
  if (shard.total < 1) {
    throw new Error(`${TOTAL} must be at least 1, not ${shard.total}.`);
  }
  if (shard.index < 1 || shard.index > shard.total) {
    throw new Error(
      `${INDEX} must be between 1 and ${TOTAL} (${shard.total}), not ${shard.index}. ` +
        `An index above the total runs nothing at all.`,
    );
  }
  return shard;
}

/** The argv node needs for this shard, or `[]` for the complete suite. */
export function shardArgs(env = process.env) {
  const shard = parseShard(env);
  return shard ? [`--test-shard=${shard.index}/${shard.total}`] : [];
}

/** One line for the log, so a slice never looks like a whole run. */
export function shardNotice(env = process.env) {
  const shard = parseShard(env);
  if (!shard) return null;
  return (
    `Running shard ${shard.index} of ${shard.total}: this is one slice of the ` +
    `suite, and the other shards run the rest.`
  );
}
