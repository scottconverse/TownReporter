// guards: desk overlays hide controls or lose the editor's keyboard position.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { rolldown } from 'rolldown';
import { chromium } from 'playwright';

// Real UI components, with inert query results and services. No app or network.
export async function deskOverlayBrowser(fixture) {
  const stubs = {
    '@tanstack/react-query': `export function useQuery({queryKey}){return {data:queryKey[0]==='custom-ai-connections'?[]:undefined};} export function useMutation(){return {};} export function useQueryClient(){return {};}`,
    '@tanstack/react-router': `import React from 'react'; export const Link=({children,to,...props})=>React.createElement('a',{...props,href:to},children); export const useNavigate=()=>()=>{}; export const useRouterState=({select})=>select({location:{pathname:window.deskPath||'/desk',hash:''}}); export function useBlocker(){const [status,setStatus]=React.useState('idle');window.block=()=>setStatus('blocked');return {status,reset:()=>setStatus('idle'),proceed:()=>{throw Error('discard forbidden')}};}`,
    '@/lib/news/provider-availability': `export const providerAvailability=()=>{},localModelCatalog=()=>{},refreshLocalModelCatalog=()=>{};`,
    '@/lib/news/provider-settings': `export const getLocalModelChoice=()=>{},saveLocalModelFn=()=>{};`,
    '@/lib/news/custom-ai-settings': `export const getCustomAiConnectionsFn=()=>[];`,
    '@/lib/news/claim': `export const myDesk=()=>{},leaveEditor=()=>{};`,
    '@/lib/auth/client': `export const signOut=()=>{};`,
    '@/lib/news/dark': `export const listInvestigations=()=>[];`,
    '@/lib/news/desk': `export const listFollowUps=()=>[],listLeads=()=>[],countDraftsDesk=()=>0;`,
    '@/lib/news/opinion': `export const listEditorials=()=>[];`,
    '@/lib/appearance-context': `export const useAppearance=()=>({appearance:{desk:'light',size:window.deskSize||'normal'},setDesk(){}});`,
    '@/components/desk-chrome-utils': `export const announceToDesk=()=>{};export const deskShellClassName=({size})=>'desk-ltr '+(size==='large'?'large':'');`,
    '@/components/desk-toaster': `export const DeskToaster=()=>null;`,
    '@/components/JobCard': `export const DeskJobCard=()=>null;`,
    '@/components/job-card-state': `export const useDeskJobs=()=>({data:[]});`,
    '@/components/dialogs': `export const NewStoryDialog=()=>null;`,
    './preflight.ts': `export const LOCAL_MODEL_UNCONFIGURED='Unavailable',localServerName=()=>'';export const looksLikeProviderAuthFailure=()=>false,providerAuthTarget=()=>'';`,
  };
  const bundle=await rolldown({input:'overlay-fixture',cwd:resolve(import.meta.dirname,'..'),transform:{jsx:'react-jsx'},plugins:[{
    name:'overlay-fixture',
    resolveId(id){
      if(id==='overlay-fixture'||id in stubs)return '\0'+id;
      if(id.startsWith('@/')){const path=resolve(import.meta.dirname,'../src',id.slice(2));return extname(id)?path:['.tsx','.ts'].map(ext=>path+ext).find(existsSync);}
    },
    load(id){if(id==='\0overlay-fixture')return `import React from 'react';import {createRoot} from 'react-dom/client';import {DeskMoreMenu,DeskShell,InkButton} from './src/components/desk-chrome.tsx';import {ModelPicker} from './src/components/model-picker.tsx';import {Dialog,NativeDialog,DialogScrim} from './src/components/dialog.tsx';import {UnsavedChangesGuard} from './src/components/unsaved-changes-guard.tsx';const root=createRoot(document.getElementById('root'));${fixture}`;if(id.slice(1) in stubs)return stubs[id.slice(1)];},
  }]});
  const {output}=await bundle.generate({format:'iife'});await bundle.close();
  const browser=await chromium.launch({ignoreDefaultArgs:['--hide-scrollbars']});const page=await browser.newPage();
  await page.route('**/*',route=>route.abort());
  await page.setContent('<html><body style="margin:0"><div id="root"></div></body></html>');
  for(const file of ['styles.css','desk-astra.css','reader-astra.css'])await page.addStyleTag({content:await readFile(new URL('../src/'+file,import.meta.url),'utf8')});
  await page.addScriptTag({content:output[0].code});return {browser,page};
}

export const queueFixture = `window.mount=()=>root.render(React.createElement('div',{className:'desk-ltr astra '+(window.deskSize==='large'?'large':''),style:{padding:24,display:'flex',justifyContent:'end'}},React.createElement(DeskMoreMenu,{items:[{label:'Draft',content:React.createElement('div',{className:'queue-draft-controls'},React.createElement('details',null,React.createElement('summary',{className:'meta'},'Model: Automatic · change'),React.createElement(ModelPicker,{value:'auto',compact:true,onChange(){},effort:null,onEffortChange(){}})))}]})));window.mount();`;
