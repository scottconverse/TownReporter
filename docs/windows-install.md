# Install TownReporter on Windows

Use this path to run a persistent newsroom on your own Windows computer. The source setup for macOS and Linux remains in [setup.md](setup.md).

## Before you begin

- Windows 10 or 11, 64-bit x64, with broadband internet and at least 8 GB of free disk space for the application, database, browser and downloaded prerequisites. Windows ARM is not a tested installer target.
- For AI-assisted scans, drafts and Opinion, an AI account or endpoint you can already use: a signed-in Claude/Codex CLI, an Anthropic API key, or an OpenAI-compatible service or local model. You can file a lead yourself and edit, save and publish a story without AI; those AI-assisted workflows require a configured model. Creating an account or downloading a large model is separate from installing TownReporter.
- Keep the computer awake during installation. The paper runs while this computer and its server are running.

The target is to finish installation and a first manual editorial workflow in under an hour. Download speed, prerequisite installation and any model response time affect that result. This is a goal, not measured proof for every computer or connection.

The repository includes automated Windows installer and package checks. The current release is [0.6.60](releases/0.6.60.md); its package-internal note points to the .sha256 sidecar as the hash authority. The [0.6.54 release guide](releases/0.6.54.md) records the published v0.6.54 release: tag, GitHub release, and the Windows x64 ZIP `TownReporter-0.6.54-windows-x64.zip` (SHA-256 `dfbeb9b9…`). A fresh-machine human acceptance result is still not documented here.

## Download and install

1. Open [TownReporter 0.6.60](releases/0.6.60.md) for the release's limits and evidence boundaries. For an actual download, use the [latest published release](https://github.com/scottconverse/TownReporter/releases/latest). Download the Windows x64 asset named `TownReporter-<version>-windows-x64.zip` if that release provides it (for this guide, `TownReporter-0.6.60-windows-x64.zip`); do not use the source-code ZIP. Extract the ZIP completely into a folder you intend to keep. Do not run it from inside the ZIP. If the Windows asset is missing, stop and use a release that provides it.
2. Open **Install TownReporter.cmd** in the extracted folder. It downloads pinned Node and PostgreSQL distributions, checks their hashes, installs the application dependencies and Chromium, creates a private database and authentication secret, and builds TownReporter.
3. Read any prerequisite or port-conflict message. An error stops installation; it does not authorize stopping another program. The installer does not need an existing Node, Git or PostgreSQL installation, and does not replace one.
4. Wait for the readiness check and open the local address the installer prints. The default is **http://127.0.0.1:4388**. If the installer has finished but the server is not running, open **Start TownReporter.cmd** and wait for it to report ready.
5. Create your editor account. The first account owns this new newsroom, and there is no shared default editor password. Complete **Set up the paper**: save your paper name, city, state and timezone, then add one public source you want to watch. Nothing is published before setup is saved. The same form remains available later under **Server -> Paper setup**.
6. For AI-assisted scans, drafts or Opinion, open **Configure AI.cmd** to select your provider, or use an already signed-in CLI. Keep API keys private. Open **Server -> Writing models** to check availability, then run a small scan or draft to verify an actual response. A readiness label alone does not prove generation works. This step is not required for manual lead filing or editing and publishing a story.

After setup is saved, the public paper is **http://127.0.0.1:4388/**, the Editor's Desk is **http://127.0.0.1:4388/desk**, and first-run setup is **http://127.0.0.1:4388/desk/setup**. There is no password-reset flow; see **If something fails** before using **Give up the desk**.

If the installer reports a missing Microsoft Visual C++ runtime, follow its official Microsoft link, install that prerequisite, and run the installer again. Do not download replacement DLLs from third-party sites.

The default private database port is **15432**. Existing installations keep their saved ports. If a port is occupied or Windows refuses to bind it, open PowerShell in the extracted application folder and choose two unused ports, for example:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\Install.ps1 -Port 4390 -PgPort 15434
```

The saved configuration remembers those ports. Later starts use them automatically. An interrupted download or build can be retried from the same extracted folder; keep the data folder and read any recovery message before moving or removing files.

## Your first check

After setup is saved, you can file a lead yourself from the Queue (**File a lead yourself**) and edit, save and publish a story without AI. For an AI-assisted check, start with one source rather than a whole city's watch list. Run **Scan**, read its summary, and open any lead it files. "Filed nothing" can be a successful scan when the source has no actionable news. You can also paste material into **Write a story**, choose a model and drafting scope, and inspect the resulting draft.

For an installation check, clearly label your article **TEST CONTENT**. Review its body and evidence before publishing. **View paper** opens this installation's reader-facing pages. Stop and start TownReporter, sign in again, and confirm your article and settings remain. Remove or unpublish test content before opening the paper to readers.

## Start, stop and keep your data

- **Start TownReporter.cmd** checks the compiled build, starts the owned database and server, and waits for an HTTP readiness response.
- **Stop TownReporter.cmd** stops this installation's processes and retains its database. Let active writing finish before stopping.
- **Configure AI.cmd** stores provider settings in the installation's private data folder. Restart after changing them.

The installer prints its data-folder location. Keep that folder. It contains the database (`pgdata`), private installation settings (`config.json`), provider settings (`providers.json`, if configured), and logs such as `initialize.log`, `postgres.log`, `app.out.log`, `app.err.log`, `migrate.log`, `build.log`, and `dependencies.log`.

TownReporter does not create backups automatically. To make one, run **Stop TownReporter.cmd**, wait for it to finish, then copy the entire data folder to another drive. Keep the copy private because it contains the database, configuration and possibly provider access. A same-release manual restore means stopping TownReporter, replacing the entire data folder with the stopped backup, and starting TownReporter; restoring across releases or computers is not documented. Do not copy only `pgdata` or mix files from different dates.

Do not send the data folder, `.env` contents, `config.json`, `providers.json`, `pgdata`, or API keys to other people. Do not move the extracted application folder after installation; the launcher binds its process ownership and build checks to that location.

The packaged server listens only on this computer. It does not register global Windows services, start at boot, or configure a public tunnel. Public hosting is a separate operator task; see [setup.md](setup.md). A successful local installation is not proof that a public address is configured.

## If something fails

- **Port already in use or reserved by Windows:** leave the other program alone. Choose unused ports with the installer's PowerShell options; app and database ports must differ.
- **Missing or stale build:** stop this instance and rerun its installation/build step. Do not build over a running server or copy an old `.output` directory into a new source release.
- **No AI provider:** configure a key or endpoint, or sign in to a supported CLI under the Windows account running TownReporter. Retry a real draft after the provider becomes available.
- **Cannot open the desk:** read the printed log location and readiness error. A process merely starting is not a successful installation.
- **Forgot the only owner password:** TownReporter has no password-reset or account-recovery flow. Do not use **Give up the desk** as recovery; it irreversibly lets the next account take ownership. Stop TownReporter, preserve the data folder, and get operator or database help before changing anything.
- **Need help:** use the [project's GitHub issue tracker](https://github.com/scottconverse/TownReporter/issues). Include the exact error text, the step you were on, and the relevant log name. Do not send `.env` contents, API keys, `config.json`, `providers.json`, `pgdata`, or the private data folder.
- **Existing newsroom:** do not delete its data or point a new installer at it as a repair attempt. Keep a backup and follow a reviewed upgrade procedure. This installer does not perform an automatic PostgreSQL major-version upgrade.

Use the installation-owned controls. Legacy scripts under `ops/` are for separately configured operators and must not be used as generic installation instructions.
