/**
 * The plain words the desk owns about its Models screen.
 *
 * FB08 and FB22 (Oct 11 walk, `TownReporter-WALK-TEST-FULL-1-B-2026-10-11.md`)
 * both landed on the same problem: the screen a new owner meets to set up
 * writing is full of desk words with no explanation. Every line here is an
 * ADDITION -- the old buttons, fields and result text all stay. The lines are
 * held in one place rather than typed into the route so a test can pin the
 * plain words themselves.
 */

import { modelEffortLabel } from "./provider-registry.ts";
import type { ModelEffort } from "./provider-registry.ts";

/** FB08: what "Test all connections" actually does, said next to the button. */
export const TEST_ALL_CONNECTIONS_LINE =
  "Checks sign-ins and looks for servers on this computer. It does not ask any model a question. To ask one model a short question, press Test on its card.";

export type TestAllScope = "cloud" | "local" | "signin";

/**
 * FB08: why a card has no Test of its own, and what to do instead.
 *
 * `cloud`  -- a sign-in that is not installed and cannot answer Test.
 * `local`  -- LM Studio and Ollama, which TownReporter only reads.
 * `signin` -- an installed sign-in not yet signed in, so Test is not offered.
 */
export const TEST_ALL_CARD_NOTES: Readonly<Record<TestAllScope, string>> = {
  cloud:
    "No Test here: this model's program is not installed on this computer, so there is nothing to ask. Install it and sign in above, then Test returns.",
  local:
    "No Test here: TownReporter reads what this server reports and never sends it a question or loads a model. Use this server's own window or check it above.",
  signin:
    "No Test here yet: sign in above first. After signing in, Test asks this model one short question.",
};

export function testAllCardNote(scope: TestAllScope): string {
  return TEST_ALL_CARD_NOTES[scope];
}

/**
 * FB22: a plain line under each setup field, so the owner knows what to type.
 * The example in the row is the Model ID line.
 */
export const SETUP_FIELD_HELP = {
  connectionName: "A name for you to recognize it by, such as Gemini or My server.",
  baseUrl: "The web address of the AI service. It stays the same as what that service gave you.",
  apiKey:
    "The private key from that AI service. It is saved on this server and never shown again.",
  modelId: "Model ID: the exact model name your provider uses.",
  context:
    "Context: how much text the model can read at once. Bigger holds more and can cost more.",
  transport:
    "Transport: the connection this model is reached through, such as an API key, a sign-in, or a server on this computer.",
  oauth: "OAuth: a sign-in you already have with the provider, reused instead of a key.",
  openaiCompatible:
    "OpenAI-compatible endpoint: a web address another program offers that speaks the same language as OpenAI.",
  litellm: "LiteLLM: an optional middle program that passes requests on to other AI services.",
} as const;

export type SetupFieldKey = keyof typeof SETUP_FIELD_HELP;

export function setupFieldHelp(key: SetupFieldKey): string {
  return SETUP_FIELD_HELP[key];
}

/**
 * FB22: the word the pickers already show for a raw effort token, so the owner
 * never meets "xhigh" on its own. `model` lets the shared label give its exact
 * wording (for example "Off — no extra thinking").
 */
export function effortChoiceLabel(effort: ModelEffort, model?: string | null): string {
  return `${modelEffortLabel(effort, model)} (${effort})`;
}

/**
 * FB22: one plain line for the effort choices themselves.
 */
export const EFFORT_FIELD_HELP =
  "Effort: how hard the model thinks for one run. Higher can take longer. The word in brackets is the setting's internal name.";
