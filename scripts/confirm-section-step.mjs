/*
  The section, saved and ready to publish, before the story prints.

  Since 0.6.62 the section a draft files under has to be read by a person
  before publication, and the server refuses on its own (desk.ts,
  performPublish) because a disabled button is a suggestion.

  0.6.67 removed the separate "Confirm this section" button. Pressing Publish
  is now the confirmation: the button reads "Publish in <section>" and the
  request carries that section, which performPublish records for the version
  it prints (`cleanPublishRequest` treats an absent topic as "unconfirmed",
  never "confirmed blank"). So there is no button to press here any more.

  What the old click ALSO did was save the draft, and that part is still
  needed: a walk types into the box and the server only ever reads the saved
  version, so a body that names an outlet, or an edit the walk means to print,
  is invisible until it is saved. This helper therefore presses "Save edits"
  when the desk says there are unsaved changes -- the same save-then-publish
  ordering the Confirm button had, and this must run AFTER every edit the walk
  means to publish, because editing the body or the section afterwards puts
  the gate straight back, by design.

  `publishable: false` is for the walk that means to leave the button down.
  scripts/named-outlets-e2e.mjs writes a body that names an outlet and shows
  the reader nothing, on purpose: the named-outlet gate is what it is there to
  photograph, and the override on the story screen is the only way past it
  (desk.ts, performOverrideNamedOutlet). The draft still has to be saved
  there -- the override records against a saved draft, and the notice is
  computed from the saved body -- but waiting for an enabled Publish button
  would wait for a state that walk exists to disprove.
*/

export async function confirmSectionAndWaitForPublishable(page, { publishable = true } = {}) {
  await openStoryDetails(page);
  const block = page.locator("#story-topic");
  await block.waitFor({ state: "visible", timeout: 45_000 });
  /*
    Save first, and only when there is something to save: pressing "Save edits"
    on an already-saved draft is a no-op the desk may well have disabled, and a
    walk that waits on a disabled button would hang on a healthy desk.
  */
  const saveState = page.locator(".astra-save-state");
  if ((await saveState.filter({ hasText: "Unsaved changes" }).count()) > 0) {
    await page.getByRole("button", { name: "Save edits", exact: true }).click();
    /*
      The desk's own word that the server took it -- a click that lands before
      hydration does nothing, and a walk clicks faster than a person.

      `/^Saved/` and not the string "Saved": the line now says "Saved 8:20
      a.m." once the draft has a stamp (unit CW's drawn save line), and a
      string in `hasText` is a CASE-INSENSITIVE SUBSTRING, so "Saved" would
      also match "Unsaved changes" -- the very state this wait exists to leave.
    */
    await saveState.filter({ hasText: /^Saved/ }).waitFor({ timeout: 45_000 });
  }
  if (!publishable) return;
  /*
    The section is named on the button and the desk has not been left with an
    unchosen one. Wait for it to be enabled, so the walk's next click is a
    click on a live button and a failure here says the gate did not clear
    rather than "not enabled".
  */
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (button) => /^Publish in /.test(button.textContent?.trim() ?? "") && !button.disabled,
      ),
    null,
    { timeout: 45_000 },
  );
}

/**
 * Open the story screen's "Story details" disclosure (unit CW2, 0.6.81).
 *
 * `Desk Story.dc.html` draws no Topic, no Geography and no pulled-notes record
 * under the Story editor, so those fields -- the section this helper exists to
 * confirm among them -- moved into one shut `<details id="story-details">`
 * directly under the action row. A shut `<details>` hides its content from the
 * screen, so `#story-topic` is in the DOM but not visible, and every wait or
 * click on it hangs on a healthy desk. The page opens the disclosure itself
 * when one of its own controls needs the field (see `openStoryDetails` in
 * desk.story.$leadId.tsx); a walk has no such control, so it opens the
 * disclosure the way a person would, by pressing its summary.
 *
 * Silent and idempotent on a page that has no such disclosure -- a story with
 * no draft yet -- so callers keep their own assertion: the `#story-topic` wait
 * below still fails, with the message that names the real problem.
 */
export async function openStoryDetails(page) {
  /*
    Wait for the disclosure to be attached before deciding it is not there.

    `page.goto`/`waitForURL` resolve on the navigation, not on the workbench
    having drawn: a walk that clicks a link to a story and opens the disclosure
    on the very next line otherwise asks the page it is LEAVING (script
    import-stories-e2e.mjs measured exactly this -- `#story-topic` resolved
    hidden 89 times against a desk whose disclosure was shut). The bounded wait
    is swallowed because a story with no draft yet carries no disclosure at
    all, and that page's caller must still fail with its own message.
  */
  const details = page.locator("details#story-details").first();
  await details.waitFor({ state: "attached", timeout: 20_000 }).catch(() => {});
  if ((await details.count()) === 0) return;
  if (await details.evaluate((element) => element.open)) return;
  await details.locator("summary").first().click();
  /* The element's own `open`, not a timeout's word for it: a click that lands
     before hydration toggles nothing, and the wait below would report the
     still-shut field rather than the click that did not take. */
  await page.waitForFunction(
    () => document.getElementById("story-details")?.open === true,
    null,
    { timeout: 15_000 },
  );
}
