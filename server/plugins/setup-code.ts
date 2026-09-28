import { ensureOwnerSetupCode } from "../../src/lib/news/setup-code.ts";

/**
 * Generate (or clear) the first-owner setup code at boot (Unit CJ, 0.6.80).
 *
 * Same shape as `unattended-clock.ts` beside it: a static, relative import
 * (the proven pattern for a server plugin reaching app code in the built
 * output -- a "@/" alias here has previously produced a Linux build chunk
 * that was never written), wrapped so a failure here logs instead of
 * blocking boot. `ensureOwnerSetupCode` also runs ensure-on-read from
 * `isSetupCodeRequired`/`requireEditor`, so a failure here just means the
 * console/file announcement is late, not that the gate is unenforced.
 */
export default async function setupCodePlugin() {
  try {
    await ensureOwnerSetupCode();
  } catch (err) {
    console.error(`[setup-code] startup check failed (will retry on first request): ${String(err)}`);
  }
}
