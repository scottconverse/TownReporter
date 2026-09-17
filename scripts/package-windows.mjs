/** Package only committed source. No working-tree secrets, build output or database. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const destination = resolve(process.argv[2] || "artifacts");
const root = process.cwd();
const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const version = JSON.parse(
  execFileSync("git", ["show", `${sha}:package.json`], { cwd: root, encoding: "utf8" }),
).version;
// Refuse packaging an uncommitted implementation as though it were HEAD.
const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
  cwd: root,
  encoding: "utf8",
});
if (dirty.trim())
  throw new Error(
    "Commit reviewed source before packaging. The release archive must correspond to an exact commit.",
  );
mkdirSync(destination, { recursive: true });
const name = `TownReporter-${version}-windows-x64.zip`;
const output = join(destination, name);
execFileSync(
  "git",
  ["archive", "--format=zip", `--prefix=TownReporter-${version}/`, `--output=${output}`, sha],
  { cwd: root },
);
const hash = createHash("sha256").update(readFileSync(output)).digest("hex");
writeFileSync(`${output}.sha256`, `${hash}  ${name}\n`);
writeFileSync(
  `${output}.json`,
  JSON.stringify({ version, commit: sha, sha256: hash, filename: name }, null, 2) + "\n",
);
console.log(JSON.stringify({ output, sha256: hash, commit: sha }));
