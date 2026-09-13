import { getSql } from "../db.ts";
import { grokChat, type EffectiveProviderChoice } from "./ai.ts";
import type { Editorial } from "./editorial.ts";
import { checkStoryNames, type UploadedNameEvidence } from "./name-check-work.ts";
import { nameCheckNotes, type NameCheck } from "./name-check.ts";
import type { ReportChat } from "./report.ts";
import type { FetchedDoc, ReportSearchHit } from "./report.ts";
import { webSearch } from "./search-web.ts";
import { ingestDocument } from "./ingest.ts";
import { rememberCapture } from "./investigate.ts";
import { sha256 } from "./fetch-url.ts";

type EditorialNameDocument = {id:string;filename:string;mime:string;full_text:string;source_url:string|null};
type Options = {
  newsroomId: number; editorialRequestId: number; modelChoice: EffectiveProviderChoice;
  userId?: string; publicResearchAllowed?: boolean; officialDomains?: string[];
  editorial: Editorial; integrityNotes?: string; city: string;
  stage?: (message:string)=>void|Promise<void>;
  /** Focused-test seam; production always uses the authorized request query. */
  documents?: EditorialNameDocument[]; chat?: ReportChat;
  publicDocs?: FetchedDoc[];
  search?: (query:string)=>Promise<ReportSearchHit[]>;
  ingest?: typeof ingestDocument;
  capturePublic?: (doc:{url:string;title:string;text:string;status:number;outcome:string;pages:FetchedDoc["pages"];extractionMethod:string})=>Promise<{version_id:number|null;capture_event_id:number|null}>;
};
export type CheckedEditorial = {editorial:Editorial;nameCheck:NameCheck;integrityNotes:string};

/** Apply the common Story spelling gate to all publishable Opinion prose.
 * The request/newsroom pair is the authorization boundary; filenames and
 * locators may be shown to editors, while private IDs never enter the copy. */
export async function checkEditorialNames(opts:Options):Promise<CheckedEditorial> {
  let docs = opts.documents;
  if (!docs) {
    const sql = await getSql();
    try {
      docs = await sql<EditorialNameDocument>`
        select id,filename,mime,full_text,source_url from story_documents
        where newsroom_id=${opts.newsroomId} and editorial_request_id=${opts.editorialRequestId}
          and status='read' and full_text is not null
          and mime <> 'application/x-townreporter-source-links'
        order by created_at,id`;
    } catch (error) {
      if ((error as { code?: string })?.code !== "42P01") throw error;
      docs = [];
    }
  }
  const evidence:UploadedNameEvidence[]=docs.map(doc=>({evidenceKind:"uploaded-document",documentId:doc.id,filename:doc.filename,mime:doc.mime,text:doc.full_text,sourceUrl:doc.source_url}));
  const publicDocs = opts.publicDocs ?? [];
  const allEvidence = [...evidence,...publicDocs];
  const started=Date.now(), totalMs=120_000;
  const divider="\n\n[EDITOR FACT SHEET FOLLOWS]\n\n";
  const combinedBody=`${opts.editorial.body}${divider}${opts.editorial.factSheet}`;
  const checked=await checkStoryNames({
    draft:{headline:opts.editorial.headline,dek:opts.editorial.appendix,body:combinedBody},
    city:opts.city,domains:opts.officialDomains ?? [],docs:allEvidence,searchAllowed:opts.publicResearchAllowed === true,
    search:opts.search ?? (async query=>(await webSearch(query)).map(hit=>({title:hit.title,url:hit.url,snippet:hit.snippet}))),
    open:async urls=>{
      const load=opts.ingest ?? ingestDocument;
      for(const url of urls) {
        if(Date.now()-started>totalMs-12_000) break;
        const got=await load(url,{provider:opts.modelChoice,newsroomId:String(opts.newsroomId)}).catch(()=>null);
        if(!got?.ok || !got.text.trim()) continue;
        let version_id:number|null=null,capture_event_id:number|null=null;
        if(opts.capturePublic) {
          const receipt=await opts.capturePublic({url,title:got.title||url,text:got.text,status:got.status,outcome:got.outcome,pages:got.pages,extractionMethod:got.extractionMethod});
          version_id=receipt.version_id; capture_event_id=receipt.capture_event_id;
        } else if(opts.userId) {
          const receipt=await rememberCapture({userId:opts.userId,newsroomId:opts.newsroomId,investigationId:null,url,title:got.title||url,text:got.text.slice(0,2_000_000),hash:await sha256(got.text||url),status:got.status,outcome:got.outcome,classification:"discovered",triggerKind:"editorial",pages:got.pages,extractionMethod:got.extractionMethod,autoWatch:false}).catch(()=>null);
          version_id=receipt?.versionId??null; capture_event_id=receipt?.captureEventId??null;
        }
        // Unsaved fetched text can inform reporting but cannot certify spelling.
        const fetched={url,title:got.title||url,text:got.text,extras:got.extras,pages:got.pages,extraction_method:got.extractionMethod,version_id,capture_event_id};
        publicDocs.push(fetched); allEvidence.push(fetched);
      }
    },
    timeLeft:()=>Math.max(0,totalMs-(Date.now()-started)),stage:opts.stage,
    chat:opts.chat ?? ((system,user,maxTokens)=>grokChat(system,user,maxTokens,{choice:opts.modelChoice,newsroomId:opts.newsroomId,timeoutMs:120_000,noTools:true})),
  });
  const split=checked.draft.body.split(divider);
  const editorial={...opts.editorial,headline:checked.draft.headline,appendix:checked.draft.dek,body:split[0] ?? "",factSheet:split.slice(1).join(divider)};
  return {editorial,nameCheck:checked.check,integrityNotes:[opts.integrityNotes,nameCheckNotes(checked.check)].map(value=>String(value??"").trim()).filter(Boolean).join("\n")};
}
