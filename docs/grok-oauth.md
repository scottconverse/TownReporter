# Grok with a SuperGrok subscription

TownReporter can connect directly to xAI with the SuperGrok account you already use. This connection is separate from an xAI API key and does not use DSH, a proxy, or a copied CLI token.

## Connect

1. Sign in as the newsroom owner.
2. Open **Server → Writing models**.
3. Under **Grok (SuperGrok)**, choose **Sign in with SuperGrok**. The click opens a popup immediately and redirects it when xAI returns the device-login URL. If the browser blocks or closes the popup, use the visible authorization link in the card.
4. Enter the one-time code. The xAI approval page identifies the client as **Grok Build**; that is the upstream OAuth client used by the direct integration.
5. Return to TownReporter. It polls for completion, discovers the account's text models, and selects the strongest available model. You can choose another discovered model in the same card.
6. Choose **Test connection** to send one tiny real request. This may count against the subscription.

After connection, **Grok (SuperGrok)** appears in the same model picker used by Story, Scan, Opinion, Dark Desk, Queue batch, and Daily Scan. An explicit Grok choice is the requested first runtime. A recognized technical failure can move only the unfinished call to the next ready runtime and records requested and actual model and effort; a content refusal remains terminal.

## Credential ownership

The newsroom-scoped OAuth credential is encrypted in TownReporter's database with the same server secret used for saved Custom AI keys. It is never returned to the browser, written to documentation, or stored in a job snapshot. Refresh-token rotation is serialized in the database so overlapping model calls cannot overwrite one another.

A failed attempt to reconnect does not delete a previously working credential. **Disconnect** is the explicit action that removes it.

## Model discovery

TownReporter asks xAI for the account's live model catalog and filters obvious image, video, embedding, speech, and moderation products out of the writing-model list. If catalog discovery is temporarily unavailable after a successful login, TownReporter uses the text-model fallback catalog supplied by its pinned OAuth library until **Refresh models** succeeds.

## Implementation and attribution

TownReporter uses `@earendil-works/pi-ai` directly for xAI device-code OAuth, refresh, and inference. The implementation was checked against `dsh-xai` at commit `5946301f992b7445d8dcb26bd9c89dc86246832b`; TownReporter does not import, execute, proxy through, or depend on DSH. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
