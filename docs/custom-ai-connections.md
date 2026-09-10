# Add your own AI API

TownReporter can use a saved OpenAI-compatible API connection for a specific
Scan, Story draft, Opinion, or Dark Desk run. The connection is an optional
operator setting: it does not install or manage a provider, change
**Automatic**, or change any existing default or fallback behavior.

## Add a connection

Open **Server** and find **Add your own AI API**.

1. Enter a **Connection name** so editors can recognize it in the model picker.
2. Enter the provider's **Base URL**. It must be an HTTP or HTTPS URL without
   credentials, query parameters, or a fragment. An OpenAI-compatible server
   commonly uses a URL ending in `/v1`, such as
   `http://127.0.0.1:4000/v1`.
3. Enter an **API key** only if the server requires one. The key is encrypted
   and stored on the server; it is not returned to the browser and is never
   shown again. TownReporter sends it as a Bearer credential when it calls the
   saved endpoint.
4. Choose a **Model id**, or leave it blank and save first. The connection's
   **Discover models** action reads the endpoint's `/models` response and
   presents the returned ids. If discovery is unsupported or returns nothing,
   enter the model id manually and save the changes.
5. Select **Save connection** (or **Save changes** while editing).

The endpoint must support the OpenAI-compatible `/chat/completions` protocol.
The URL is validated when saved, but saving itself does not call a model.

## Test and manage it

Each saved connection shows its base URL, selected model (or “model not
chosen”), and whether a key is stored.

- **Discover models** calls `/models`; the connection must be enabled.
- **Test connection** sends a small prompt to the saved model after a
  confirmation. It may incur provider charges. The result reports latency and
  the chat-completions capability directly exercised by this test. Responses
  API and model discovery are shown as not tested; discovery is a separate
  action, and an untested capability is not necessarily unsupported.
- **Edit** changes the name, base URL, or model. Leave the key field blank to
  retain the stored key. While editing, select **Remove the stored API key** to
  clear it explicitly.
- **Disable** keeps the saved record but makes it unavailable to model pickers,
  discovery, testing, and runs.
- **Enable** makes a disabled record usable again.
- **Delete** permanently removes the saved connection and cannot be undone.

Connection management does not invoke a model except for **Test connection**.
It also does not switch the desk's current model choice.

## Use it for a run

After the connection has an enabled model, it appears by its saved name in the
model picker. Select that named connection explicitly for the desk operation,
then start the operation. The selected connection is pinned to the queued job.

- **Scan** is queued and runs against the selected custom endpoint. An explicit
  custom choice does not fail over to Claude, Codex, Automatic, a local model,
  or another paid endpoint. If the connection is later disabled, deleted, or
  has no model, the run fails closed and asks the editor to choose another
  model.
- **Opinion** is queued and uses the selected custom endpoint for its one-pass
  editorial call. The configured editorial voice is read on the server and
  sent as the request's private system message only to the explicitly selected
  endpoint; it is not sent to Automatic or an implicit fallback. The voice file
  must be outside the public repository and configured with
  `TOWNREPORTER_VOICE_FILE` as described in the [Opinion voice setup guide](setup.md#the-opinion-voice).
- Custom Opinion is an OpenAI-compatible one-pass path. Unlike the Claude
  Opinion path, it does not run Claude Code's separate WebSearch/WebFetch
  research loop; it writes from the subject, pointers, and supplied newsroom
  context available to the queued request.

The model picker labels an explicit custom choice as “Uses only … for this
run; no fallback.” Provider usage charges and retention/privacy policies still
belong to the endpoint operator, so review those policies before sending
newsroom material.

## Optional LiteLLM example

LiteLLM is one possible separately operated gateway; it is not required. For
example, a gateway might expose:

| Field | Example |
| --- | --- |
| Connection name | `Newsroom LiteLLM` |
| Base URL | `http://127.0.0.1:4000/v1` |
| API key | a LiteLLM virtual key, if authentication is enabled |
| Model id | `newsroom-writer` (your configured alias) |

Configure and start LiteLLM separately, then save these values in TownReporter
and test the connection. See LiteLLM's [official proxy setup guide](https://docs.litellm.ai/docs/proxy/quick_start).
No LiteLLM installation is needed when another provider already exposes the
required compatible API. Keep a gateway bound to a trusted interface and
follow its authentication and TLS guidance.

## Backups and key recovery

The encrypted key depends on the server's `BETTER_AUTH_SECRET`. Backups that
restore the database must preserve that secret too. If the secret is changed
or lost, saved keys cannot be decrypted; enter them again through **Edit**.
