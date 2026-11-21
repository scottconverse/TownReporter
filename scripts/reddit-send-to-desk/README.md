# Send to Desk

A Chrome extension with one job: read the Reddit posts already on the tab you
are looking at, and put them on the TownReporter Dark Desk as a review list you
can tick and file.

It runs only when you click its toolbar button. It makes no requests to Reddit,
opens no hidden pages, scrolls nothing, logs in to nothing and keeps no
schedule. It reads the page's visible post elements, keeps up to 50 posts, and
stops with "No posts found on this page." if there is nothing to read (a block,
a login wall, an empty feed).

## Load it unpacked

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose this folder
   (`scripts/reddit-send-to-desk/`).
4. Pin the extension so its button is visible.

## Use it

1. Open Reddit (`reddit.com`, `www.reddit.com` or `old.reddit.com`) in your own
   Chrome and let the posts you want load on screen.
2. Click the extension's toolbar button.
3. The Dark Desk opens in a new tab at `https://townreporter.org/desk/dark`.
4. In "Signals to review" you get a review list: tick the posts you want and
   press the file button. Nothing is filed until you do; filing uses the desk's
   normal tip path, including its sign-in check and its de-dup.

## Files

| File | Job |
| --- | --- |
| `manifest.json` | MV3 manifest. `activeTab` + `scripting`; no `host_permissions`; no Reddit access beyond the tab you click on. |
| `background.js` | The click handler: check the host, inject the collector, validate, store, open the desk. |
| `collector.js` | Read-only DOM collection, injected into the Reddit tab (`shreddit-post` and old Reddit `div.thing`), plus the on-page message box. |
| `parse.js` | Pure validation: permalink host/shape, field caps, de-dup, 50-post limit. |
| `desk-bridge.js` | Content script on the desk origin: hands the stored posts to the page with `postMessage` when the page asks. |

## Pointing it at a local desk

`DESK_URL` in `background.js` is `https://townreporter.org/desk/dark`. The
desk also accepts `http://127.0.0.1:3100/desk/dark` (the local dev origin, see
`desk-bridge.js`'s `matches`); change that one constant to use the local desk.
