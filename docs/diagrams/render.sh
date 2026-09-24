#!/usr/bin/env bash
# Regenerate every rendered architecture diagram from its Mermaid source.
#
# Source of truth: the ```mermaid blocks in ../manual.md and in
# scan-architecture.md. This script extracts them so the Markdown and the
# standalone .mmd/.svg files cannot drift.
#
#   bash docs/diagrams/render.sh
#
# Requires Node; mermaid-cli is fetched on demand via npx (no global install).
set -euo pipefail
cd "$(dirname "$0")"

node -e '
const fs = require("fs");
const jobs = [
  { md: "../manual.md", names: ["system-context","pipeline-source-to-page","job-end-to-end","dark-desk-one-round","opinion-voice-handoff","keeping-it-online","data-model","provider-at-call-time","meeting-to-story"] },
  { md: "scan-architecture.md", names: ["scan-overview","scan-run-reporting","scan-history-paging"] },
];
let total = 0;
for (const job of jobs) {
  const src = fs.readFileSync(job.md, "utf8");
  const blocks = [...src.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map(m => m[1].trim());
  if (blocks.length !== job.names.length) {
    console.error(`${job.md}: expected ${job.names.length} mermaid blocks, found ${blocks.length}`);
    process.exit(1);
  }
  job.names.forEach((n, i) => {
    fs.writeFileSync(n + ".mmd", blocks[i] + "\n");
    total++;
  });
}
console.log(`extracted ${total} diagram sources`);
'

for f in *.mmd; do
  n="${f%.mmd}"
  echo "rendering $n"
  npx --yes @mermaid-js/mermaid-cli -i "$f" -o "$n.svg" -b transparent
done

echo "done — $(ls -1 *.svg | wc -l) SVGs in docs/diagrams/"
