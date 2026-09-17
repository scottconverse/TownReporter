// Writes ~/.cloudflared/config.yml for the TownReporter tunnel.
// A script file rather than an inline shell command on purpose: Git Bash
// heredocs mangle Windows backslash paths, which silently produced a broken
// credentials-file line the first time.
import { writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TUNNEL_ID = process.argv[2];
if (!TUNNEL_ID) {
  console.error("usage: node ops/write-tunnel-config.mjs <tunnel-id>");
  process.exit(2);
}

const dir = join(homedir(), ".cloudflared");
const creds = join(dir, `${TUNNEL_ID}.json`);
if (!existsSync(creds)) {
  console.error(`credentials file missing: ${creds}`);
  process.exit(1);
}

// cloudflared accepts forward slashes on Windows and they avoid every
// escaping question in YAML.
const credsYaml = creds.split("\\").join("/");

const config = `# TownReporter — Cloudflare Tunnel
#
# This machine dials OUT to Cloudflare and holds the connection open. Nothing
# inbound, no ports opened on the router, and the home IP never appears in DNS.
#
# The app listens on 127.0.0.1:3000 only, so the tunnel is the sole way in.

tunnel: ${TUNNEL_ID}
credentials-file: ${credsYaml}

ingress:
  - hostname: townreporter.org
    service: http://127.0.0.1:3000
  - hostname: www.townreporter.org
    service: http://127.0.0.1:3000
  # Required final rule: anything unmatched returns 404 rather than being
  # forwarded somewhere unintended.
  - service: http_status:404
`;

const out = join(dir, "config.yml");
writeFileSync(out, config);
console.log(`wrote ${out}\n`);
console.log(config);
