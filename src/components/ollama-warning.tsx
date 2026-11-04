/*
  The loud Ollama warning (DEF-2, Scott's design Nov 4 2026).

  A full-width box on Today and on Models, in normal desk text (16px), that
  says why the desk might spend money: DeepSeek and the local model both run
  through Ollama, and when it is not there the ladder uses paid models.

  It is a WARNING, not a blocker. Nothing here stops a scan or a draft, and
  there is no Install button: TownReporter never downloads or installs Ollama
  (Scott's decision). "Check again" re-probes, and if Ollama is installed but
  stopped it starts the app's own copy on 11435 -- the same thing every job
  does before it runs.
*/

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { InkButton } from "@/components/desk-chrome";
import {
  checkOllamaAgain,
  getOllamaStatus,
  type OllamaStatus,
} from "@/lib/news/ollama";
import {
  OLLAMA_CHECK_AGAIN,
  OLLAMA_NOT_RUNNING_WORDS,
} from "@/lib/news/ollama-status";

const OLLAMA_STATUS_KEY = ["ollama-status"];

export function OllamaWarning() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: OLLAMA_STATUS_KEY, queryFn: () => getOllamaStatus() });
  const check = useMutation({
    mutationFn: () => checkOllamaAgain(),
    onSuccess: (data: OllamaStatus) => qc.setQueryData(OLLAMA_STATUS_KEY, data),
  });

  // Unknown (still reading the answer) and running both draw nothing. Only a
  // definite "nothing answered" warns.
  if (!status.data || status.data.running) return null;

  return (
    <section
      className="astra-panel hot mt-4 w-full"
      data-testid="ollama-warning"
      role="alert"
      aria-live="polite"
    >
      <p className="text-base">{OLLAMA_NOT_RUNNING_WORDS}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <InkButton disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? "Checking…" : OLLAMA_CHECK_AGAIN}
        </InkButton>
      </div>
    </section>
  );
}
