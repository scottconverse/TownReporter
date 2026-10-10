// guards: quickly closing an action menu throws and leaves its overlay lifecycle broken.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deskOverlayBrowser} from './dialog-flow-harness.mjs';
test('an action menu can close before its native toggle event mounts the popover',async()=>{
  const {browser,page}=await deskOverlayBrowser(`root.render(React.createElement(DeskMoreMenu,{items:[{label:'Edit'}]}));`);
  try{
    const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.locator('.more').waitFor();
    await page.evaluate(()=>{const menu=document.querySelector('.more');menu.open=true;menu.open=false;});
    await page.waitForTimeout(50);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
