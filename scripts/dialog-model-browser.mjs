// guards: the Queue model chooser puts setup and model controls outside the window.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deskOverlayBrowser,queueFixture} from './dialog-flow-harness.mjs';
test('Queue model choices and setup remain reachable at every desk size',async()=>{
  const {browser,page}=await deskOverlayBrowser(queueFixture);
  try {
    for(const [width,height] of [[1440,900],[1440,700],[1100,600],[720,450],[390,844]])for(const theme of ['desk-light','desk-dark'])for(const size of ['normal','large']){
      await page.setViewportSize({width,height});
      await page.evaluate(({theme,size})=>{document.documentElement.dataset.appearance=theme;window.deskSize=size;window.mount();},{theme,size});
      const more=page.locator('.more');if(!await more.evaluate(el=>el.open))await more.locator(':scope > summary').click();
      const chooser=page.locator('.queue-draft-controls > details');if(!await chooser.evaluate(el=>el.open))await chooser.locator(':scope > summary').click();
      const setup=page.locator('.model-picker-setup');if(!await setup.evaluate(el=>el.open))await setup.locator('summary').click();
      const panel=page.locator('.more-menu');
      const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,JSON.stringify({width,height,theme,size,box}));
      assert.equal(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth),true,'chooser must not scroll sideways');
      for(const control of await panel.locator('select,summary,a').all()){
        await control.focus();await control.scrollIntoViewIfNeeded();const rect=await control.boundingBox();
        assert.ok(rect.x>=0&&rect.x+rect.width<=width&&rect.y>=0&&rect.y+rect.height<=height,'every chooser control must fit');
      }
    }
  }finally{await browser.close();}
});
