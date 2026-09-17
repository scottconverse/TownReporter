# Public corrections page: live read of the production site

**What was checked:** the public corrections route on the live site, read-only, to confirm the submission path is actually wired to an email address rather than only looking like a form.

**Method:** a real browser loaded the page and read the rendered DOM - no credentials, no form submission, no change to production. Script: `scripts/corrections-live-read.mjs`.

```powershell
node scripts/corrections-live-read.mjs
```

**Result (verbatim):**

```json
{
 "url": "https://townreporter.org/corrections",
 "formPresent": 1,
 "mailto": "mailto:townreporter@gmail.com",
 "submitButtonPresent": 1,
 "notConfiguredNotice": 0,
 "mentionsTownReporterAddress": true,
 "saysNotSent": true,
 "errors": []
}
```

## What this proves

- The correction form renders on the live public page.
- Its prepared-message link is `mailto:townreporter@gmail.com` - the address the directive names.
- The "Open correction email" control is present, so the form is wired to the prepared message rather than being decorative.
- The page does **not** show the "has not configured an editor email address" fallback, so the recipient resolved rather than falling through.
- The page states plainly that it has not sent anything and that the reader must review and press Send - it does not claim delivery.
- No browser errors.

**How the recipient resolves** (from `src/components/correction-form.tsx`): the address is `townreporter@gmail.com` when the paper's name is "TownReporter", otherwise the newsroom's configured editor email. If neither resolves, the form is replaced by an explicit "The publication has not configured an editor email address yet" notice instead of a dead form. A newsroom that renames itself therefore gets its own editor address, not TownReporter's.

## What this does not prove

- **Actual delivery.** A `mailto:` hands the message to the reader's own mail client; the product never sends it. Confirming that an email arrives in `townreporter@gmail.com` needs a configured desktop or webmail handler and a human pressing Send in it. That is outside what this environment can do, and it is a boundary of the chosen mechanism rather than a defect the product can fix.
- The reader-side fallback (copy the text and email the editor directly when no mail client is configured) is stated in the page copy but was not exercised.
- The form's field-level behaviour beyond rendering - required-field validation, sessionStorage draft restore - is covered separately by `src/lib/news/reader.test.ts` (2/2) and the desk-flow walk; this read covers the live wiring only.
