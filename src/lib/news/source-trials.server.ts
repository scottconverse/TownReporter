/**
 * The hourly clock's light pass (dynamic sources unit 6, D169): trial sources
 * and dormant re-checks are read with the scan's own page reader, no model.
 * See source-trials.ts for the rules.
 */
import { getSql } from "../db.ts";
import { ingestUrl } from "./ingest.ts";
import { getPaperPlace } from "./paper-settings.ts";
import { placeNamesOf, runLightPass } from "./source-trials.ts";

export async function tickSourceTrials(): Promise<void> {
  const sql = await getSql();
  const rooms = await sql<{ newsroom_id: number }>`
    select distinct newsroom_id from sources where status in ('trial', 'dormant') order by newsroom_id`;
  for (const room of rooms) {
    try {
      const place = await getPaperPlace(room.newsroom_id);
      await runLightPass(sql, {
        newsroomId: room.newsroom_id,
        placeNames: placeNamesOf(place),
        read: async (url) => ({ text: (await ingestUrl(url)).text }),
      });
    } catch (error) {
      console.error(`[townreporter] source trial pass failed for newsroom ${room.newsroom_id}:`, error);
    }
  }
}
