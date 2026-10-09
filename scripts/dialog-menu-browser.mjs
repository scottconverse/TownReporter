// guards: action menus hide editor actions behind navigation or outside a short window.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deskOverlayBrowser} from './dialog-flow-harness.mjs';
test('action menus keep every action reachable above navigation by mouse and keyboard',async()=>{
  const {browser,page}=await deskOverlayBrowser(`root.render(React.createElement(DeskShell,{title:'Story'},React.createElement('div',{style:{position:'fixed',left:240,top:260}},React.createElement(DeskMoreMenu,{items:Array.from({length:10},(_,i)=>({label:'Action '+i,onSelect(){window.chosen=i}}))}),React.createElement('details',{className:'row-more story-more'},React.createElement('summary',{className:'btn quiet'},'Story more'),React.createElement('div',{className:'row-more-panel'},['Preview','Checks','Compare'].map(label=>React.createElement('button',{key:label,onClick(){window.chosen=label}},label)))))));`);
  try{
    for(const [width,height] of [[720,450],[390,844],[1100,600]]){
      await page.setViewportSize({width,height});
      for(const selector of ['.more','.story-more']){
        const menu=page.locator(selector);await menu.locator(':scope > summary').click();
        const panel=menu.locator('.more-menu,.row-more-panel');await page.waitForTimeout(30);const box=await panel.boundingBox();
        assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=height,JSON.stringify({width,height,box}));
        for(const control of await panel.locator('button').all()){
          await control.focus();await control.scrollIntoViewIfNeeded();
          assert.equal(await control.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'sidebar must not cover an action');
        }
        await panel.locator('button').last().click();if(await menu.evaluate(el=>el.open))await menu.locator(':scope > summary').click();
      }
    }
  }finally{await browser.close();}
});
