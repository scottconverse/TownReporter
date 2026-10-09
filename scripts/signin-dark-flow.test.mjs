// guards: a light sign-in screen must not flash against the editor's stored dark appearance.
import assert from 'node:assert/strict';import {test} from 'node:test';
import {screenModule} from './screen-render-harness.mjs';import {browserScreen,contrast} from './bug-sweep-browser.harness.mjs';
const screen=await screenModule('src/routes/login.tsx',{createFileRoute:`()=>options=>({...options,useSearch:()=>({})})`,useCurrentUserState:`()=>({user:null})`,useNavigate:`()=>()=>{}`,Link:`({children,...props})=>h('a',props,children)`,inputClass:`'login-input'`,inkSolid:`'bg-ink text-paper'`,inkGhost:`'text-ink'`},['@/lib/news/desk-copy']);
test('sign-in follows dark appearance at desktop and phone sizes',async()=>{
 globalThis.screenData={'desk-claim':{claimed:true}};
 for(const width of [1440,390]){const {page,close}=await browserScreen(screen.Route.component,{width,dark:true,desk:false});try{
   await page.locator('input[type="email"]').click();
   for(const appearance of ['reader-dark','desk-dark']){
    await page.evaluate(a=>document.documentElement.dataset.appearance=a,appearance);
    const color=await page.locator('.r2-login').evaluate(n=>getComputedStyle(n).backgroundColor);assert.equal(color,'rgb(27, 25, 22)');
    assert.ok((await contrast(page,'.r2-login h1,.r2-login label,.r2-login input')).every(r=>r>=4.5));
   }
 }finally{await close();}}
});
