# Local models

## Ollama Cloud is an optional hosted choice

If the TownReporter host is signed in to Ollama and has Cloud models available,
the model picker lists them in the Ollama group and labels them **Ollama Cloud**.
These requests run on Ollama's hosted service; they are not processed on the
TownReporter computer. They may consume the operator's Ollama allowance or
incur charges. LM Studio, on-device Ollama models, and llama.cpp remain available.

Choose **Local model** for a Story, Scan, Opinion, Dark Desk, or forced-model
run, then choose the exact model below it. TownReporter remembers a separate
model for each of those five jobs. An older, unscoped saved choice remains a
fallback until the editor makes a choice for that job. Refresh the catalog if
the Ollama model list changes.

On 23 September 2026, four Ollama Cloud candidates were given the same short
Longmont council evidence packet. `glm-5.2:cloud` produced the cleanest brief;
`deepseek-v4.1-flash:cloud` produced a usable one. `qwen3.5:397b-cloud`
returned no answer at the default output budget unless reasoning was explicitly
off; with it off, the answer made unsupported claims. `glm-5.3-flash:cloud`
spent its budget on reasoning even with a no-reasoning request. Those last two
remain selectable, but this short comparison does not qualify them as defaults
for unattended publishing. A short brief is also not proof of long meeting
draft quality or PDF understanding.

Install [Ollama](https://ollama.com). Run `ollama pull gemma4:12b` (or any
model you like). Start TownReporter. The Writing model picker lists it under
**Local model** — nothing else to configure.

Also works with no config: LM Studio (start its server) · llama.cpp
(`llama-server -m <model.gguf>`).

The model shown in the picker is the model TownReporter preflights and calls.
Automatic discovery supplies both its local address and model name; `LLM_BASE_URL`
and `LLM_MODEL` are optional overrides. If a server is started after the desk,
open **Model & research** and click **Refresh**. A reachable model must never be
shown as loaded while the writing action reports that environment variables are
missing.

Overrides, only if you need one:

```
LLM_BASE_URL=http://127.0.0.1:11434/v1   # point at a specific server/model instead of discovering one
LLM_MODEL=gemma4:12b                     # pick a specific model on that server
LLM_REASONING_EFFORT=none                # force thinking off/on instead of the automatic guess
TOWNREPORTER_LOCAL_DISCOVERY=0           # turn off probing the default ports entirely
```

For scanned PDFs, pick a model marked **· vision** — an ordinary text-only
local model cannot read a scan's page images.

## What was measured, and why local isn't the answer everywhere


**Measured 29 August 2026 on the machine that runs townreporter.org.**

This machine has 24 local models on disk and an LM Studio server already
running. The obvious question is why the newsroom pays a frontier model to do
grunt work when a 35B is sitting idle a few milliseconds away.

The answer is that it was tried, on the real prompt, and the local model found
about **half** as much. What follows is the evidence, so nobody has to run it
again in a month.

---

## The machine

|              |                                                          |
| ------------ | -------------------------------------------------------- |
| System RAM   | 63.8 GB (44.7 free at the time of the test)              |
| GPU          | AMD Radeon 8060S, **64 GB** of the 128 GB unified pool   |
| Local models | 24 on this box, up to `gpt-oss-120b` (63 GB)             |
| Server       | LM Studio, OpenAI-compatible, `http://127.0.0.1:1234/v1` |

`gpt-oss-120b` is 63.39 GB against a 64 GB pool. It loads and then has no room
left for context, so it was not tested.

---

## What the newsroom actually spends model calls on

Eight distinct jobs, one entry point (`grokChat`) for seven of them.

| Job                  | Output cap | Fires                   | Local?                                     |
| -------------------- | ---------- | ----------------------- | ------------------------------------------ |
| Scan → leads         | 3,500 tok  | once per scan           | maybe                                      |
| Draft: research pass | 900 tok    | once per draft          | **yes, fair candidate**                    |
| Draft: write         | 2,200 tok  | once per draft          | no — readers see this                      |
| Draft: edit          | —          | once per draft          | no                                         |
| **Dark planner**     | 2,200 tok  | **up to 25× per round** | **the whole question**                     |
| Dark synthesis       | 3,200 tok  | once per round          | no — this is the judgment                  |
| Dark brief           | 1,200 tok  | once per round          | no                                         |
| Editorial            | —          | on request              | no — needs web tools and the private voice |

The planner is the only job with the volume to be worth moving. Everything else
fires once or twice.

---

## The test

