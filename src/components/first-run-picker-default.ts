/*
  Unit F3b: the one place a desk page adopts the first-run writing-model
  default, so five pages cannot each get it slightly wrong.

  F3 (src/lib/news/first-run-model.ts) stores Local model > "Use whatever is
  loaded" when a fresh install finishes setup with a model in memory, but the
  pages opened their picker on "auto" and SENT it as an explicit pick --
  which outranks the stored assignment -- so a hand-pressed Run still walked
  the Automatic ladder. This hook is the other half: it reads the server's
  answer (`getFirstRunPickerDefault`) and puts it in the page's picker state.

  THREE RULES, and each one is a page's bug if it is not here:

    - ONCE. `seed` moves from null to a value exactly once per page load, and
      the effect latches on the adoption, so nothing re-seeds a page later.
    - THE OWNER WINS. `touched()` is the page's own "the editor has used this
      picker" flag; if it is true the seed is dropped on the floor. Switching
      to Automatic and back works exactly as it did before this existed.
    - NOTHING NEW IS NOTHING TO DO. A seed of `auto` (every paper that is not
      a fresh F3 install -- including the live one) seeds nothing at all, so
      those pages are byte-for-byte what they were.

  The rule itself lives in `pickerSeedToApply` (src/lib/news/first-run-model.ts)
  and is unit-tested there; this file is only the React plumbing around it.
*/

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFirstRunPickerDefault } from "@/lib/news/first-run-model-settings";
import { firstRunPickerKey } from "@/lib/news/provider-availability-key";
import { pickerSeedToApply } from "@/lib/news/first-run-model";
import type { StoryModelChoice } from "@/lib/news/model-choice";
import type { ProviderSurface } from "@/lib/news/provider-registry";

/**
 * The choice this page's picker should open on, or null while the answer is
 * still on its way (and for every page that has no first-run default).
 *
 * `staleTime: Infinity`: the answer is fixed for the life of the page. The
 * marker only changes when setup finishes, which is not something that happens
 * while a desk page is open, and a refetch that flipped a picker under an
 * editor's hands would be worse than a stale one.
 */
export function useFirstRunPickerDefault(surface: ProviderSurface): StoryModelChoice | null {
  const query = useQuery({
    queryKey: firstRunPickerKey(surface),
    queryFn: () => getFirstRunPickerDefault({ data: { surface } }),
    staleTime: Infinity,
  });
  return query.data?.choice ?? null;
}

/**
 * Put the first-run default into this page's picker state, once, unless the
 * editor has already touched it.
 *
 * `touched` is read inside the effect rather than captured, so a ref the page
 * flips in an event handler is seen even though the effect ran after the
 * first render; `apply` is read the same way, so a page can pass an inline
 * arrow without the effect re-running on every render.
 */
export function useFirstRunPickerSeed(args: {
  surface: ProviderSurface;
  /** The page's picker state at the moment the answer arrives. */
  current: StoryModelChoice;
  /** Hand the adopted choice to the page's state (and its effort). */
  apply: (choice: StoryModelChoice) => void;
  /** True once the owner has used THIS page's picker. */
  touched: () => boolean;
}): void {
  const seed = useFirstRunPickerDefault(args.surface);
  const done = useRef(false);
  const latest = useRef(args);
  latest.current = args;

  useEffect(() => {
    if (done.current || seed === null) return;
    const { current, apply, touched } = latest.current;
    const next = pickerSeedToApply({ seed, touched: touched(), current });
    if (!next) return;
    done.current = true;
    apply(next);
  }, [seed]);
}
