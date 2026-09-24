import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStoryNames, maskUnverifiedMeetingIdentity, polishMaskedMeetingIdentities, replaceName, validateNameEvidence } from "./name-check-work.ts";
import { nameCheckText, readNameCheck } from "./name-check.ts";

const person = { name: "Eugene May", role: "Longmont City Attorney", context: "City Attorney Eugene May spoke." };
const doc = { url: "https://longmontcolorado.gov/city-attorney/staff/", title: "City Attorney staff", text: "Eugene Mei, City Attorney for Longmont", extras: [], version_id: 42 };
const candidate = { name: person.name, status: "corrected", spelling: "Eugene Mei", url: doc.url, excerpt: doc.text, authority: "official-directory", samePerson: true, reason: "The written city roster identifies the same Longmont city attorney." };
test("an invented roster quotation is replaced with an exact saved passage before editor review", async () => {
  const mayor={name:"Brian Bagley",role:"former Mayor of Longmont",context:""};
  const source={...doc,url:"https://longmontcolorado.gov/government/mayors-of-longmont",title:"Mayors of Longmont",text:"Mayors of Longmont\n\nBrian Bagley\n\n2017 - 2021"};
  let calls=0;
  const result=await checkStoryNames({draft:{headline:"A historical record",dek:"",body:"Former mayor Brian Bagley appears in the city archive."},city:"Longmont",domains:["longmontcolorado.gov"],docs:[source],searchAllowed:false,timeLeft:()=>100000,search:async()=>[],open:async()=>{},chat:async(_system,user)=>{
    calls++;
    if(calls===1) return {ok:true,text:JSON.stringify({complete:true,people:[mayor]})};
    const checked={name:mayor.name,status:"matched",spelling:mayor.name,url:source.url,excerpt:"Brian Bagley, Mayor of Longmont (2017–2021)",authority:"official-record",samePerson:true,reason:"The city mayor history identifies the same former mayor."};
    if(calls===3) { assert.match(user,/EXACT SAVED PASSAGES/); return {ok:true,text:JSON.stringify({checks:[{...checked,passageId:1}]})}; }
    return {ok:true,text:JSON.stringify({checks:[checked]})};
  }});
  assert.equal(calls,2); assert.equal(result.check.rows[0].status,"matched");
  assert.equal(result.check.rows[0].excerpt,source.text);
  assert.equal(result.check.rows[0].captureId,42);
});
test("a correction requires a saved exact written passage and contextual identity", () => {
  const officialDomains={city:"Longmont",officialDomains:["longmontcolorado.gov"]};
  assert.equal(validateNameEvidence(person, candidate, [doc], officialDomains).status, "corrected");
  for (const changes of [{excerpt:"Eugene Mei, mayor"}, {url:"https://invented.example/"}, {samePerson:false}, {authority:"none"}, {spelling:"Eugene Meier"}]) assert.equal(validateNameEvidence(person, {...candidate,...changes}, [doc], officialDomains).status, "unresolved");
  assert.equal(validateNameEvidence(person, candidate, [{...doc,version_id:null}], officialDomains).status, "unresolved");
  assert.equal(validateNameEvidence(person, candidate, [{...doc,extraction_method:"pdf-ocr"}], officialDomains).status, "unresolved");
  const url="https://www.youtube.com/watch?v=abc";
  assert.equal(validateNameEvidence(person,{...candidate,url},[{...doc,url}], officialDomains).status,"unresolved");
});
test("an authoritative uploaded written record corrects every unquoted draft field with a private locator", async () => {
  const uploaded={evidenceKind:"uploaded-document" as const,documentId:"private-1",filename:"signed-minutes.docx",mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",text:"Longmont City Attorney Eugene Mei presented the item."};
  const privateCandidate={...candidate,url:"",documentId:uploaded.documentId,excerpt:uploaded.text,authority:"official-record"};
  const row=validateNameEvidence(person,privateCandidate,[uploaded]);
  assert.equal(row.status,"corrected"); assert.equal(row.url,""); assert.equal(row.filename,uploaded.filename); assert.equal(row.locator,`characters 1-${uploaded.text.length}`);
  let calls=0;
  const result=await checkStoryNames({draft:{headline:"Eugene May briefs council",dek:"Eugene May presents",body:"Eugene May spoke. \"Eugene May said yes.\""},city:"Longmont",domains:[],docs:[uploaded],searchAllowed:false,timeLeft:()=>100000,search:async()=>[],open:async()=>{},chat:async()=>({ok:true,text:JSON.stringify(++calls===1?{complete:true,people:[person]}:{checks:[privateCandidate]})})});
  assert.equal(result.draft.headline,"Eugene Mei briefs council"); assert.equal(result.draft.dek,"Eugene Mei presents");
  assert.match(result.draft.body,/Eugene Mei spoke/); assert.match(result.draft.body,/"Eugene May said yes/);
  assert.equal(result.check.rows[0].status,"unresolved");
});
test("an OCR-derived uploaded record cannot certify its own name spelling",()=>{
  const text="[scan.pdf, page 1, OCR extraction]\nEugene Mei, City Attorney for Longmont";
  const uploaded={evidenceKind:"uploaded-document" as const,documentId:"ocr-1",filename:"scan.pdf",mime:"application/pdf",text};
  assert.equal(validateNameEvidence(person,{...candidate,url:"",documentId:uploaded.documentId,excerpt:"Eugene Mei, City Attorney for Longmont"},[uploaded]).status,"unresolved");
});
test("a transcript header invalidates a distant name while whitespace-normalized official excerpts retain exact receipts",()=>{
  const transcript={evidenceKind:"uploaded-document" as const,documentId:"t1",filename:"meeting.txt",mime:"text/plain",sourceUrl:"https://youtube.com/watch?v=1",text:`YouTube transcript from meeting\n${"discussion ".repeat(100)}Eugene Mei, City Attorney for Longmont`};
  assert.equal(validateNameEvidence(person,{...candidate,url:"",documentId:"t1",excerpt:"Eugene Mei, City Attorney for Longmont"},[transcript]).status,"unresolved");
  const official={evidenceKind:"uploaded-document" as const,documentId:"w1",filename:"roster.docx",mime:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",text:"Eugene Mei,\n\tCity Attorney for Longmont"};
  const row=validateNameEvidence(person,{...candidate,url:"",documentId:"w1",excerpt:"Eugene Mei, City Attorney for Longmont"},[official]);
  assert.equal(row.status,"corrected"); assert.equal(row.excerpt,official.text); assert.equal(row.locator,`characters 1-${official.text.length}`);
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
test("meeting drafts mask unresolved speaker identities and adjacent roles while preserving quoted transcript words", async()=>{
  const draft={headline:"City Manager Eugene Mei briefs council",dek:"Eugene Mei, city manager, presented the forecast.",body:'City Manager Eugene Mei said the budget was delayed. "Eugene Mei said the budget was delayed," the transcript reads.'};
  const result=await checkStoryNames({draft,city:"Longmont",domains:[],docs:[],searchAllowed:false,maskUnverifiedMeetingIdentities:true,timeLeft:()=>100000,search:async()=>[],open:async()=>{},chat:async(_system,user)=>{
    if(user===nameCheckText(draft)) return {ok:true,text:JSON.stringify({complete:true,people:[{name:"Eugene Mei",role:"Longmont City Manager",context:"City Manager Eugene Mei said the budget was delayed."}]})};
    return {ok:true,text:JSON.stringify({checks:[{name:"Eugene Mei",status:"unresolved",reason:"No written roster confirmed this role or identity."}]})};
  }});
  assert.equal(result.check.rows[0]?.status,"unresolved");
  assert.match(result.draft.headline,/^an unidentified speaker briefs council$/i);
  assert.match(result.draft.dek,/^an unidentified speaker presented the forecast\.$/i);
  assert.match(result.draft.body,/^an unidentified speaker said the budget was delayed\./i);
  assert.match(result.draft.body,/"Eugene Mei said the budget was delayed,"/);
  assert.doesNotMatch(`${result.draft.headline} ${result.draft.dek} ${result.draft.body.split('"')[0]}`,/Eugene Mei|City Manager/i);
  assert.match(result.check.note,/replaced with neutral wording/);
  assert.match(result.check.note,/inside direct quotations or links were preserved verbatim/);
  assert.equal(result.check.checkedText,nameCheckText(result.draft));
});
test("meeting identity masker leaves quoted text, markdown links, and longer names untouched",()=>{
  const text='City Manager Eugene Mei spoke. "Eugene Mei" appears in the quote. [Eugene Mei](https://example.test) Eugene Meier spoke.';
  const result=maskUnverifiedMeetingIdentity(text,"Eugene Mei");
  assert.equal(result,'An unidentified speaker spoke. "Eugene Mei" appears in the quote. [Eugene Mei](https://example.test) Eugene Meier spoke.');
});
test("meeting identity masking handles the unsupported council names in the observed saved draft",()=>{
  const text="The motion, made by Council Member Marcen and seconded by Council Member Kelkoffer, asks staff to return the ordinance. Marcen framed the change as a revenue question. Council members Crist, Popkin and Brito voted in opposition. Popkin asked where the item would fall on the city's work plan. Brito said she was not comfortable bringing cannabis consumption into a public space.";
  let masked=text;
  for(const name of ["Marcen","Kelkoffer","Crist","Popkin","Brito"]) masked=maskUnverifiedMeetingIdentity(masked,name);
  assert.doesNotMatch(masked,/Marcen|Kelkoffer|Crist|Popkin|Brito|Council Member/i);
  assert.match(masked,/made by an unidentified speaker and seconded by an unidentified speaker/);
  assert.match(masked,/an unidentified speaker framed the change/i);
  assert.match(masked,/an unidentified speaker, an unidentified speaker and an unidentified speaker voted in opposition/i);
  assert.match(masked,/an unidentified speaker asked where the item would fall/i);
  assert.match(masked,/an unidentified speaker said she was not comfortable/i);
});
test("meeting identity masking leaves the observed board story grammatical without changing quotes",()=>{
  const line='The staffer was addressing a task force member by the name an unidentified speaker. An unidentified speaker and an unidentified speaker opposed it. "by the name an unidentified speaker" remains a quote.';
  assert.equal(polishMaskedMeetingIdentities(line),
    'The staffer was addressing a task force member whose name was not verified. Two unidentified speakers opposed it. "by the name an unidentified speaker" remains a quote.');
});
test("non-meeting name checks keep their existing visible wording",async()=>{
  const draft={headline:"City Manager Eugene Mei",dek:"",body:"City Manager Eugene Mei spoke."};
  const result=await checkStoryNames({draft,city:"Longmont",domains:[],docs:[],searchAllowed:false,timeLeft:()=>100000,search:async()=>[],open:async()=>{},chat:async(_system,user)=>({ok:true,text:JSON.stringify(user===nameCheckText(draft)?{complete:true,people:[{name:"Eugene Mei",role:"City Manager",context:"City Manager Eugene Mei spoke."}]}:{checks:[{name:"Eugene Mei",status:"unresolved",reason:"No saved written identity evidence."}]})})});
  assert.equal(result.draft.headline,draft.headline);
  assert.equal(result.draft.body,draft.body);
});
test("timeout or malformed inventory never claims that names were checked", async()=>{
  const opts={draft:{headline:"",dek:"",body:person.context},city:"Longmont",domains:[],docs:[],searchAllowed:true,search:async()=>[],open:async()=>{},chat:async()=>({ok:true as const,text:"not JSON"})};
  for(const timeLeft of [()=>0,()=>100000]) {
    const result=await checkStoryNames({...opts,timeLeft});assert.equal(result.check.complete,false);assert.match(result.check.note,/did not complete/);assert.equal(result.draft.body,person.context);
  }
});
test("a source cannot certify a different person with the same name; missing and quoted names stay visible",async()=>{
  const draft={headline:"",dek:"",body:'City Attorney Eugene May spoke. "Eugene May" was the caption.'};
  let calls=0;const result=await checkStoryNames({draft,city:"Longmont",domains:["longmontcolorado.gov"],docs:[doc],searchAllowed:false,timeLeft:()=>100000,search:async()=>[],open:async()=>{},chat:async()=>({ok:true,text:JSON.stringify(++calls===1?{complete:true,people:[person]}:{checks:[candidate]})})});
  assert.equal(result.check.rows[0].status,"unresolved");assert.match(result.check.rows[0].reason,/quotation/);assert.match(result.draft.body,/City Attorney Eugene Mei/);assert.match(result.draft.body,/"Eugene May"/);
});

test("an exact Harold-style official record is accepted deterministically even when the model cannot resolve it", async () => {
  const source={...doc,url:"https://longmontcolorado.gov/uploads/council-agenda.pdf",title:"City Council Agenda",text:"PRESENTED BY: Harold Dominguez, City Manager's Office",version_id:130};
  let calls=0;
  const result=await checkStoryNames({
    draft:{headline:"Harold Dominguez presents the agenda",dek:"",body:"City Manager's Office representative Dominguez presented the item."},
    city:"Longmont",domains:["longmontcolorado.gov"],docs:[source],searchAllowed:false,timeLeft:()=>100000,search:async()=>[],open:async()=>{},
    chat:async()=>({ok:true,text:JSON.stringify(++calls===1?{complete:true,people:[{name:"Harold Dominguez",role:"Longmont City Manager's Office",context:"Dominguez presented the item."}]}:{checks:[{name:"Harold Dominguez",status:"unresolved",reason:"The model could not resolve this name."}]})}),
  });
  assert.equal(result.check.rows.length,1);
  assert.equal(result.check.rows[0].status,"matched");
  assert.equal(result.check.rows[0].spelling,"Harold Dominguez");
  assert.equal(result.check.rows[0].captureId,130);
  assert.match(result.check.rows[0].excerpt,/PRESENTED BY: Harold Dominguez, City Manager's Office/);
});

test("a surname-only inventory entry is merged into its unambiguous full-name entry", async () => {
  const source={...doc,url:"https://longmontcolorado.gov/uploads/council-agenda.pdf",title:"City Council Agenda",text:"PRESENTED BY: Harold Dominguez, City Manager's Office",version_id:131};
  let calls=0;
  const result=await checkStoryNames({
    draft:{headline:"Harold Dominguez presents the agenda",dek:"",body:"Dominguez presented the item for the City Manager's Office."},
    city:"Longmont",domains:["longmontcolorado.gov"],docs:[source],searchAllowed:false,timeLeft:()=>100000,search:async()=>[],open:async()=>{},
    chat:async()=>({ok:true,text:JSON.stringify(++calls===1?{complete:true,people:[
      {name:"Harold Dominguez",role:"Longmont City Manager's Office",context:"Harold Dominguez presents the agenda."},
      {name:"Dominguez",role:"City Manager's Office",context:"Dominguez presented the item."},
    ]}:{checks:[{name:"Harold Dominguez",status:"unresolved",reason:"Model evidence unavailable."}]})}),
  });
  assert.deepEqual(result.check.rows.map(row=>row.name),["Harold Dominguez"]);
  assert.equal(result.check.rows[0].status,"matched");
  assert.equal(result.check.complete,true);
});

test("a surname shared by two full names remains unresolved and visible", async () => {
  const source={...doc,url:"https://longmontcolorado.gov/uploads/council-agenda.pdf",title:"City Council Agenda",text:"PRESENTED BY: Harold Dominguez, City Manager's Office",version_id:132};
  const people=[
    {name:"Harold Dominguez",role:"Longmont City Manager's Office",context:"Harold Dominguez presented the item."},
    {name:"Maria Dominguez",role:"Longmont City Council",context:"Maria Dominguez asked a question."},
    {name:"Dominguez",role:"Longmont official",context:"Dominguez was mentioned afterward."},
  ];
  let calls=0;
  const result=await checkStoryNames({draft:{headline:"Dominguez officials meet",dek:"",body:"Harold Dominguez presented the item. Maria Dominguez asked a question. Dominguez was mentioned afterward."},city:"Longmont",domains:["longmontcolorado.gov"],docs:[source],searchAllowed:false,timeLeft:()=>100000,search:async()=>[],open:async()=>{},chat:async()=>({ok:true,text:JSON.stringify(++calls===1?{complete:true,people}:{checks:people.map(person=>({name:person.name,status:"matched",spelling:person.name,url:source.url,excerpt:source.text,authority:"official-record",samePerson:true,reason:"The record contains this surname."}))})})});
  const surname=result.check.rows.find(row=>row.name==="Dominguez");
  assert.ok(surname);
  assert.equal(surname.status,"unresolved");
  assert.match(surname.reason,/ambiguous/i);
});

// The real text of lead 206's redraft (drafts 161/162, longmont council
// zREvH6v072E). The saved copy replaced "Daryl Han" once, left bare "Han" in
// five later paragraphs, and left "introduced himself on the recording as an
// unidentified speaker, electric utility director at Longmont Power, said" —
// a speaker who introduces himself as unidentified. Verbatim pre-mask body.
const redraft162Body = [
  "Longmont Power has replaced a little over 5,000 feet of underground cable so far this year against an annual goal of about 100,000 feet, the utility's electric director told the City Council at its Sept. 22, 2026 regular session.",
  "",
  "The director, who introduced himself on the recording as Daryl Han, electric utility director at Longmont Power, said the work is being done with one maintenance crew. \"So by the end of the year, we'll be about 10% of our goal for the year, which means next year we're already 90% behind, if you will,\" he said. \"And that just continues to compound year after year.\"",
  "",
  "That compounding is the reason the number matters to ratepayers. Han tied the shortfall directly to future budget requests: \"as we come to you each year asking for additional budget, it's going to be thrown at this maintenance crew um predominantly.\" He said other priorities would also be funded, but that maintenance is where the added money would mainly go.",
  "",
  "Han framed the cable work as one piece of a reliability push the council has already funded. He said the council previously helped the utility add a maintenance crew whose focus is upgrading equipment and improving reliability, and that the 2027 budget request continues the maintenance program. He described the utility's goals as a \"three-legged stool\" balanced across reliability, affordability and sustainability, with safety embedded in the work.",
  "",
  "On reliability metrics, Han said the 2026 figures looked lower in the first two quarters but that the summer quarter would push outage frequency and duration up significantly. \"So you may have experienced outages yourself this summer or have heard about them,\" he said. \"That is something that we are aware of.\"",
  "",
  "He also placed the electric work alongside council priorities, citing increased system capacity tied to Vance Brand airport and future aviation development, a planned microgrid with Front Range Community College centered on its downtown campus, and transmission and substation upgrades with Flat River.",
  "",
  "Han said Longmont Power has been operating for about 125 years and serves more than 50,000 meters, most of them advanced metering infrastructure meters with some legacy meters remaining.",
  "",
  "No council member asked a question after the presentation. The presiding comment on the recording was that no one was in the queue, and the council moved on to the next budget presentation.",
  "",
  "The council took no vote on the cable figures or the maintenance program during this item; the presentation was part of the city's budget overview. The recording does not state a dollar amount for the 2027 electric budget request, a target date for closing the cable backlog, or how many additional crews would be needed to reach 100,000 feet a year.",
  "",
  "What happens next: the maintenance figures are part of the budget material the council is reviewing, and Han said the utility would return in future years asking for additional budget aimed predominantly at the maintenance crew.",
].join("\n");
test("the real redraft-162 speaker text masks the full name, its later surname mentions and the introduced-as clause", () => {
  const masked = polishMaskedMeetingIdentities(maskUnverifiedMeetingIdentity(redraft162Body, "Daryl Han"));
  assert.doesNotMatch(masked, /Daryl|\bHan\b/);
  assert.match(masked, /^Longmont Power has replaced a little over 5,000 feet of underground cable so far this year/);
  assert.match(masked, /The director, who introduced himself on the recording, said the work is being done with one maintenance crew\./);
  assert.doesNotMatch(masked, /electric utility director at Longmont Power/);
  // Five later bare-surname references; the introduction's own mask is absorbed
  // by the readable "introduced himself on the recording" clause.
  assert.equal((masked.match(/unidentified speaker/gi) ?? []).length, 5);
  assert.match(masked, /"as we come to you each year asking for additional budget, it's going to be thrown at this maintenance crew um predominantly\."/);
  assert.match(masked, /"That is something that we are aware of\."/);
});
// The vote sentence of the real lead 206 redraft (draft 164, longmont council
// zREvH6v072E), with invented surnames in the masked slots. "Mayor Pro Tem" was
// not a recognized title, so only the surname was replaced and the saved draft
// read "seconded by Mayor Pro Tem an unidentified speaker".
const voteSentence164 = "The motion was made by Alvarez and seconded by Mayor Pro Tem Sandoval, and it carried 4-3 with Okafor, Brennan and Novak in opposition, according to the meeting transcript.";
test("the draft-164 vote sentence masks a two-word title with the name and reads as a sentence", () => {
  let masked = voteSentence164;
  for (const name of ["Sandoval", "Alvarez", "Okafor", "Brennan", "Novak"]) masked = maskUnverifiedMeetingIdentity(masked, name);
  masked = polishMaskedMeetingIdentities(masked);
  assert.doesNotMatch(masked, /Alvarez|Sandoval|Okafor|Brennan|Novak/);
  assert.doesNotMatch(masked, /Pro Tem an unidentified/i);
  assert.doesNotMatch(masked, /\bmayor\b|\bpro tem\b/i);
  assert.equal(masked, "The motion was made by an unidentified speaker and seconded by an unidentified speaker, and it carried 4-3 with three unidentified speakers in opposition, according to the meeting transcript.");
});
test("every council title in front of an unresolved name is masked together with the name", () => {
  for (const title of ["Mayor Pro Tem", "Mayor Pro Tempore", "Council Member", "Councilmember", "Councilwoman", "Councilman", "Mayor", "Commissioner"]) {
    const masked = maskUnverifiedMeetingIdentity(`seconded by ${title} Dana Whitfield, according to the transcript.`, "Dana Whitfield");
    assert.equal(masked, "seconded by an unidentified speaker, according to the transcript.", title);
  }
});
test("a bare surname another reviewed person also uses stays visible while the full name is masked", () => {
  const text = 'Daryl Han reported the cable figures. Maria Han seconded the motion. Han said the count continued. Han wrote "Han said so". [Han](https://example.test) Daryl added a chart.';
  const masked = polishMaskedMeetingIdentities(maskUnverifiedMeetingIdentity(text, "Daryl Han", { otherNames: ["Maria Han"] }));
  assert.equal(masked, 'An unidentified speaker reported the cable figures. Maria Han seconded the motion. Han said the count continued. Han wrote "Han said so". [Han](https://example.test) an unidentified speaker added a chart.');
});
test("meeting masking keeps a surname a written source verified for another person", async () => {
  const draft={headline:"Daryl Han reports cable figures",dek:"",body:"Daryl Han reported the cable figures. Maria Han seconded the motion."};
  const source={...doc,url:"https://longmontcolorado.gov/uploads/council-agenda.pdf",title:"City Council Agenda",text:"Maria Han, Longmont City Council",version_id:133};
  const result=await checkStoryNames({draft,city:"Longmont",domains:["longmontcolorado.gov"],docs:[source],searchAllowed:false,maskUnverifiedMeetingIdentities:true,timeLeft:()=>100000,search:async()=>[],open:async()=>{},chat:async(_system,user)=>{
    if(user===nameCheckText(draft)) return {ok:true,text:JSON.stringify({complete:true,people:[
      {name:"Daryl Han",role:"electric utility director",context:"Daryl Han reported the cable figures."},
      {name:"Maria Han",role:"Longmont City Council",context:"Maria Han seconded the motion."},
    ]})};
    return {ok:true,text:JSON.stringify({checks:[
      {name:"Daryl Han",status:"unresolved",reason:"No written roster confirms this name."},
      {name:"Maria Han",status:"matched",spelling:"Maria Han",url:source.url,excerpt:source.text,authority:"official-record",samePerson:true,reason:"The official agenda names the same council member."},
    ]})};
  }});
  assert.deepEqual(result.check.rows.map(row=>row.status),["unresolved","matched"]);
  assert.equal(result.draft.body,"An unidentified speaker reported the cable figures. Maria Han seconded the motion.");
  assert.equal(result.draft.headline,"An unidentified speaker reports cable figures");
});

test("unexpected resolver failures return a safe diagnostic and invoke the editor hook", async () => {
  const diagnostics: unknown[]=[];
  const result=await checkStoryNames({draft:{headline:"Harold Dominguez",dek:"",body:"Harold Dominguez spoke."},city:"Longmont",domains:[],docs:[],searchAllowed:false,timeLeft:()=>100000,search:async()=>[],open:async()=>{},onDiagnostic:async diagnostic=>{diagnostics.push(diagnostic);},chat:async()=>{throw new Error("private document text must not escape");}});
  assert.equal(result.check.complete,false);
  assert.match(result.check.note,/diagnostic/i);
  assert.equal(result.diagnostic?.code,"unexpected-error");
  assert.equal(diagnostics.length,1);
  assert.equal((diagnostics[0] as {message:string}).message,"Automatic name verification stopped unexpectedly. Review all listed names before publication.");
  assert.doesNotMatch(result.check.note,/private document text/);
});
