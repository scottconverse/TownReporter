// guards: an editor cannot reach dialog actions in a short window or with enlarged text.
import assert from "node:assert/strict";
import { test } from "node:test";
import { dialogBrowser } from "./dialog-browser-harness.mjs";

test("tall dialogs keep their header and actions visible while only the body scrolls", async () => {
  const { browser, page } = await dialogBrowser();
  try {
    for (const [width, height] of [[1440,800],[1440,600],[1100,700],[720,450],[390,844]]) {
      await page.setViewportSize({width,height});
      for (const appearance of ['desk-light','desk-dark']) for (const size of ['normal','large']) for (const kind of [false,true,'reader']) {
        await page.evaluate(({appearance,size,kind}) => {
          document.documentElement.dataset.appearance=appearance;
          document.documentElement.dataset.deskSize=size;
          window.mount(kind);
        }, {appearance,size,kind});
        const dialog=page.locator(kind?'dialog':'[role="dialog"]');
        await dialog.waitFor();
        const geometry = await dialog.evaluate(el => {
          const body=el.querySelector('.astra-modal-body,.astra-dialog-body,.reader-dialog-body'), head=el.querySelector('.astra-modal-head,.astra-dialog-head,.dialoghead'), foot=el.querySelector('.astra-modal-foot,.astra-dialog-foot,.reader-dialog-foot');
          return {top:head.getBoundingClientRect().top,bottom:foot.getBoundingClientRect().bottom,panelTop:el.getBoundingClientRect().top,panelBottom:el.getBoundingClientRect().bottom,scroll:getComputedStyle(body).overflowY,contained:getComputedStyle(body).overscrollBehaviorY};
        });
        assert.ok(geometry.top >= 0 && geometry.bottom <= height, JSON.stringify({width,height,appearance,size,kind,geometry}));
        assert.ok(geometry.panelTop>=12 && geometry.panelBottom<=height-12, 'the whole panel needs a viewport margin: '+JSON.stringify({width,height,kind,geometry}));
        assert.equal(geometry.scroll,'auto');
        assert.equal(geometry.contained,'contain');
        const body=dialog.locator('.astra-modal-body,.astra-dialog-body,.reader-dialog-body');
        await body.focus();
        const scrollable=await body.evaluate(el=>el.scrollHeight>el.clientHeight);
        if(scrollable) {
          await page.keyboard.press('PageDown');
          await page.waitForFunction(()=>document.querySelector('.astra-modal-body,.astra-dialog-body,.reader-dialog-body').scrollTop>0);
          await body.evaluate(el=>el.scrollTop=0);
          await body.hover(); await page.mouse.wheel(0,300);
          await page.waitForFunction(()=>document.querySelector('.astra-modal-body,.astra-dialog-body,.reader-dialog-body').scrollTop>0);
          if(width===1440 && height===600 && size==='normal' && appearance==='desk-light') {
            await body.evaluate(el=>el.scrollTop=0);
            const rect=await body.boundingBox();
            await page.mouse.move(rect.x+rect.width-7,rect.y+Math.min(14,rect.height/4)); await page.mouse.down();
            await page.mouse.move(rect.x+rect.width-7,rect.y+rect.height-26,{steps:5}); await page.mouse.up();
            await page.waitForFunction(()=>document.querySelector('.astra-modal-body,.astra-dialog-body,.reader-dialog-body').scrollTop>0, null, {timeout:3000});
            assert.ok(await body.evaluate(el=>el.scrollTop)>0,'dragging the body scrollbar must scroll: '+JSON.stringify({kind,metrics:await body.evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,gutter:el.offsetWidth-el.clientWidth,scrollTop:el.scrollTop}))}));
            await body.evaluate(el=>el.scrollTop=0); await body.focus();
            await page.keyboard.press('ArrowDown');
            await page.waitForFunction(()=>document.querySelector('.astra-modal-body,.astra-dialog-body,.reader-dialog-body').scrollTop>0);
          }
        }
        await page.mouse.move(5,5); await page.mouse.wheel(0,300);
        await page.waitForTimeout(30);
        assert.equal(await page.evaluate(()=>window.scrollY),0);
        if(kind===false) assert.equal(await page.evaluate(()=>window.closes),0);
        await page.keyboard.press('Tab');
        assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
        assert.equal(await dialog.evaluate(el=>[...el.querySelectorAll('button,select,textarea')].every(control=>control.getBoundingClientRect().height>=44)),true);
      }
    }
  } finally { await browser.close(); }
});
