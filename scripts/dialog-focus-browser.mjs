// guards: closing search, preview or an editing dialog loses the editor's place in the action menu.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {deskOverlayBrowser} from './dialog-flow-harness.mjs';
test('search preview and menu dialogs trap focus and return it to the visible opener',async()=>{
  const {browser,page}=await deskOverlayBrowser(`function Screen(){const [kind,set]=React.useState(null);const native=React.useRef(null);const isNative=['Search','Preview'].includes(kind);React.useEffect(()=>{if(isNative)native.current.showModal()},[isNative,kind]);return React.createElement(DeskShell,{title:'Queue'},React.createElement(DeskMoreMenu,{items:['Search','Preview','Edit','Hold','Kill','Correction','Removal'].map(label=>({label,onSelect:()=>set(label)}))}),React.createElement('details',{className:'row-more story-more'},React.createElement('summary',{className:'btn'},'Story more'),React.createElement('div',{className:'row-more-panel'},React.createElement('button',null,'Details action'))),React.createElement(NativeDialog,{ref:native,className:'astra-dialog',onClose:()=>set(null)},React.createElement('div',{className:'astra-dialog-head'},'Preview'),React.createElement('div',{className:'astra-dialog-body',tabIndex:0},React.createElement('input')),React.createElement('div',{className:'astra-dialog-foot'},React.createElement('button',{onClick:()=>native.current.close()},'Done'))),React.createElement(Dialog,{open:!!kind&&!isNative,title:kind||'Edit',primaryLabel:'Save',onClose:()=>set(null)},React.createElement('input')));}root.render(React.createElement(Screen));`);
  try{
    const more=page.locator('.more > summary');
    for(const action of ['Edit','Hold','Kill','Correction','Removal','Search','Preview']){
      await more.click();await page.getByRole('button',{name:action,exact:true}).click();
      const dialog=page.locator('dialog[open],[role="dialog"]');await dialog.waitFor();
      assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true,action+' must receive focus');
      for(let i=0;i<10;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true,action+' must trap Tab');}
      await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await page.waitForTimeout(30);
      assert.equal(await more.evaluate(el=>el===document.activeElement),true,action+' must return to More');
    }
    await page.locator('.story-more > summary').click();await page.keyboard.press('Escape');
    assert.equal(await page.locator('.story-more').evaluate(el=>el.open),false,'Details menus close on Escape');
  }finally{await browser.close();}
});
