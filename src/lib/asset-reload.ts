/*
  Asset reload: the one recovery for a desk whose own code file would not load.

  The failure this exists for (Oct 15 2026, live /desk right after a deploy):
  the first load requested /assets/reader-DBUvOHP8.js and the request died in
  transit (net::ERR_QUIC_PROTOCOL_ERROR through the tunnel). The file serves
  200 on a second try, and a plain reload loaded everything. But the first
  page sat on the server-rendered pending screen ("Opening the desk / Setting
  type...") with no console error and no request in flight, because the app
  never ran and nothing on the page knew to ask again. A tab opened before a
  deploy has the same shape: it asks for hashed /assets/ files that no longer
  exist.

  So the script reloads the page once when a file under /assets/ fails, and it
  does so because the browser REPORTED the failure, not because a clock ran
  out. A timer cannot tell "the file never arrived" from "the file is still
  arriving on a slow page", and a timed redirect is what threw editors out in
  the first place (see the stranded-visitor note in src/routes/__root.tsx).

  Guard: at most one reload per page path per 60 seconds, recorded in
  sessionStorage. If storage is blocked, the script does not reload at all:
  without the record it cannot prove it is not already in a loop.

  The script is invisible to a reader. It changes nothing React renders and
  stamps nothing on <html>; it only listens. It runs in <head>, before any of
  the app's module scripts, so the capture listener is in place before a
  failed download can report.
*/

const KEY_PREFIX = "tr-asset-reload:";
export const ASSET_RELOAD_WINDOW_MS = 60000;

/**
 * The head script: installs the listeners and does nothing else until one of
 * them sees a failed /assets/ file (or Vite's own preload failure).
 *
 * Plain ES5 on purpose -- it is inline in the document and must run in any
 * browser that can load the page. It is generated from this module so the
 * tests can run the exact text (src/lib/asset-reload.test.ts).
 */
export function assetReloadHeadScript(): string {
  return [
    "(function(){try{",
    "var w=window;",
    // A failed element counts only if it is a script, or a stylesheet or
    // modulepreload link, and its URL is on this origin under /assets/.
    // Images and third-party scripts are none of this script's business.
    "function ownAsset(el){",
    "var t=String(el.tagName).toUpperCase();",
    "var r=el.getAttribute('rel');",
    "var ref=t==='SCRIPT'?el.getAttribute('src'):t==='LINK'&&(r==='modulepreload'||r==='stylesheet')?el.getAttribute('href'):null;",
    "if(!ref)return false;",
    "var u=new URL(ref,w.location.href);",
    "return u.origin===w.location.origin&&u.pathname.indexOf('/assets/')===0;",
    "}",
    // Blocked storage (or a stored value we cannot read) means no reload:
    // a reload we cannot record could repeat forever.
    "function reloadOnce(){",
    `var key=${JSON.stringify(KEY_PREFIX)}+w.location.pathname;`,
    "try{",
    "var last=Number(w.sessionStorage.getItem(key));",
    "var age=Date.now()-last;",
    `if(last&&age>=0&&age<${ASSET_RELOAD_WINDOW_MS})return;`,
    "w.sessionStorage.setItem(key,String(Date.now()));",
    "}catch(e){return;}",
    "w.location.reload();",
    "}",
    "w.addEventListener('error',function(e){try{if(e.target&&ownAsset(e.target))reloadOnce();}catch(x){}},true);",
    // Vite dispatches this when a dynamic import's preload fails. Preventing
    // the default keeps Vite from throwing it into the app; the reload (or the
    // app's own import error, if the guard held) is the handling.
    "w.addEventListener('vite:preloadError',function(e){e.preventDefault();reloadOnce();});",
    "}catch(e){}})();",
  ].join("");
}
