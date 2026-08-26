import { c as getSql } from "./paper-DHP8VcIV.mjs";
import { r as createServerFn } from "./ssr.mjs";
import { r as createServerRpc } from "./ai-BuLkq9Lu.mjs";
import { n as unpackStoredDraft } from "./coerce-draft-BCS2STw4.mjs";
import { randomBytes } from "node:crypto";
//#region node_modules/.nitro/vite/services/ssr/assets/public-k6N8LCrl.js
function publicArticle(row) {
	const u = unpackStoredDraft({
		headline: row.headline,
		dek: row.dek,
		body: row.body,
		topic: row.topic
	});
	return {
		...row,
		...u
	};
}
var listPublishedArticles_createServerFn_handler = createServerRpc({
	id: "bf1b86607827896e82263b26867d05e1fa0129d1ad9b15fec19b1af69cecdf6e",
	name: "listPublishedArticles",
	filename: "src/lib/news/public.ts"
}, (opts) => listPublishedArticles.__executeServer(opts));
var listPublishedArticles = createServerFn({ method: "GET" }).handler(listPublishedArticles_createServerFn_handler, async () => {
	return (await getSql())`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at
      from articles
      where status = 'published'
      order by published_at desc
      limit 30
    `.then((rows) => rows.map(publicArticle));
});
var getPublishedArticle_createServerFn_handler = createServerRpc({
	id: "7fd0d893e556b31897fdd44e6a3723a05ccb5c030caa87333339048cf240876a",
	name: "getPublishedArticle",
	filename: "src/lib/news/public.ts"
}, (opts) => getPublishedArticle.__executeServer(opts));
var getPublishedArticle = createServerFn({ method: "GET" }).validator((slug) => slug).handler(getPublishedArticle_createServerFn_handler, async ({ data: slug }) => {
	const rows = await (await getSql())`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at
      from articles
      where slug = ${slug} and status = 'published'
      limit 1
    `;
	return rows[0] ? publicArticle(rows[0]) : null;
});
var listPublishedByTopic_createServerFn_handler = createServerRpc({
	id: "babb7cb9c4dcdf79ab03f223de9e03f878eb0675085365d76b3590705b09a76e",
	name: "listPublishedByTopic",
	filename: "src/lib/news/public.ts"
}, (opts) => listPublishedByTopic.__executeServer(opts));
var listPublishedByTopic = createServerFn({ method: "GET" }).validator((topic) => topic).handler(listPublishedByTopic_createServerFn_handler, async ({ data: topic }) => {
	return (await getSql())`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at
      from articles
      where status = 'published' and topic = ${topic}
      order by published_at desc
      limit 30
    `.then((rows) => rows.map(publicArticle));
});
var searchPublished_createServerFn_handler = createServerRpc({
	id: "88a303f278e5f9adbd1c000cb7f47aa1648cfc72f4df2f66935d2d2063b09584",
	name: "searchPublished",
	filename: "src/lib/news/public.ts"
}, (opts) => searchPublished.__executeServer(opts));
var searchPublished = createServerFn({ method: "GET" }).validator((q) => q.trim().slice(0, 80)).handler(searchPublished_createServerFn_handler, async ({ data: q }) => {
	if (!q) return [];
	const sql = await getSql();
	const like = `%${q}%`;
	return sql`
      select id, slug, headline, dek, body, topic, source_urls, status, published_at
      from articles
      where status = 'published'
        and (headline ilike ${like} or dek ilike ${like} or body ilike ${like})
      order by published_at desc
      limit 30
    `.then((rows) => rows.map(publicArticle));
});
var listPublicCorrections_createServerFn_handler = createServerRpc({
	id: "0fcc8492304f9b5fa80bc98d7a2efc1dd137d3e368fe2cf69852f6a4de3d0a44",
	name: "listPublicCorrections",
	filename: "src/lib/news/public.ts"
}, (opts) => listPublicCorrections.__executeServer(opts));
var listPublicCorrections = createServerFn({ method: "GET" }).handler(listPublicCorrections_createServerFn_handler, async () => {
	return (await getSql())`
      select c.id, c.body, c.created_at, a.headline
      from corrections c
      left join articles a on a.id = c.article_id
      order by c.created_at desc
      limit 50
    `;
});
var subscribeNewsletter_createServerFn_handler = createServerRpc({
	id: "f3458156169f228d7be94baa0c8b85503435e48cfe22384e59f3596718d7878a",
	name: "subscribeNewsletter",
	filename: "src/lib/news/public.ts"
}, (opts) => subscribeNewsletter.__executeServer(opts));
var subscribeNewsletter = createServerFn({ method: "POST" }).validator((email) => email.trim().toLowerCase()).handler(subscribeNewsletter_createServerFn_handler, async ({ data: email }) => {
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return {
		ok: false,
		error: "That does not look like an email."
	};
	const sql = await getSql();
	await sql.query(`
      alter table subscribers add column if not exists status text not null default 'pending'
    `);
	await sql.query(`
      alter table subscribers add column if not exists confirm_token text
    `);
	if (((await sql`
      select count(*)::int as c from subscribers
      where created_at > now() - interval '1 hour'
    `)[0]?.c ?? 0) > 40) return {
		ok: false,
		error: "Too many signup attempts. Try later."
	};
	const token = randomBytes(24).toString("hex");
	const existing = await sql`
      select id, coalesce(status, 'pending') as status from subscribers where email = ${email} limit 1
    `;
	if (existing[0]?.status === "confirmed") return {
		ok: true,
		confirmPath: null
	};
	if (existing[0]) await sql`
        update subscribers set confirm_token = ${token}, status = 'pending'
        where id = ${existing[0].id}
      `;
	else await sql`
        insert into subscribers (email, status, confirm_token)
        values (${email}, 'pending', ${token})
      `;
	return {
		ok: true,
		confirmPath: `/newsletter/confirm?token=${token}`
	};
});
var confirmNewsletter_createServerFn_handler = createServerRpc({
	id: "92caba9457f6fb910c7c5881eb90e75c93dc620b103a39afe8de0242c5c5ca28",
	name: "confirmNewsletter",
	filename: "src/lib/news/public.ts"
}, (opts) => confirmNewsletter.__executeServer(opts));
var confirmNewsletter = createServerFn({ method: "GET" }).validator((token) => token.trim()).handler(confirmNewsletter_createServerFn_handler, async ({ data: token }) => {
	if (token.length < 16) return { ok: false };
	const sql = await getSql();
	const rows = await sql`
      select id from subscribers where confirm_token = ${token} limit 1
    `;
	if (!rows[0]) return { ok: false };
	await sql`
      update subscribers set status = 'confirmed', confirm_token = null
      where id = ${rows[0].id}
    `;
	return { ok: true };
});
//#endregion
export { confirmNewsletter_createServerFn_handler, getPublishedArticle_createServerFn_handler, listPublicCorrections_createServerFn_handler, listPublishedArticles_createServerFn_handler, listPublishedByTopic_createServerFn_handler, searchPublished_createServerFn_handler, subscribeNewsletter_createServerFn_handler };