The real `DARK_PLANNER` system prompt, the real per-call settings from
`investigate.ts` (`max_tokens: 2200`, `temperature: 0.3`), and a realistic
mid-investigation pack. Identical input to every model. Output scored by
counting the items the desk actually consumes — searches, URLs to fetch,
entities, relationships, hypotheses, claims, frontier items, anomalies, dead
ends, questions — and parsed with the app's own `parseJsonBlock`.

|                              | median items | median wall | cost       | runs |
| ---------------------------- | ------------ | ----------- | ---------- | ---- |
| `gemma-4-12b-it-qat` (local) | 22           | 31 s        | $0         | 1    |
| `qwen3.6-35b-a3b` (local)    | **26**       | 37 s        | $0         | 4    |
| `claude-haiku-4-5`           | **50**       | 63 s        | ~$0.08/hop | 3    |

Every successful local run: 26, 24, 30. Every successful Haiku run: 53, 50.
The gap is consistent, not sampling noise. **Local finds about 52% of what
Haiku finds.**

Going from 12B to 35B bought four items for twenty gigabytes of model.

The shape of the difference matters more than the count. On the same pack the
35B proposed **3 URLs to fetch; Haiku proposed 10**. That is the digging. The
35B's three hypotheses were three rewordings of "the minutes are somewhere else
or delayed" — the obvious guess. Its searches were sensible (`site:` queries
against the second records domain, the clerk, the CORA page); it simply saw
fewer threads to pull.

### Speed is not the problem

|                            |                                             |
| -------------------------- | ------------------------------------------- |
| 12B decode                 | 61.5 tok/s                                  |
| 35B decode                 | ~60 tok/s                                   |
| Full 24,000-character pack | 7,033 prompt + 1,200 completion in **25 s** |
| 35B load time              | 19 s, 20.55 GiB resident                    |

Local is _faster_ than the Claude Code CLI (37 s against 63 s), because the CLI
reloads a ~25,000-token preamble on every call. Speed is an argument for local.
It just is not the argument that decides this.

---

## Two things the test turned up that matter more than the verdict

### Reasoning models break the app silently

`qwen3.6-35b-a3b` is a reasoning model. At the app's real setting of
`max_tokens: 2200` it spent the **entire budget** on `reasoning_content` and
returned `content: ""` with `finish_reason: "length"`. Empty answer, no error.

The app reads `message.content`, gets nothing, fails to parse it, and falls back
to the keyword heuristic. Any reasoning model dropped in behind `LLM_BASE_URL`
fails exactly this way. It needs roughly 8,000 output tokens to answer the same
prompt at all — at which point it used 1,743.

**If you point this app at a local model, check whether it thinks first.**

### The frontier model refuses sometimes too

One Haiku run in three did not return a plan. It returned:

> **Permission required.** This non-interactive session needs authorization to
> run WebSearch and WebFetch.

…and offered three options to choose from. Unparseable, and the desk falls back
to the heuristic. The planner is deliberately called with no tools, and it
sometimes objects rather than working without them.

Since 0.5.1 this is at least recorded: a round that fell back appends
_"Planner fell back on N of M hops: …"_ to its summary. Before that it was
silent, which is how a completely dead planner went unnoticed until the database
was found to contain zero entities, claims and hypotheses.

---

## What changed after these measurements

The measurements above are still the dated evidence for the Dark Desk planner,
but the application is no longer all-or-nothing. TownReporter now has per-run
Story routing and a separate Opinion frontier path:

| Work               | Current provider rule                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Scan and Dark Desk | the configured provider (`LLM_*`, Anthropic, Claude Code, or Grok), or an explicit picker choice including Local model            |
| Story — Automatic  | configured `LLM_*` gateway when present; otherwise first ready Codex Terra → Claude Sonnet rung                                    |
| Story — named      | Codex Astra, Sol, Terra or Luna; Claude Fable, Opus, Sonnet or Haiku; Local model; Grok; or a saved custom connection is tried first; recognized technical failures move only the unfinished call |
| Dark — Automatic   | configured gateway when present; otherwise Codex Terra → Claude Sonnet; technical retry is per failed call and does not replay searches or completed reads |
| Opinion            | Automatic uses Codex Sol → Claude Sonnet; a named choice is tried first and the same technical-only per-call retry applies |

Pointing `LLM_BASE_URL` at LM Studio therefore makes that gateway the configured
provider for Scan and Dark Desk and the forced provider for **Story Automatic**.
It does not capture an explicit Story choice, and it does not route Opinion.
The model picker stores the selected/effective provider on each durable run.

