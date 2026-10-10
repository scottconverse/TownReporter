// guards: reaching the navigation drawer's end scrolls the editor's page behind it.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deskOverlayBrowser} from './dialog-flow-harness.mjs';
test('Today and Dark Desk drawers keep the page still at the end of navigation',async()=>{
  const {browser,page}=await deskOverlayBrowser(`window.mount=(path)=>{window.deskPath=path;root.render(React.createElement(DeskShell,{key:path,title:'Today'},React.createElement('div',{style:{height:3000}},'Editor page')))};window.mount('/desk');`);
  try{
    for(const [path,width,height] of [['/desk',390,844],['/desk/dark',720,450],['/desk/dark',390,844]]){
      await page.setViewportSize({width,height});await page.evaluate(path=>window.mount(path),path);
      await page.getByRole('button',{name:'Menu',exact:true}).click();
      const drawer=page.locator('#desk-navigation');await page.waitForTimeout(250);
      const y=await page.evaluate(()=>window.scrollY);
      await drawer.locator('.astra-nav-body').evaluate(el=>el.scrollTop=el.scrollHeight);
      await drawer.locator('.astra-nav-body').hover();await page.mouse.wheel(0,900);await page.waitForTimeout(100);
      await page.mouse.move(width-5,height/2);await page.mouse.wheel(0,900);await page.waitForTimeout(100);
      assert.equal(await page.evaluate(()=>window.scrollY),y,'background scrolling must be locked');
      await page.keyboard.press('Escape');await page.mouse.move(width-5,height/2);await page.mouse.wheel(0,300);await page.waitForTimeout(100);
      assert.ok(await page.evaluate(()=>window.scrollY)>y,'closing must release the page lock');
    }
  }finally{await browser.close();}
});
