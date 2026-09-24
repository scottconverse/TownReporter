import { existsSync, globSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import ts from "typescript";
import { jobs } from "./ci-yaml.mjs";

/**
 * Static imports and exports establish transitive connection capability.
 * A test may also directly request `import("pg")`; that is inspected in the
 * test itself without treating every product module's optional Postgres
 * adapter as an integration test.
 */
function sourceModuleSpecifiers(file, source, { inspectDynamicPg = false } = {}) {
  const jsx = /\.[jt]sx$/i.test(file);
  const parsed = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const staticSpecifiers = [];
  let canConnectDirectly = false;
  let readsAdminUrl = false;

  const record = (specifier, isDynamic = false) => {
    if (specifier === "pg" || specifier.startsWith("pg/")) {
      if (!isDynamic || inspectDynamicPg) canConnectDirectly = true;
      return;
    }
    if (specifier === "TEST_POSTGRES_ADMIN_URL") readsAdminUrl = true;
    // Follow dynamic local imports too: a test may defer loading its
    // connection helper until a test case runs. Package imports are handled
    // above and never enter the local-import traversal.
    staticSpecifiers.push(specifier);
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        record(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node)) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          record(arg.text, true);
        } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
          record(arg.text);
        }
      }
    } else if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "TEST_POSTGRES_ADMIN_URL" &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "env" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "process"
    ) {
      readsAdminUrl = true;
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "env" &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "process" &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === "TEST_POSTGRES_ADMIN_URL"
    ) {
      readsAdminUrl = true;
    }
    ts.forEachChild(node, visit);
  };

  visit(parsed);
  return { canConnectDirectly, readsAdminUrl, staticSpecifiers };
}

function resolveLocalImport(root, fromFile, specifier) {
  let base;
  if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith("@/")) {
    base = resolve(root, "src", specifier.slice(2));
  } else {
    return null;
  }

  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.mjs`, `${base}.js`, join(base, "index.ts")];
  return candidates.find(existsSync) ?? null;
}

export function moduleCanConnectToPostgres(file, root = process.cwd(), seen = new Set()) {
  const absolute = normalize(file);
  if (seen.has(absolute) || !existsSync(absolute)) return false;
  seen.add(absolute);
  const source = readFileSync(absolute, "utf8");
  const testFile = /\.test\.[cm]?[jt]sx?$/i.test(absolute);
  const { canConnectDirectly, readsAdminUrl, staticSpecifiers } = sourceModuleSpecifiers(absolute, source, {
    inspectDynamicPg: testFile,
  });
  if (canConnectDirectly || readsAdminUrl) return true;
  return staticSpecifiers.some((specifier) => {
    const dependency = resolveLocalImport(root, absolute, specifier);
    return dependency ? moduleCanConnectToPostgres(dependency, root, seen) : false;
  });
}

/** Return the repo-relative database-dependent test files in deterministic order. */
export function postgresTestFiles(root) {
  const files = new Set(globSync("src/**/*.test.*", { cwd: root }));
  return [...files]
    .filter((file) => moduleCanConnectToPostgres(join(root, file), root))
    .map((file) => relative(root, join(root, file)).split("\\").join("/"))
    .sort();
}

/** Find PostgreSQL-capable tests omitted from every CI job that provides its admin URL. */
export function postgresTestsMissingFromCi(files, ciYamlText) {
  const dbJobs = Object.values(jobs(ciYamlText))
    .filter((body) => {
      const meaningfulLines = body
        .map((line) => line.split("#", 1)[0])
        .filter((line) => line.trim() && !line.trimStart().startsWith("#"));
      return meaningfulLines.some((line) => /^\s*TOWNREPORTER_RUN_POSTGRES_INTEGRATION:\s*["']?1["']?\s*$/.test(line)) &&
        meaningfulLines.some((line) => /^\s*TOWNREPORTER_POSTGRES_INTEGRATION_ADMIN_URL:\s*\S/.test(line));
    })
    .map((body) => body.join("\n"));
  const escapedFiles = files.map((file) => [file, file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")]);
  const jobRunsAllDiscoveredTests = (body) => body.split(/\r?\n/).some((line) =>
    !line.trimStart().startsWith("#") &&
    /^\s*run\s*:\s*.*scripts\/run-postgres-integration\.mjs(?:\s|$)/.test(line.split("#", 1)[0]),
  );
  const ciRunsFile = (body, filePattern) => {
    const lines = body.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const run = /^(\s*)run\s*:\s*(.*)$/.exec(lines[index]);
      if (!run) continue;
      const runIndent = run[1].length;
      const inline = run[2].split("#", 1)[0];
      // The checked-in runner independently discovers, validates, and runs
      // the complete test set. A single invocation therefore covers every
      // discovered path, while its own count assertions prevent zero-test CI.
      if (/scripts\/run-postgres-integration\.mjs/.test(inline) ||
          lines.slice(index + 1).some((line, offset) => {
            if (offset === 0 && !line.trim()) return false;
            const indent = /^\s*/.exec(line)?.[0].length ?? 0;
            return indent > runIndent && /scripts\/run-postgres-integration\.mjs/.test(line.split("#", 1)[0]);
          })) return true;
      if (filePattern.test(inline)) return true;
      for (let next = index + 1; next < lines.length; next += 1) {
        const line = lines[next];
        if (!line.trim() || line.trimStart().startsWith("#")) continue;
        const indent = /^\s*/.exec(line)?.[0].length ?? 0;
        if (indent <= runIndent) break;
        if (filePattern.test(line.split("#", 1)[0])) return true;
      }
    }
    return false;
  };
  return escapedFiles
    .filter(([, filePattern]) => !dbJobs.some((body) =>
      jobRunsAllDiscoveredTests(body) || ciRunsFile(body, new RegExp(`(?:^|\\s)${filePattern}(?:\\s|$)`)),
    ))
    .map(([file]) => file);
}
