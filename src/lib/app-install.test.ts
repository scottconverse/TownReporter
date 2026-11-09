import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { installBarMode, isAndroidDevice, isIosDevice } from "./app-install.ts";

/*
  What the install bar offers, decided without a browser.

  The bar is the only thing on a phone that tells a reader the paper can live on
  their home screen, and it has to be right about which instruction it gives: an
  "Install" button that no browser will honour is worse than no bar at all, and
  Safari has nothing to prompt with. `installBarMode` is a pure function so every
  branch -- including iPadOS lying about being a Mac -- can be pinned here.
*/

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const MAC_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";

const plain = {
  maxTouchPoints: 0,
  standalone: false,
  closed: false,
  hasPrompt: false,
};

describe("installBarMode", () => {
  it("offers the button to Android once the browser has a prompt in hand", () => {
    assert.equal(installBarMode({ ...plain, userAgent: ANDROID, maxTouchPoints: 5, hasPrompt: true }), "install");
  });

  it("gives Android the browser-menu line when no prompt fired (e.g. Firefox)", () => {
    assert.equal(installBarMode({ ...plain, userAgent: ANDROID_FIREFOX, maxTouchPoints: 5 }), "android-steps");
  });

  it("gives an iPhone the two Safari steps, because Safari has no prompt", () => {
    assert.equal(installBarMode({ ...plain, userAgent: IPHONE, maxTouchPoints: 5 }), "ios-steps");
    assert.equal(installBarMode({ ...plain, userAgent: IPAD, maxTouchPoints: 5 }), "ios-steps");
  });

  it("treats iPadOS's desktop Macintosh user agent as an iPad", () => {
    assert.equal(isIosDevice(IPAD_AS_MAC, 5), true);
    assert.equal(installBarMode({ ...plain, userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }), "ios-steps");
  });

  it("says nothing on a desk screen, prompt or no prompt", () => {
    assert.equal(installBarMode({ ...plain, userAgent: WINDOWS, hasPrompt: true }), "none");
    assert.equal(installBarMode({ ...plain, userAgent: MAC_DESKTOP }), "none");
    assert.equal(isIosDevice(MAC_DESKTOP, 0), false);
    assert.equal(isAndroidDevice(MAC_DESKTOP), false);
  });

  it("says nothing inside the installed app, even on an Android phone", () => {
    assert.equal(
      installBarMode({ ...plain, userAgent: ANDROID, maxTouchPoints: 5, hasPrompt: true, standalone: true }),
      "none",
    );
    assert.equal(
      installBarMode({ ...plain, userAgent: IPHONE, maxTouchPoints: 5, standalone: true }),
      "none",
    );
  });

  it("stays hidden on a phone where the reader already closed it", () => {
    assert.equal(
      installBarMode({ ...plain, userAgent: ANDROID, maxTouchPoints: 5, hasPrompt: true, closed: true }),
      "none",
    );
    assert.equal(installBarMode({ ...plain, userAgent: IPHONE, maxTouchPoints: 5, closed: true }), "none");
  });
});
