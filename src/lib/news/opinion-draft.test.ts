import { readFileSync } from "node:fs";
import { before, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { withEditorialDraft, saveOpinionDraft, assertOpinionEvidenceReady } from "./opinion-draft.server.ts";
import { evidenceReviewToken } from "./draft-evidence.ts";
import type { DraftRow } from "./types.ts";
before(async () => {
 const sql=await getSql();
 await sql.query(`create table drafts(id serial primary key, newsroom_id integer, lead_id integer, form text, headline text, dek text, body text, topic text, source_urls text, provenance_json text, found_note text, unanswered text, research_json text,updated_at timestamptz default now())`);
 await sql.query(`create table articles(id serial primary key,body text,source_urls text,headline text,status text,newsroom_id integer,slug text)`);
 await sql.query(`create table editorial_extras(draft_id integer,fact_sheet text,image_prompt text)`);
 for(const [id,form,lead] of [[1,'report',11],[2,'editorial',12],[3,'editorial',null],[4,'editorial',null]] as const) {
 await sql`insert into drafts(id,newsroom_id,lead_id,form,headline,dek,body,topic,source_urls,provenance_json,found_note,unanswered,research_json) values(${id},81,${lead},${form},'Original','','Original body','opinion','["https://example.org/record"]','[]','','[]','{}')`;
 }
});
for(const id of [1,2]) for (const action of ['read','edit','publish'] as const) it(`Opinion cannot ${action} a reporting/lead-bound draft ${id}`,async()=>{
 const sql=await getSql();
 if(action === 'read') await assert.rejects(withEditorialDraft(81,id,async(_tx,d)=>d),/standalone editorial/);
 if(action === 'edit') await assert.rejects(saveOpinionDraft(81,{draftId:id,headline:'Altered',dek:'',body:'Unrelated replacement',topic:'opinion'}),/standalone editorial/);
 if(action === 'publish') await assert.rejects(withEditorialDraft(81,id,async(tx,d)=>{assertOpinionEvidenceReady(d);await tx`insert into articles(body,source_urls) values(${d.body},${d.source_urls})`;}),/standalone editorial/);
 const [d]=await sql<DraftRow>`select * from drafts where id=${id}`;assert.equal(d.body,'Original body');
});
it('Opinion refuses another newsroom and requires evidence review after a material edit',async()=>{
 await assert.rejects(withEditorialDraft(82,3,async(_tx,d)=>d),/standalone editorial/);
 const data={draftId:3,headline:'Edited',dek:'',body:'Different body',topic:'opinion'};
 await saveOpinionDraft(81,data);
 const sql=await getSql();const [edited]=await sql<DraftRow>`select * from drafts where id=3`;
 assert.equal(JSON.parse(edited.research_json!).evidenceReview.original.body,'Original body');
 await assert.rejects(withEditorialDraft(81,3,async(tx,d)=>{assertOpinionEvidenceReady(d);await tx`insert into articles(body,source_urls) values(${d.body},${d.source_urls})`;}),/Review the retained evidence/);
 await assert.rejects(saveOpinionDraft(81,{...data,evidenceDecision:'keep',evidenceToken:'stale'}),/changed/);
 await saveOpinionDraft(81,{...data,evidenceDecision:'keep',evidenceToken:evidenceReviewToken(edited)});
 await withEditorialDraft(81,3,async(tx,d)=>{assertOpinionEvidenceReady(d);await tx`insert into articles(body,source_urls) values(${d.body},${d.source_urls})`;});
 const articles=await sql<{body:string;source_urls:string}>`select * from articles`;
 assert.deepEqual(articles.map(a=>a.body),['Different body']);assert.match(articles[0].source_urls,/example.org/);
});
it('removing outdated Opinion evidence preserves the private original',async()=>{
 const sql=await getSql();const[d]=await sql<DraftRow>`select * from drafts where id=4`;
 await saveOpinionDraft(81,{draftId:4,headline:'Changed',dek:'',body:'New body',topic:'opinion',evidenceDecision:'remove',evidenceToken:evidenceReviewToken(d)});
 await withEditorialDraft(81,4,async(_tx,current)=>{assertOpinionEvidenceReady(current);assert.equal(current.source_urls,'[]');assert.match(JSON.parse(current.research_json!).evidenceReview.original.source_urls,/example.org/);});
});

it('the actual Opinion GET query refuses the alternate reporting route',async()=>{
 const source=readFileSync(new URL('./opinion.ts',import.meta.url),'utf8');
 const handler=source.slice(source.indexOf('export const getEditorialDraft'),source.indexOf('export const saveEditorialDraft'));
 const query=handler.match(/sql<EditorialDraft>`([\s\S]*?)`/);assert.ok(query);
 const read=new Function('sql','draftId','owned','context','return sql`'+query[1]+'`;');
 const sql=await getSql();
 assert.equal((await read(sql,1,()=>81,{})).length,0);
 assert.equal((await read(sql,2,()=>81,{})).length,0);
 assert.equal((await read(sql,3,()=>81,{})).length,1);
});
