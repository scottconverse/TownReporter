/**
 * The hourly clock's light pass (dynamic sources unit 6, D169): trial sources
 * and dormant re-checks are read with the scan's own page reader, no model.
 * See source-trials.ts for the rules.
 */
import { getSql } from "../db.ts";
import { ingestUrl } from "./ingest.ts";
import { getPaperPlace } from "./paper-settings.ts";
import { placeNamesOf, runLightPass } from "./source-trials.ts";
import { runIntake } from "./source-intake.ts";

export async function tickSourceTrials(): Promise<void> {
  const sql = await getSql();
  const rooms = await sql<{ newsroom_id: number }>`
    select distinct newsroom_id from sources where status in ('trial', 'dormant', 'proposed') order by newsroom_id`;
  for (const room of rooms) {
    try {
      const placeNames = placeNamesOf(await getPaperPlace(room.newsroom_id));
      // Unit 7: new suggested sites get their one automatic check first.
      await runIntake(sql, {
        newsroomId: room.newsroom_id,
        placeNames,
        read: async (url) => {
          const page = await ingestUrl(url);
          return { text: page.text, method: page.method ?? null, rawText: page.rawText ?? null };
        },
      });
      await runLightPass(sql, {
        newsroomId: room.newsroom_id,
        placeNames,
        read: async (url) => ({ text: (await ingestUrl(url)).text }),
      });
    } catch (error) {
      console.error(`[townreporter] source trial pass failed for newsroom ${room.newsroom_id}:`, error);
    }
  }
}
