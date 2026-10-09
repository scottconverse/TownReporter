import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compile} from '@tailwindcss/node';
import {chromium} from 'playwright';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement as h} from 'react';
export async function browserScreen(component,{width=390,dark=false,desk=true,props={}}={}) {
  const markup=renderToStaticMarkup(h(component,props));
  const css=await compile(await readFile('src/styles.css','utf8'),{base:resolve('src'),onDependency(){}});
  const classes=[...markup.matchAll(/class="([^"]*)"/g)].flatMap(m=>m[1].split(/\s+/));
  const browser=await chromium.launch({channel:'chrome'});
  const page=await browser.newPage({viewport:{width,height:844}});
  await page.route('**/*',r=>r.abort());
  await page.setContent(`<html data-appearance="${dark?'reader-dark':'reader-light'}"><style>${css.build([...classes,'desk-ltr','astra','night'])}\n${await readFile('src/desk-astra.css','utf8')}</style><body><main class="${desk?'desk-ltr astra'+(dark?' night':''):''}" style="width:100%;box-sizing:border-box;padding:17px">${markup}</main></body></html>`);
  return {page,close:()=>browser.close()};
}
export async function contrast(page,selector) {
 return page.locator(selector).evaluateAll(nodes=>nodes.map(n=>{
  const rgb=color=>{const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,1,1);return [...x.getImageData(0,0,1,1).data].slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});};
  const lum=color=>{const v=rgb(color);return .2126*v[0]+.7152*v[1]+.0722*v[2];};
  let b=n;while(b.parentElement&&getComputedStyle(b).backgroundColor==='rgba(0, 0, 0, 0)')b=b.parentElement;
  const a=lum(getComputedStyle(n).color),z=lum(getComputedStyle(b).backgroundColor);return (Math.max(a,z)+.05)/(Math.min(a,z)+.05);
 }));
}