---

## Verdict

**Do not move the dark planner to a local model.** Half the leads on the job
that runs 25 times a round is the wrong trade, and there is no money being
saved — this newsroom runs on a Claude Code subscription, not an API key, so
the currency is rate-limit headroom rather than dollars.

Still open, in rough order of merit:

1. **Scan.** Big input, structured output; the local 262K context is a genuine
   advantage and the prefill numbers say it would keep up. Untested.
2. **A stronger local model.** `gpt-oss-120b` needs a smaller quant to leave
   room for context. Whether it reaches Haiku on this task is unknown.
3. **Re-test the full Story lane after a model/runtime change.** The release
   gate tried the loaded `qwen/qwen3.6-35b-a3b` through the real multi-pass
   Story product and it did not complete. The Local Qwen picker choice was
   removed 2026-09-02; a local model is reachable through `LLM_BASE_URL`, now
   also as the named "Local model" pick on every picker (0.6.10).

What would change the answer: a local model that proposes eight or ten URLs per
hop instead of three. Nothing smaller than that is worth the wiring.

---

## Reproducing this

The prompt is `DARK_PLANNER` in `src/lib/news/dark-prompt.ts`. Send it to any
OpenAI-compatible endpoint with `max_tokens: 2200`, `temperature: 0.3`, and a
mid-investigation pack as the user message. Score by counting array items in the
parsed JSON. Run each model at least three times — the first single-run
comparison of 12B against 35B looked like a 4-item difference and was inside the
noise; only the Haiku gap survived repetition.

---

## The local model, as a named pick (0.6.10)

As of 0.6.2 a new writing model was config plus one registry entry, not a code
change spread across four files. Everything the desk knows about a writing
model lives in `PROVIDER_REGISTRY`, in `src/lib/news/provider-registry.ts`.
0.6.10 used exactly that path to bring a local model back into every picker
(Story, Scan, Opinion, Dark Desk) — generic this time, not tied to one model
name the way "Local Qwen" was before it was removed 2026-09-02.

**Two ways to reach a local server, and they share one configuration:**

1. **Unnamed, the way it has worked since 0.6.2.** Point `LLM_BASE_URL` at the
   endpoint (plus `LLM_MODEL`, and `LLM_API_KEY` if it wants one). That is the
   `configured` registry entry. Automatic pins it for Story, Scan and Dark
   Desk whenever it is set. It does not appear in the picker by name, because
   it is "whatever the operator configured", not a model an editor chose.
2. **Named "Local model", in every picker.** The exact same `LLM_BASE_URL` /
   `LLM_MODEL` / `LLM_API_KEY` also power a picker entry called "Local model"
   — set them once and an editor can select it explicitly on Story, Scan,
   Opinion or Dark Desk, the same way they select Claude Opus or Codex. This
   is deliberate: a second, separate `LOCAL_BASE_URL` would split one local
   server's configuration across two variable names for no reason. Set
   `TOWNREPORTER_LOCAL=0` to take the named pick out of the pickers without
   touching the unnamed gateway path. Unlike the unnamed gateway above,
   `LLM_BASE_URL` itself is required for this named pick to be offered as
   ready — `LLM_API_KEY` and `LLM_MODEL` alone are not enough. An entry
   labelled "Local model" that had no local endpoint to point at used to
   silently fall back to `https://api.openai.com/v1`; it now refuses instead
   (0.6.13).

The entry itself, in `PROVIDER_REGISTRY`:

```ts
{
  id: "local-model",
  label: "Local model",
  detail: "llama.cpp, LM Studio, or another OpenAI-compatible server",
  kind: "local",                        // inherits KIND_BUDGETS.local: 600s a call
  model: "local-model",
  baseUrl: "http://127.0.0.1:1234/v1",
  envOverrides: { model: "LLM_MODEL", baseUrl: "LLM_BASE_URL", apiKey: "LLM_API_KEY" },
  budget: KIND_BUDGETS.local,
  // LLM_BASE_URL still wins outright when set. Otherwise (0.6.19) this is
  // also ready when `local-models.ts` has found LM Studio or Ollama
  // answering on their default ports -- see "Zero-config discovery" below.
  enabled: () =>
    notSwitchedOff("TOWNREPORTER_LOCAL") && (Boolean(env("LLM_BASE_URL")) || localDiscoveryReachable),
  offSwitchEnv: "TOWNREPORTER_LOCAL",
  offeredFor: { story: true, scan: true, opinion: true, dark: true },
  // no ladderRank: Automatic does not reach for it on its own -- when
  // LLM_BASE_URL is set, the `configured` entry above already pins Automatic
  // to the same server, so no ladder change was needed.
  // no plannerModel: it serves one model and has never heard of anyone else's
}
```

