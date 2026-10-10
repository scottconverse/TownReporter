// guards: an editor escapes the unsaved-changes prompt and loses a staged row.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {expect} from 'playwright/test';
import {deskOverlayBrowser} from './dialog-flow-harness.mjs';
test('unsaved row navigation focuses and traps the guard and Escape stays on the page',async()=>{
  const {browser,page}=await deskOverlayBrowser(`function Form(){const [unsaved,set]=React.useState(false);return React.createElement('div',null,React.createElement('input',{'aria-label':'New row',onChange:()=>set(true)}),React.createElement('button',{onClick:()=>window.block()},'Back to Server'),React.createElement(UnsavedChangesGuard,{unsaved,barLabel:'Unsaved',message:'Row not saved',leaveLabel:'Discard row?',primary:{label:'Review',ariaLabel:'Review',onClick(){}},cancelLabel:'Cancel',cancelAriaLabel:'Cancel row',onCancel(){}}));}root.render(React.createElement(Form));`);
  try{
    await page.getByRole('textbox').fill('Local unsaved row');await page.getByRole('button',{name:'Back to Server'}).click();
    const guard=page.getByRole('alertdialog');await guard.waitFor();
    assert.equal(await guard.evaluate(el=>el.contains(document.activeElement)),true,'focus must enter the guard');
    for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await guard.evaluate(el=>el.contains(document.activeElement)),true);}
    await page.keyboard.press('Escape');await guard.waitFor({state:'hidden'});
    assert.equal(await page.getByRole('textbox').inputValue(),'Local unsaved row');
    // Radix restores focus from its deferred unmount callback after the guard is hidden.
    await expect(page.getByRole('button',{name:'Back to Server'})).toBeFocused();
  }finally{await browser.close();}
});
