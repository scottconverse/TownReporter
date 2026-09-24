/*
  The section, confirmed by a person, before the story prints.

  Since 0.6.62 the section a draft files under has to be read and confirmed
  before publication. The desk's Publish button is disabled until an editor
  says yes in the "#story-topic" block, and the server refuses on its own
  (desk.ts, performPublish) because a disabled button is a suggestion.

  A walk that files a lead, types a body and clicks Publish now lands on a
  disabled button -- CI run 36042635212 failed three walks that way, and the
  captured DOM said why in the desk's own words: "Confirm the section first.
  Go to the section". So every walk takes the editor's step first.

  Clicking "Confirm this section" IS the desk's save-then-confirm: it saves
  what is in the editor and then records the confirmation against the version
  it just saved (confirmTopic, desk.story.$leadId.tsx). That ordering is why
  this must run AFTER every edit the walk means to publish -- editing the
  body or the section afterwards puts the gate straight back, by design.
*/
export async function confirmSectionAndWaitForPublishable(page) {
  const block = page.locator("#story-topic");
  await block.waitFor({ state: "visible", timeout: 45_000 });
  const confirm = block.getByRole("button", { name: "Confirm this section" });
  // Already confirmed for the version on screen: the desk shows the record
  // instead of the button, and there is nothing to click.
  if ((await confirm.count()) > 0) {
    await confirm.scrollIntoViewIfNeeded();
    await confirm.click();
    /*
      The button is replaced by the record of what was confirmed. Waiting for
      that text is the proof the server accepted it -- a click that lands
      before hydration does nothing, and a walk clicks faster than a person.
    */
    await block.getByText(/Section confirmed for this saved draft/).waitFor({ timeout: 30_000 });
  }
  /*
    The unconfirmed section is what was holding the button down. Wait for the
    desk to enable it, so the walk's next click is a click on a live button
    and a failure here says the gate did not clear rather than "not enabled".
  */
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Publish to the paper" && !button.disabled,
      ),
    null,
    { timeout: 45_000 },
  );
}
