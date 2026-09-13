import {test} from "node:test";
import assert from "node:assert/strict";
import {checkEditorialNames} from "./editorial-name-check.ts";

test("Opinion checks body, appendix and fact sheet against its own retained request documents",async()=>{
  const text="[roster.pdf, page 1, native text extraction]\nEugene Mei, City Attorney for Longmont";
  let calls=0;
  const result=await checkEditorialNames({newsroomId:9,editorialRequestId:4,modelChoice:"local-model",city:"Longmont",integrityNotes:"Prior note",documents:[{id:"doc-1",filename:"roster.pdf",mime:"application/pdf",full_text:text,source_url:null}],editorial:{headline:"Eugene May weighs in",body:"Eugene May wrote the argument.",appendix:"Eugene May is identified in the record.",factSheet:"Eugene May — city attorney",imagePrompt:"Portrait without text"},chat:async()=>({ok:true,text:JSON.stringify(++calls===1?{complete:true,people:[{name:"Eugene May",role:"Longmont City Attorney",context:""}]}:{checks:[{name:"Eugene May",status:"corrected",spelling:"Eugene Mei",documentId:"doc-1",excerpt:"Eugene Mei, City Attorney for Longmont",reason:"The official roster identifies the same city attorney.",authority:"official-directory",samePerson:true}]})})});
  assert.equal(result.editorial.headline,"Eugene Mei weighs in"); assert.match(result.editorial.body,/Eugene Mei/); assert.match(result.editorial.appendix,/Eugene Mei/); assert.match(result.editorial.factSheet,/Eugene Mei/);
  assert.equal(result.editorial.imagePrompt,"Portrait without text"); assert.equal(result.nameCheck.rows[0].filename,"roster.pdf"); assert.match(result.integrityNotes,/Prior note[\s\S]*roster\.pdf/);
});
test("public Opinion research saves an official capture before accepting its spelling",async()=>{
  const url="https://longmontcolorado.gov/council"; let calls=0,captured=0;
  const result=await checkEditorialNames({newsroomId:9,editorialRequestId:4,modelChoice:"local-model",city:"Longmont",publicResearchAllowed:true,officialDomains:["longmontcolorado.gov"],documents:[],editorial:{headline:"Marcia Popkin responds",body:"Marcia Popkin serves on council.",appendix:"",factSheet:"",imagePrompt:""},search:async()=>[{title:"Council",url,snippet:"official roster"}],ingest:async()=>({ok:true,status:200,outcome:"fetched",text:"Marcia Martin Popkin, City Council Member",title:"City Council",extras:[],contentType:"text/html",needsOcr:false,redirectChain:[],extractionMethod:"readability",pages:[]}),capturePublic:async()=>{captured++;return {version_id:81,capture_event_id:91};},chat:async()=>({ok:true,text:JSON.stringify(++calls===1?{complete:true,people:[{name:"Marcia Popkin",role:"Longmont council member",context:""}]}:{checks:[{name:"Marcia Popkin",status:"corrected",spelling:"Marcia Martin Popkin",url,excerpt:"Marcia Martin Popkin, City Council Member",reason:"The official city roster identifies the same council member.",authority:"official-directory",samePerson:true}]})})});
  assert.equal(captured,1); assert.match(result.editorial.headline,/Marcia Martin Popkin/); assert.equal(result.nameCheck.rows[0].captureId,81);
});
