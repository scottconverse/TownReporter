import { getSql } from "../db.ts";
import { editorWarning } from "./editor-override.ts";

/** Manual-only policy boundary; the scheduler still respects the saved switch. */
export async function runManualMeetingForEditor<T>(
  context: { userId: string; newsroomId: number; role: string },
  override: string[] | undefined,
  running: boolean,
  run: (forceEnabled: boolean) => Promise<T>,
) {
  if (context.role !== "owner") return { ok: false as const, error: "Only the owner can run meeting capture." };
  if (running) return { ok: false as const, error: "A meeting capture pass is already running." };
  const [settings] = await (await getSql()).query<{ enabled: boolean }>("select enabled from meeting_capture_settings where newsroom_id=$1", [context.newsroomId]);
  const disabled = settings?.enabled !== true;
  if (disabled) {
    const warning = await editorWarning(context, override, "meeting-capture-disabled", "Meeting capture is turned off in Server settings. This will run capture once.", { kind: "newsroom", id: context.newsroomId });
    if (warning) return warning;
  }
  return run(disabled);
}
