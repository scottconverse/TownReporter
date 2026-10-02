/*
  CITY-SETUP final slice: the first-run setup gate.

  Reached two ways:
    1. Automatically, once, right after the owner claims a fresh desk --
       src/routes/desk.index.tsx redirects here whenever firstRunSetupState()
       says needsSetup, so a brand-new city never has to edit a file to stop
       being Longmont.
    2. Directly, any time later, as a normal route -- the Server page's "Paper
       setup" section links here, so a mistake made during setup is fixable
       without touching a file.

  ── PUB2 item 3: THIS ROUTE IS FIRST-RUN ONLY ────────────────────────────────

  `firstRun` used to be passed unconditionally, so an owner whose paper was
  already set up and who navigated here directly got an EMPTY form, and Save
  would have overwritten the paper's identity with whatever was typed into it.
  The flag now comes from the same server answer the Server panel reads
  (`firstRunSetupState`, query key `["first-run-setup"]`), and an already
  onboarded owner is redirected to /desk -- the first-run gate in desk.index
  redirects the other way, so the two answers cannot fight. Editing an
  onboarded paper still happens exactly as before, through the Server page's
  own "Paper setup" section, which pre-fills the saved values.

  THE DECISION KEYS OFF THE `onboarded` FLAG AND NOTHING ELSE. The live
  production paper is `onboarded = true` with EMPTY name, city and state
  (paper-live-shape.test.ts), so "is the city filled in" is not a question that
  can be asked here: it would read that paper as needing setup and send its
  owner to a blank form. `firstRunSetupState` answers `!isOnboarded`, and the
  same fail-closed rule the Server panel uses applies -- "I could not ask
  whether this paper is set up" is not "it is set up".
*/
import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DeskShell } from "@/components/desk-chrome";
import { ScreenPending } from "@/components/states";
import { PaperSetupForm } from "@/components/paper-setup-form";
import { myDesk } from "@/lib/news/claim";
import { firstRunSetupState, getPaperConfigForEditor } from "@/lib/news/paper-settings";

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
  const setupState = useQuery({
    queryKey: ["first-run-setup"],
    queryFn: () => firstRunSetupState(),
    /*
      A cached answer is not an answer. "needsSetup: true" left in the cache from
      earlier (another tab finished setup, or the entry went stale) is returned
      with `isPending === false` while a background refetch runs, and drawing the
      blank first-run form from it for an already-onboarded paper lets Save
      overwrite the paper's identity. So the query refetches on every mount and
      the screen treats the answer as unresolved until THIS mount has fetched it
      (`isFetchedAfterMount`).
    */
    refetchOnMount: "always",
  });

  /*
    Only an owner is redirected: an editor (not owner) always gets
    `needsSetup: false`, and bouncing them to /desk would replace the
    "Only the owner can set up the paper's identity." sentence with a silent
    departure.
  */
  const alreadySetUp = me.data?.role === "owner" && setupState.data?.needsSetup === false;
  useEffect(() => {
    if (alreadySetUp) void navigate({ to: "/desk" });
  }, [alreadySetUp, navigate]);

  if (me.isPending || current.isPending || setupState.isPending || !setupState.isFetchedAfterMount) {
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

  if (alreadySetUp) {
    // The redirect above is in flight. Draw the loading state, never a blank
    // form for a frame -- the blank form is the bug this route is fixing.
    return <ScreenPending title="Set up the paper" kicker="Editor desk" hint="Opening the desk…" />;
  }

  if (setupState.isError || setupState.data === undefined) {
    /*
      Fail closed, the same rule as the Server panel: drawing the form with
      `firstRun={false}` would fill it from the shipped Longmont constants and
      the build-time editor address -- the disclosure F4 exists to stop --
      and Save would store them.
    */
    return (
      <DeskShell title="Set up the paper" kicker="Editor desk">
        <p
          role="alert"
          className="mt-6 max-w-xl border border-danger/35 bg-paper-2 px-3 py-2.5 text-sm text-danger"
        >
          The desk could not check whether this paper has been set up yet, so the setup form is not
          shown. Reload the page to try again.
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
          state, timezone, tagline, starting watch list and meeting-title
          keywords. It also rewrites the welcome article so it introduces this
          city instead of the sample text. Meeting-capture channels are
          configured separately on the Server page under "Meeting capture".
          You can change any of this later from the Server page.
        </>
      }
    >
      <PaperSetupForm
        initial={current.data}
        firstRun={setupState.data.needsSetup === true}
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