That one object is enough for: the Story, Scan, Opinion and Dark Desk
pickers; the time budgets on the Server page, including the editable per-call
field; the help sentence under each picker; and the round history's "which
model dug this". Every one of those is derived from the registry, and
`provider-registry.test.ts` fails if a new entry is missing a field any of
them read.

Two things it deliberately does NOT get for free:

- **A new transport.** `kind: "local"` speaks the OpenAI-compatible protocol,
  and `explicitProvider` in `ai.ts` already routed `local` down the same path
  as `openai` before this entry existed — the resolver builds the request
  from the same `customGateway()` the `configured` entry uses, so nothing in
  `ai.ts` needed to change. A model server that is not OpenAI-compatible needs
  a new `kind` and a new adapter.
- **A planner model.** `plannerModel` is left unset. Substituting a cheaper
  model only makes sense inside one provider's own family — asking a local
  endpoint for `claude-haiku-4-5` is audit finding TW-001, and the failure is
  silent: the planner falls back to keyword matching without a word.

**Opinion offers it too.** Opinion shares the provider registry with the other
desks: Automatic retains its documented Codex-to-Claude path, while every named
Codex and Claude model, Local model and custom choice is the requested first
runtime. A recognized technical failure can move only the unfinished call and
records requested and actual model and effort. A provider refusal or invalid
editorial remains terminal and leaves the request failed.

**On time budgets.** `KIND_BUDGETS.local` allows ten minutes for one call
against the CLIs' two and a half, because that is the measured shape of a 30B
reading a 20,000-character pack on this machine. The owner can still change
the per-call number for any provider on the Server page (Writing models →
Time per call), between 10 seconds and 60 minutes, stored per paper. Neither
of those makes the model faster; they change how long the desk waits before
calling it a failure.

**The quality question is still the one above.** None of this changes the
measurement at the top of this page: on the Dark planner prompt, the local 35B
found about half of what Haiku found. The wiring being easy is not an argument
for using it.

---

## Zero-config discovery, and picking the model

TownReporter probes LM Studio, Ollama and llama.cpp on their default ports
on the app server. A responsive compatible server can appear without config. Pick
the model in any Writing model picker — Command Center, a Queue row, the
Story page, Dark Desk, Opinion, or the Server page's Writing models section.
Nothing needs to be typed in for this to work.

The config lines below are optional overrides, not requirements:

```
# Point at a specific server/model instead of discovering one. Also makes
# "Local model" ready even if LM Studio/Ollama/llama.cpp are not on their default ports.
LLM_BASE_URL=http://127.0.0.1:11434/v1     # Ollama's default
# LLM_BASE_URL=http://127.0.0.1:1234/v1    # LM Studio's default
LLM_MODEL=gemma4:12b
# LLM_API_KEY=...                          # only if the server wants one

# Force thinking off/on for a model, instead of the automatic guess:
# LLM_REASONING_EFFORT=none                # none | low | medium | high

# Turn off probing the three default ports entirely (LLM_BASE_URL, if set,
# is still tried):
# TOWNREPORTER_LOCAL_DISCOVERY=0
```

**How discovery works.** `src/lib/news/local-models.ts` asks
`http://127.0.0.1:1234/v1/models` (LM Studio),
`http://127.0.0.1:11434/v1/models` (Ollama), and
`http://127.0.0.1:8080/v1/models` (llama.cpp) for their model lists, with a
1.5-second timeout each, and drops anything that does not answer with the
expected `{"data":[{"id":...}]}` shape — a server that is not there, slow, or
serving something unrelated (an unrelated web app on the same machine that
happens to answer with an HTML page, say) is treated as absent, not as an
error. LM Studio's own `/api/v0/models` and Ollama's `/api/ps` are then
consulted to say which models are actually **loaded** right now. TownReporter
also asks Ollama for each model's capabilities and context window. Models whose
IDs end in `:cloud` run in Ollama Cloud; the Ollama service on this computer is
their authenticated router, not the inference host. The picker labels these
models **Ollama Cloud** and shows a reported context of at least one million
tokens as **1M context**. Thinking, vision and load metadata produce the other
option suffixes. The result is
cached 20 seconds and refreshed in the background every 60 seconds, so
picker loads do not re-probe on every render; the picker's own Refresh
button forces an immediate re-check.

