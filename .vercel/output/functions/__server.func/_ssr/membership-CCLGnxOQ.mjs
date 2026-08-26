import { c as getSql } from "./paper-DHP8VcIV.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/membership-CCLGnxOQ.js
var ForbiddenError = class extends Error {
	status = 403;
	constructor() {
		super("Not a newsroom editor");
		this.name = "ForbiddenError";
	}
};
async function ensureMembersTable() {
	await (await getSql()).query(`
    create table if not exists newsroom_members (
      user_id text primary key,
      role text not null,
      created_at timestamptz not null default now()
    )
  `);
}
/** First signed-in user becomes owner. Everyone else must already be a member. */
async function requireEditor(userId) {
	await ensureMembersTable();
	const sql = await getSql();
	const mine = await sql`
    select role from newsroom_members where user_id = ${userId} limit 1
  `;
	if (mine[0]?.role === "owner" || mine[0]?.role === "editor") return mine[0].role;
	if (((await sql`select count(*)::int as c from newsroom_members`)[0]?.c ?? 0) === 0) {
		await sql`
      insert into newsroom_members (user_id, role)
      values (${userId}, 'owner')
      on conflict (user_id) do nothing
    `;
		return "owner";
	}
	throw new ForbiddenError();
}
//#endregion
export { requireEditor };
