#!/usr/bin/env bash
# Regenerate the rendered architecture diagrams from their Mermaid sources.
#
# The .mmd files are extracted from the ```mermaid blocks in
# scan-architecture.md, so the Markdown stays the single source of truth.
# Requires Node; mermaid-cli is fetched on demand via npx.
#
#   bash docs/diagrams/render.sh
set -euo pipefail
cd "$(dirname "$0")"

# Extract each ```mermaid block from the Markdown in order.
node -e '
const fs = require("fs");
const src = fs.readFileSync("scan-architecture.md", "utf8");
const names = ["scan-overview", "scan-run-reporting", "scan-history-paging"];
const blocks = [...src.matchAll(/```mermaid\r?\n([\s\S]*?)```/g)].map(m => m[1].trim());
if (blocks.length !== names.length) {
  console.error(`expected ${names.length} mermaid blocks, found ${blocks.length}`);
  process.exit(1);
}
names.forEach((n, i) => fs.writeFileSync(n + ".mmd", blocks[i] + "\n"));
console.log(`extracted ${blocks.length} diagram sources`);
'

for n in scan-overview scan-run-reporting scan-history-paging; do
  echo "rendering $n"
  npx --yes @mermaid-js/mermaid-cli -i "$n.mmd" -o "$n.svg" -b transparent
done

echo "done — rendered SVGs are in docs/diagrams/"
