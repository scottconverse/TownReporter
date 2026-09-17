/**
 * The world's smallest CI-workflow reader.
 *
 * ci.yml only ever needs one query answered by the scripts in this
 * directory: "which lines belong to job X?" A real YAML parser would answer
 * that and a hundred questions nobody here is asking, at the cost of a
 * dependency. Splitting by the two-space job-name indent GitHub Actions
 * always uses is enough, and both ci-jobs.test.mjs and
 * postgres-tests-are-covered.test.mjs need exactly the same split -- so it
 * lives here once instead of twice, which is how the two checks stayed
 * consistent with each other.
 */

/** Split a workflow file's text into `{ jobName: [bodyLines] }`. */
export function jobs(ciYamlText) {
  const out = {};
  let current = null;
  for (const line of ciYamlText.split(/\r?\n/)) {
    const m = /^ {2}([a-z0-9][a-z0-9-]*):\s*$/.exec(line);
    if (m) {
      current = m[1];
      out[current] = [];
      continue;
    }
    if (current) out[current].push(line);
  }
  return out;
}
