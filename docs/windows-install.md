# Install TownReporter on Windows

Use this path to run a persistent newsroom on your own Windows computer. The source setup for macOS and Linux remains in [setup.md](setup.md).

## Before you begin

- Windows 10 or 11, 64-bit x64, with broadband internet and at least 8 GB of free disk space for the application, database, browser and downloaded prerequisites. Windows ARM is not a tested installer target.
- An AI account or endpoint you can already use: a signed-in Claude/Codex CLI, an Anthropic API key, or an OpenAI-compatible service or local model. Creating an account or downloading a large model is separate from installing TownReporter.
- Keep the computer awake during installation. The paper runs while this computer and its server are running.

The target is to finish installation and a first editorial workflow in under an hour. Download speed, prerequisite installation, provider access and model response time affect that result. See the release's installation evidence for the measured environment and elapsed time; this is not a guarantee for every computer or connection.

Release evidence separates the timed fresh Windows installation and manual publishing check from real-provider testing on the local packaged installation. The fresh CI check disables AI; the separate Claude draft check uses an already available provider. Neither measures creating an AI account or completing a real source scan on a fresh machine.

## Download and install

1. For the beta, open the direct [TownReporter 0.6.32 beta release](https://github.com/scottconverse/TownReporter/releases/tag/v0.6.32); for the latest stable build, use the [latest stable releases page](https://github.com/scottconverse/TownReporter/releases/latest). Download the Windows installation ZIP listed under the chosen release's Assets. Extract the ZIP completely into a folder you intend to keep. Do not run it from inside the ZIP.
2. Open **Install TownReporter.cmd** in the extracted folder. It downloads pinned Node and PostgreSQL distributions, checks their hashes, installs the application dependencies and Chromium, creates a private database and authentication secret, and builds TownReporter.
3. Read any prerequisite or port-conflict message. An error stops installation; it does not authorize stopping another program. The installer does not need an existing Node, Git or PostgreSQL installation, and does not replace one.
4. Wait for the readiness check and open the local address the installer prints. The default is **http://127.0.0.1:4388**.
5. Create your editor account. The first account owns this new newsroom. Save your paper name, city, state and timezone, then add one public source you want to watch. Use the real setup screen; there is no shared default editor password.
6. Open **Configure AI.cmd** to select your provider, or use an already signed-in CLI. Keep API keys private. Open **Server → Writing models** to check availability, then run a small scan or draft to verify an actual response. A readiness label alone does not prove generation works.

If the installer reports a missing Microsoft Visual C++ runtime, follow its official Microsoft link, install that prerequisite, and run the installer again. Do not download replacement DLLs from third-party sites.

The default private database port is **15432**. Existing installations keep their saved ports. If a port is occupied or Windows refuses to bind it, open PowerShell in the extracted application folder and choose two unused ports, for example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\Install.ps1 -Port 4390 -PgPort 15434
```

The saved configuration remembers those ports. Later starts use them automatically. An interrupted download or build can be retried from the same extracted folder; keep the data folder and read any recovery message before moving or removing files.

## Your first check

Start with one source, rather than a whole city's watch list. Run **Scan**, read its summary, and open any lead it files. “Filed nothing” can be a successful scan when the source has no actionable news. You can also paste material into **Write a story**, choose a model and drafting scope, and inspect the resulting draft.

For an installation check, clearly label your article **TEST CONTENT**. Review its body and evidence before publishing. **View paper** opens this installation's reader-facing pages. Stop and start TownReporter, sign in again, and confirm your article and settings remain. Remove or unpublish test content before opening the paper to readers.

## Start, stop and keep your data

- **Start TownReporter.cmd** checks the compiled build, starts the owned database and server, and waits for an HTTP readiness response.
- **Stop TownReporter.cmd** stops this installation's processes and retains its database. Let active writing finish before stopping.
- **Configure AI.cmd** stores provider settings in the installation's private data folder. Restart after changing them.

The installer prints its data-folder location. Keep that folder: it contains the database, private configuration and logs. Do not send its configuration files or database to other people. Do not move the extracted application folder after installation; the launcher binds its process ownership and build checks to that location.

The packaged server listens only on this computer. It does not register global Windows services, start at boot, or configure a public tunnel. Public hosting is a separate operator task; see [setup.md](setup.md). A successful local installation is not proof that a public address is configured.

## If something fails

- **Port already in use or reserved by Windows:** leave the other program alone. Choose unused ports with the installer's PowerShell options; app and database ports must differ.
- **Missing or stale build:** stop this instance and rerun its installation/build step. Do not build over a running server or copy an old `.output` directory into a new source release.
- **No AI provider:** configure a key or endpoint, or sign in to a supported CLI under the Windows account running TownReporter. Retry a real draft after the provider becomes available.
- **Cannot open the desk:** read the printed log location and readiness error. A process merely starting is not a successful installation.
- **Existing newsroom:** do not delete its data or point a new installer at it as a repair attempt. Keep a backup and follow a reviewed upgrade procedure. This installer does not perform an automatic PostgreSQL major-version upgrade.

Use the installation-owned controls. Legacy scripts under `ops/` are for separately configured operators and must not be used as generic installation instructions.
