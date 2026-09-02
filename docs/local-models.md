# Local models: what was measured, and why the answer is mostly no

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
| Scan and Dark Desk | the configured provider (`LLM_*`, Anthropic, Claude Code, or Grok)                                                                |
| Story — Automatic  | configured `LLM_*` gateway when present; otherwise first ready Claude Opus → Codex Terra → Zen MiMo rung                          |
| Story — explicit   | Local Qwen, Zen MiMo, Codex Terra, Codex Sol, or Claude Opus; no fallback                                                         |
| Opinion            | Claude Opus only; Codex is not offered because its model declines to write an editorial that takes a position                    |

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
   Story product and it did not complete. Local remains available by explicit
   choice, but that readiness check proves only that the model is loaded.

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
