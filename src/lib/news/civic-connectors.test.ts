import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSql } from "../db.ts";
import type { Sql } from "../db.ts";

// Red consumer-contract tests written before product implementation.
// Dynamic loading keeps the missing integration an explicit runtime failure.
type Actor = { userId: string; newsroomId: number; role: "owner" | "editor" };
type ConnectorSource = {
  provider: string;
  url: string;
  namespace?: string;
  input_format?: string;
};
type Integration = {
  connectorConfigurationForNewsroom: (
    newsroomId: number,
    env: NodeJS.ProcessEnv,
  ) => { baseUrl: string; token: string };
  saveConnectorSource: (
    sql: Sql,
    actor: Actor,
    sourceId: number,
    source: ConnectorSource,
  ) => Promise<unknown>;
};
async function integration(): Promise<Integration> {
  const moduleUrl = new URL("./civic-connectors.ts", import.meta.url);
  return import(moduleUrl.href);
}

describe("explicit server-owned connector configuration", () => {
  const env = {
    CIVIC_CONNECTORS_URL: "http://127.0.0.1:48161",
    CIVIC_CONNECTORS_NEWSROOM_TOKENS: JSON.stringify({
      "944211": "synthetic-token-one",
      "944212": "synthetic-token-two",
    }),
  };

  it("selects an independently configured newsroom credential and never defaults to another newsroom", async () => {
    const { connectorConfigurationForNewsroom } = await integration();
    assert.deepEqual(connectorConfigurationForNewsroom(944211, env), {
      baseUrl: env.CIVIC_CONNECTORS_URL,
      token: "synthetic-token-one",
    });
    assert.equal(connectorConfigurationForNewsroom(944212, env).token, "synthetic-token-two");
    assert.throws(() => connectorConfigurationForNewsroom(944213, env), /configured|credential/i);
    assert.throws(() => connectorConfigurationForNewsroom(944211, {}), /configured|service/i);
  });

  it("does not serialize tokens in malformed-configuration errors", async () => {
    const { connectorConfigurationForNewsroom } = await integration();
    assert.throws(
      () =>
        connectorConfigurationForNewsroom(944211, {
          ...env,
          CIVIC_CONNECTORS_NEWSROOM_TOKENS: '{"944211":"synthetic-secret-marker"',
        }),
      (error: unknown) => {
        assert.doesNotMatch(String(error), /synthetic-secret-marker/);
        return true;
      },
    );
  });
});

describe("source authorization at the SQL boundary", () => {
  it("refuses another newsroom, an unaccepted source, and non-owner configuration without modifying sources", async () => {
    const { saveConnectorSource } = await integration();
    const sql = await getSql();
    const actor: Actor = { userId: "connector-owner-fixture", newsroomId: 944211, role: "owner" };
    const source: ConnectorSource = {
      provider: "legistar",
      url: "https://webapi.legistar.com/v1/synthetic-city/events",
      namespace: "synthetic-city",
    };
    for (const room of [actor.newsroomId, actor.newsroomId + 1]) {
      await sql.query("insert into newsrooms(id,name) values($1,$2) on conflict(id) do nothing", [
        room,
        `Synthetic source configuration newsroom ${room}`,
      ]);
    }
    const addSource = async (room: number, status: string, suffix: string) => {
      const [row] = await sql.query<{ id: number }>(
        "insert into sources(user_id,newsroom_id,url,title,status) values($1,$2,$3,'Synthetic connector source',$4) returning id",
        [actor.userId, room, `${source.url}?fixture=${suffix}`, status],
      );
      return row!.id;
    };
    const ownId = await addSource(actor.newsroomId, "accepted", "own");
    const foreignId = await addSource(actor.newsroomId + 1, "accepted", "foreign");
    const proposedId = await addSource(actor.newsroomId, "proposed", "proposed");
    const before = await sql.query(
      "select * from sources where id=any($1::integer[]) order by id",
      [[ownId, foreignId, proposedId]],
    );
    await assert.rejects(
      () => saveConnectorSource(sql, actor, foreignId, source),
      /source|newsroom|forbidden/i,
    );
    await assert.rejects(
      () => saveConnectorSource(sql, actor, proposedId, source),
      /accepted|source/i,
    );
    await assert.rejects(
      () => saveConnectorSource(sql, { ...actor, role: "editor" }, ownId, source),
      /owner/i,
    );
    const after = await sql.query("select * from sources where id=any($1::integer[]) order by id", [
      [ownId, foreignId, proposedId],
    ]);
    assert.deepEqual(after, before);
  });
});
