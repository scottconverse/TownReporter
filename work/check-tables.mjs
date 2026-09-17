import { getSql } from "../src/lib/db.ts";
const sql = await getSql();
const rows = await sql.query("select table_name from information_schema.tables where table_schema='public' and table_name in ('leads','story_documents')");
console.log(rows.map(r => r.table_name));
