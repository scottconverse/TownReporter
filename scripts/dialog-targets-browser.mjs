// guards: small setup links and native dialog options are too hard to read or press.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deskOverlayBrowser} from './dialog-flow-harness.mjs';
test('dialog model setup links and native option rows have readable 44 pixel targets',async()=>{
  const {browser,page}=await deskOverlayBrowser(`root.render(React.createElement('div',{className:'desk-ltr astra'},React.createElement('button',{onClick:()=>window.mount()},'Set up model')));window.mount=()=>root.render(React.createElement(Dialog,{open:true,title:'Writing model',primaryLabel:'Done',onClose(){}},React.createElement(ModelPicker,{value:'auto',onChange(){}})));window.native=()=>root.render(React.createElement('div',{className:'desk-ltr astra'},React.createElement(NativeDialog,{className:'astra-dialog',ref:el=>el&&!el.open&&el.showModal()},React.createElement('div',{className:'astra-dialog-body'},React.createElement('a',{href:'#',className:'astra-search-result'},'Option'),React.createElement('select',null,React.createElement('option',null,'Choice'))))));`);
  try{
    await page.getByRole('button',{name:'Set up model'}).click();await page.locator('.model-picker-setup > summary').click();
    for(const el of await page.locator('[role="dialog"] :is(summary,select,a)').all()){
      await el.scrollIntoViewIfNeeded();assert.ok(await el.evaluate(el=>el.getBoundingClientRect().height>=44&&parseFloat(getComputedStyle(el).fontSize)>=14),'setup controls need a readable full-height target');
    }
    await page.evaluate(()=>window.native());await page.locator('dialog[open]').waitFor();
    assert.equal(await page.locator('dialog a,dialog select').evaluateAll(els=>els.every(el=>el.getBoundingClientRect().height>=44&&parseFloat(getComputedStyle(el).fontSize)>=14)),true);
  }finally{await browser.close();}
});
