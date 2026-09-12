import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStoryNames, replaceName, validateNameEvidence } from "./name-check-work.ts";
import { nameCheckText, readNameCheck } from "./name-check.ts";

const person = { name: "Eugene May", role: "Longmont City Attorney", context: "City Attorney Eugene May spoke." };
const doc = { url: "https://longmontcolorado.gov/city-attorney/staff/", title: "City Attorney staff", text: "Eugene Mei, City Attorney for Longmont", extras: [], version_id: 42 };
const candidate = { name: person.name, status: "corrected", spelling: "Eugene Mei", url: doc.url, excerpt: doc.text, authority: "official-directory", samePerson: true, reason: "The written city roster identifies the same Longmont city attorney." };
test("a correction requires a saved exact written passage and contextual identity", () => {
  assert.equal(validateNameEvidence(person, candidate, [doc]).status, "corrected");
  for (const changes of [{excerpt:"Eugene Mei, mayor"}, {url:"https://invented.example/"}, {samePerson:false}, {authority:"none"}, {spelling:"Eugene Meier"}]) assert.equal(validateNameEvidence(person, {...candidate,...changes}, [doc]).status, "unresolved");
  assert.equal(validateNameEvidence(person, candidate, [{...doc,version_id:null}]).status, "unresolved");
  assert.equal(validateNameEvidence(person, candidate, [{...doc,extraction_method:"pdf-ocr"}]).status, "unresolved");
  const url="https://www.youtube.com/watch?v=abc";
  assert.equal(validateNameEvidence(person,{...candidate,url},[{...doc,url}]).status,"unresolved");
});
test("correction preserves quotations, links, longer names and literal replacement characters", () => {
  assert.equal(replaceName('May said “May agrees” and "May spoke". Mayfield read [May](https://example.org/May).',"May","Mei"),'Mei said “May agrees” and "May spoke". Mayfield read [May](https://example.org/May).');
  assert.equal(replaceName("May", "May", "$&"), "$&");
});
test("supplied-only name checking performs no search and leaves an unsupported citizen unresolved", async () => {
  const draft={headline:"Council discusses a board",dek:"",body:"City Attorney Eugene May spoke. Penny Hodes spoke."};
  let calls=0;
  const result=await checkStoryNames({draft,city:"Longmont",domains:["longmontcolorado.gov"],docs:[doc],searchAllowed:false,timeLeft:()=>100000,
    search:async()=>{throw new Error("must not search");},open:async()=>{throw new Error("must not fetch");},
    chat:async()=>({ok:true,text:JSON.stringify(++calls===1 ? {complete:true,people:[{...person,context:"A paraphrase rather than an exact draft passage"},{name:"Penny Hodes",role:"citizen",context:""}]} : {checks:[candidate,{name:"Penny Hodes",status:"unresolved",reason:"No written speaker list identified this speaker."}]})}),
  });
  assert.match(result.draft.body,/Eugene Mei/);
  assert.equal(result.check.rows[1].status,"unresolved");
  assert.match(result.check.note,/supplied captures only/);
  assert.equal(result.check.checkedText,nameCheckText(result.draft));
  assert.notEqual(result.check.checkedText,nameCheckText({...result.draft,body:result.draft.body+" New Name spoke."}));
  assert.equal(readNameCheck(JSON.stringify({nameCheck:result.check}))?.rows.length,2);
});
test("timeout or malformed inventory never claims that names were checked", async()=>{
  const opts={draft:{headline:"",dek:"",body:person.context},city:"Longmont",domains:[],docs:[],searchAllowed:true,search:async()=>[],open:async()=>{},chat:async()=>({ok:true as const,text:"not JSON"})};
  for(const timeLeft of [()=>0,()=>100000]) {
    const result=await checkStoryNames({...opts,timeLeft});assert.equal(result.check.complete,false);assert.match(result.check.note,/did not complete/);assert.equal(result.draft.body,person.context);
  }
});
test("a source cannot certify a different person with the same name; missing and quoted names stay visible",async()=>{
  const draft={headline:"",dek:"",body:'City Attorney Eugene May spoke. "Eugene May" was the caption.'};
  let calls=0;const result=await checkStoryNames({draft,city:"Longmont",domains:[],docs:[doc],searchAllowed:false,timeLeft:()=>100000,search:async()=>[],open:async()=>{},chat:async()=>({ok:true,text:JSON.stringify(++calls===1?{complete:true,people:[person]}:{checks:[candidate]})})});
  assert.equal(result.check.rows[0].status,"unresolved");assert.match(result.check.rows[0].reason,/quotation/);assert.match(result.draft.body,/City Attorney Eugene Mei/);assert.match(result.draft.body,/"Eugene May"/);
});
