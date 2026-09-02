/*
  CITY-SETUP final slice: the first-run setup gate.

  Reached two ways:
    1. Automatically, once, right after the owner claims a fresh desk --
       src/routes/desk.index.tsx redirects here whenever firstRunSetupState()
       says needsSetup, so a brand-new city never has to edit a file to stop
       being Longmont.
    2. Directly, any time later, as a normal route -- also linked from the
       Server page's "Paper setup" section, so a mistake made during setup
       is fixable without touching a file.
*/
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DeskShell } from "@/components/desk-chrome";
import { ScreenPending } from "@/components/states";
import { PaperSetupForm } from "@/components/paper-setup-form";
import { myDesk } from "@/lib/news/claim";
import { getPaperConfigForEditor } from "@/lib/news/paper-settings";

export const Route = createFileRoute("/desk/setup")({
  head: () => ({ meta: [{ title: "Set up the paper — TownReporter" }] }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["my-desk"], queryFn: () => myDesk() });
  const current = useQuery({
    queryKey: ["paper-config-for-setup"],
    queryFn: () => getPaperConfigForEditor(),
  });

  if (me.isPending || current.isPending) {
    return <ScreenPending title="Set up the paper" kicker="Editor desk" hint="Loading…" />;
  }

  if (me.data?.role !== "owner") {
    return (
      <DeskShell title="Set up the paper" kicker="Editor desk">
        <p className="mt-6 max-w-xl text-ink-2">
          Only the owner can set up the paper's identity.
        </p>
      </DeskShell>
    );
  }

  return (
    <DeskShell
      title="Set up the paper"
      kicker="Editor desk"
      lede={
        <>
          Tell the desk what paper this is. This writes the paper's name, city,
          state, timezone, tagline, starting watch list, meeting-video channels
          and meeting-title keywords. It also rewrites the welcome article so
          it introduces this city instead of the sample text. You can change
          any of this later from the Server page.
        </>
      }
    >
      <PaperSetupForm
        initial={current.data}
        firstRun
        submitLabel="Save and open the desk"
        onDone={async () => {
          /*
            Settle the cache BEFORE leaving. The old version fired the
            invalidation and navigated in the same tick, so desk.index could
            read the stale `needsSetup: true` and bounce the owner straight
            back to a blank setup form (found by the recovery QA).
          */
          qc.setQueryData(["first-run-setup"], { needsSetup: false });
          await qc.invalidateQueries({ queryKey: ["first-run-setup"] });
          await navigate({ to: "/desk" });
        }}
      />
    </DeskShell>
  );
}
