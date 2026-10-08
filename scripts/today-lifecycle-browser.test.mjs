// guards: Today could invite the editor to finish and print a killed story.
import assert from "node:assert/strict";
import { test } from "node:test";
import { browserFixture } from "./lifecycle-browser-harness.mjs";

test("Today In progress shows open drafts and omits killed and published stories", async (t) => {
  const page = await browserFixture(t, `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {TodayInProgress} from './src/components/today-in-progress.tsx';
    const leads=[{id:440,status:'killed'},{id:437,status:'killed'},{id:415,status:'killed'},
      {id:22,status:'new',article_slug:'published-story'},{id:23,status:'drafted'}];
    const jobs=leads.map(l=>({id:l.id,leadId:l.id,kind:'draft',status:'completed',headline:'Story '+l.id}));
    function Desk(){const [today,setToday]=React.useState(false);return <>
      <button onClick={()=>setToday(true)}>Today</button>{today&&<TodayInProgress jobs={jobs} leads={leads}
        isError={false} isPending={false} refetch={()=>{}}/>}</>}
    createRoot(document.getElementById('root')).render(<Desk/>);`);
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const strip = page.getByRole("region", { name: "In progress", exact: true });
  await strip.getByRole("link", { name: "Story 23", exact: true }).waitFor();
  assert.deepEqual(await strip.locator("h3").allTextContents(), ["Story 23"]);
  await strip.getByRole("link", { name: "Open draft", exact: true }).click();
  assert.equal(await page.evaluate(() => location.hash), "#23");
});
