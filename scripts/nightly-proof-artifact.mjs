/** Public receipt: retain database identity without credentials or connection details. */
export function proofArtifact(target, version, scan, draft, errors) {
  return {
    ranAt: new Date().toISOString(),
    version,
    testDatabase: new URL(target.databaseUrl).pathname.slice(1),
    scan: { ...scan, kind: "daily policy", policySize: 12 },
    draft,
    errors,
  };
}
