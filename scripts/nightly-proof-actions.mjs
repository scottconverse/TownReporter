/** The story's primary draft action; the empty-state action has the same name. */
export function storyDraftButton(page) {
  return page
    .locator(".astra-story-actions")
    .getByRole("button", { name: /^Draft with AI$|^Redraft$/ });
}
