# Windows Sandbox fresh-install attempt (2026-09-17)

**Candidate:** `TownReporter-0.6.51-windows-x64.zip`, built from exact commit `2bd8230315c438bdfce9a55ebd7c5dd5cf8b8c41`, SHA-256 `e19d5b3909d619c183b532ccdd56c45ffeaab022e32dc6cf96853e2424bdf14f`.

**Environment:** a clean Windows Sandbox instance (`Windows NT 10.0.26100.0`), 8 GB memory, networking enabled, with a writable mapped staging folder. The sandbox ran `installer\Install.ps1 -DataRoot C:\TownReporterData` unattended.

**Result:** inconclusive; the installer did not reach a completed install.

The sandbox transcript recorded repeated dependency-download failures:

`PS>TerminatingError(Invoke-WebRequest): "Unable to connect to the remote server"`

No `result.json` was produced, so there is no HTTP-200 or completed-server result to report. The failure occurred before the package could download its runtime dependencies.

**What this does not prove:** it is not evidence that the installer itself failed for a product reason. The sandbox's network path could not reach the dependency hosts. It is also not a successful fresh-machine acceptance.

**Remaining limit:** fresh-machine Windows acceptance is still unverified. A future acceptance run needs a clean Windows environment with working access to the dependency hosts.
