// Unit BN2: braces balance for a stylesheet, ignoring comments and strings.
// Run: node scripts/bn2-brace-check.mjs src/desk-astra.css
import { readFileSync } from "node:fs";

const file = process.argv[2];
const s = readFileSync(file, "utf8");
let depth = 0;
let max = 0;
let line = 1;
let inComment = false;
let quote = null;

for (let i = 0; i < s.length; i++) {
  const c = s[i];
  const n = s[i + 1];
  if (c === "\n") line++;
  if (inComment) {
    if (c === "*" && n === "/") {
      inComment = false;
      i++;
    }
    continue;
  }
  if (quote) {
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === quote) quote = null;
    continue;
  }
  if (c === "/" && n === "*") {
    inComment = true;
    i++;
    continue;
  }
  if (c === '"' || c === "'") {
    quote = c;
    continue;
  }
  if (c === "{") depth++;
  if (c === "}") {
    depth--;
    if (depth < 0) {
      console.log(`unbalanced: depth ${depth} at line ${line}`);
      process.exit(1);
    }
  }
  if (depth > max) max = depth;
}

console.log(`final depth: ${depth} max depth: ${max}`);
process.exit(depth === 0 ? 0 : 1);
