import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export function treeDigest(root, names, exclude = []) {
  const hash = createHash("sha256");
  function add(path) {
    if (exclude.includes(relative(root, path).replaceAll("\\", "/"))) return;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) add(join(path, name));
    } else hash.update(relative(root, path).replaceAll("\\", "/")).update(readFileSync(path));
  }
  for (const name of names) if (existsSync(join(root, name))) add(join(root, name));
  return hash.digest("hex");
}
export function sourceDigest(root) {
  return treeDigest(root, [
    "src",
    "scripts",
    "installer",
    "migrations",
    "public",
    "server",
    ".grok",
    "package.json",
    "package-lock.json",
    "vite.config.ts",
    "tsconfig.json",
  ]);
}
export function outputDigest(root) {
  return treeDigest(root, [".output/server", ".output/public"]);
}
export function verifyBuild(root) {
  const manifest = JSON.parse(readFileSync(join(root, ".output", "install-build.json"), "utf8"));
  if (manifest.sourceHash !== sourceDigest(root))
    throw new Error(
      "Source changed since this build. Run Install again to rebuild; no server was started.",
    );
  const serverHash = outputDigest(root);
  if (manifest.serverHash !== serverHash)
    throw new Error("Built server changed. Run Install again to rebuild.");
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[3] || ".");
  if (process.argv[2] === "write") {
    const manifest = {
      version: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
      sourceHash: sourceDigest(root),
      serverHash: outputDigest(root),
    };
    writeFileSync(join(root, ".output/install-build.json"), JSON.stringify(manifest));
    console.log(JSON.stringify(manifest));
  } else console.log(JSON.stringify(verifyBuild(root)));
}
