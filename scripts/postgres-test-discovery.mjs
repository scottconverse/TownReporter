import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";

// Static imports/exports establish a test's connection capability. Deliberately
// do not follow runtime `import("pg")` in the product database adapter: nearly
// every unit imports product code that can choose Postgres in production, while
// only integration tests statically opt into a real `pg` client/admin helper.
const IMPORT_RE = /(?:from\s*|import\s*)["']([^"']+)["']/g;

function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}.js`, join(base, "index.ts")];
  return candidates.find(existsSync) ?? null;
}

export function moduleCanConnectToPostgres(file, seen = new Set()) {
  const absolute = normalize(file);
  if (seen.has(absolute) || !existsSync(absolute)) return false;
  seen.add(absolute);
  const source = readFileSync(absolute, "utf8");
  const specifiers = [...source.matchAll(IMPORT_RE)].map((match) => match[1]);
  if (specifiers.some((specifier) => specifier === "pg" || specifier.startsWith("pg/"))) return true;
  if (/\bTEST_POSTGRES_ADMIN_URL\b/.test(source)) return true;
  return specifiers.some((specifier) => {
    const dependency = resolveLocalImport(absolute, specifier);
    return dependency ? moduleCanConnectToPostgres(dependency, seen) : false;
  });
}

export function postgresTestFiles(root) {
  return globSync("src/**/*.test.ts", { cwd: root })
    .filter((file) => moduleCanConnectToPostgres(join(root, file)))
    .map((file) => relative(root, join(root, file)).split("\\").join("/"))
    .sort();
}
