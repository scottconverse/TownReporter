/**
 * Refuse to start a real install with no BETTER_AUTH_SECRET.
 *
 * Sessions are signed with it. With none set the app invents one per process,
 * which is correct in a preview -- the sessions live in an in-memory database
 * that dies with the process anyway -- and a quiet trap on a real install:
 * every restart signs the editor out, with no message and no reason. This
 * product's watchdog restarts the app whenever it looks unwell, so the symptom
 * is "it keeps logging me out" and the cause is nowhere near it. There is no
 * password reset to fall back on either.
 *
 * The check also exists inside the auth module, but that module is only loaded
 * when something asks for auth. Measured: the server started, served the paper
 * for twenty-five seconds and never noticed. A failure that waits for a sign-in
 * attempt is a failure the operator meets alone, later, with no terminal open.
 *
 * A real DATABASE_URL is what separates the two cases: sessions that outlive
 * the process need a secret that outlives it too.
 */
export default function requireAuthSecret() {
  const persistentDatabase = Boolean(process.env.DATABASE_URL?.trim());
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!persistentDatabase || secret) return;

  const message = [
    `BETTER_AUTH_SECRET is not set, and this install has a real database.`,
    ``,
    `Sessions are signed with it. Without one this process invents a secret`,
    `that dies when it does, so every restart signs the editor out with no`,
    `explanation -- and the watchdog restarts this app on its own.`,
    ``,
    `Generate one and put it in .env:`,
    ``,
    `  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    ``,
    `  BETTER_AUTH_SECRET=<the value it printed>`,
  ].join(String.fromCharCode(10));

  // Written to stderr as well as thrown: a thrown error inside a startup hook
  // can be reported in a form that buries the message, and this one is the
  // whole point.
  console.error(message);
  throw new Error("BETTER_AUTH_SECRET is not set");
}