llama.cpp does not report load state through this endpoint. Its vision label
is inferred from the model name, not a successful image-read test. Also,
TownReporter and llama.cpp both default to port 8080: if both run on the same
server, move one to a free port and set `LLM_BASE_URL` for a moved model server.

**The default.** With nothing configured, "Local model" defaults to the
first model already **loaded** on LM Studio, then Ollama, then whatever
`LLM_MODEL` names if it is on a discovered list, then the first model found
at all. A model that is not loaded still works — the server loads it on the
first call, which the picker's help text says can take a minute or more.

**Thinking off, automatically.** A reasoning model (Gemma 4, the Qwen3
family, DeepSeek-R1, DeepSeek V4, gpt-oss, …) answers with the actual draft in a separate
`reasoning`/`reasoning_content` field and can spend its whole token budget
there, returning an empty draft with no error. TownReporter now sends
`reasoning_effort: "none"` to any model it recognises as this kind, unless
`LLM_REASONING_EFFORT` says otherwise — never to the real OpenAI cloud API,
which rejects the field outright on a non-reasoning model. If a model still
returns an empty draft with reasoning text (an unrecognised id, or an
explicit override), the desk says exactly that instead of "Empty model
response".

**Per-newsroom pick.** Choosing a model in the picker saves that choice for
this newsroom — every draft, scan, and dig uses it until changed. If that
model later disappears from the server's list, the desk falls back to the
current default and the picker says so in one line, rather than failing.

**Every AI call site has the picker.** This is a standing rule, not new to
local models: Command Center's composer, every Queue row, the Story page,
Dark Desk, Opinion, and the Server page all read the one provider registry
(`src/lib/news/provider-registry.ts`) and the one local-model catalog. There
is no per-page provider logic to keep in sync.

---

## Scanned PDFs, and why they need a *vision* model

A council packet with no text layer — a fax-quality scan of a paper agenda —
cannot be read by extracting text that was never stored in the file. This
desk renders the PDF pages in numeric order and asks a vision-capable provider
to transcribe pages without usable text (`src/lib/news/ocr.ts`). Codex and
Claude provide vision paths when their prerequisites are met. Grok (SuperGrok)
is text-only for this path. OCR starts with the model selected for the run and,
after a recognized technical failure, can try the next ready vision-capable
cloud runtime. Claude is last in the unattended order and uses Sonnet or Haiku,
never an automatic Opus default. This
does not guarantee that a particular scan will be readable. A **local** model can only do it if it
was built to accept images at all — an ordinary text-only local model
cannot, no matter how good it is at writing.

The picker marks which local models can: an entry with **`· vision`** after
its name is identified as image-capable; the label is not a completed OCR test. LM Studio reports this
itself; for Ollama, TownReporter asks each model directly (`ollama pull` a
vision model such as `qwen2.5vl` or `llama3.2-vision` to get one). The Server
page's local-model table also has a **Vision** column, for the same answer
without opening the picker.

Pick "Local model" for a scan without a vision-marked model selected, and the
desk says so honestly rather than guessing at the page's contents: *"the
chosen local model cannot read images — pick a vision model (marked ·
vision in the picker)."* The current retained-PDF reader renders actual PDF
pages, including scan encodings that are not exposed as embedded JPEG or PNG
streams. A page that still cannot be rendered or transcribed is reported as
unread rather than returned as empty text.

One OCR provider call contains at most 12 rendered pages, at most 2 MiB each.
That is a per-call safety boundary, not a packet limit. In Dark Desk, **Read
entire PDF** checkpoints each batch and resumes only missing pages after an
interruption or whole-click budget pause. Current rendered-page references use
numeric PDF page labels. Legacy records created by the older embedded-image
extractor can remain unordered and use image indices (`image:N`); historical
labels are not automatically rewritten, so re-ingest or operator review is
needed before relying on them as page citations. Native text PDF references are
unchanged.

## 0.6.51 scope

0.6.51 keeps 12 pages as the generic capture/Dark Desk OCR
boundary for one provider call, then adds **Read entire PDF** to checkpoint and
resume consecutive batches until every page is saved or explicitly unread.
Page-only vision is used when usable text is absent. Direct Story and Opinion
document intake independently retains and sections all readable PDF pages
subject to a 20-million-character document-text limit. An upload alone is not
evidence that OCR succeeded; the saved/total and unread-page result is.

No local model was loaded or invoked to document this release. See [the release guide](releases/0.6.51.md) for model-selection and evidence boundaries.
