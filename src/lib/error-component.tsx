import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { ScreenPending } from "@/components/states";
import { inkGhost, inkSolid } from "@/components/desk-chrome";

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-6 text-ink">
      <div className="stagger-in max-w-md text-center">
        <p className="text-[11px] tracking-[0.16em] text-rust uppercase">
          TownReporter
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">
          Something went wrong
        </h1>
        <p className="mt-3 max-w-md text-pretty break-words text-ink-2">
          {error.message || "An unexpected error occurred. Try reloading the page."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/" className={inkSolid}>
            Back to the paper
          </Link>
        </div>
      </div>
    </main>
  );
}

export function AppNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-paper px-6 text-ink">
      <div className="stagger-in max-w-md text-center">
        <p className="text-[11px] tracking-[0.16em] text-rust uppercase">
          TownReporter
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold">No page here</h1>
        <p className="mt-3 text-ink-2">
          That address is not in this edition. The paper is on the front page.
          The desk is behind sign-in.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/" className={inkSolid}>
            Open the paper
          </Link>
          <Link to="/desk" className={inkGhost}>
            Editor desk
          </Link>
        </div>
      </div>
    </main>
  );
}

export function AppPending() {
  return (
    <ScreenPending title="Opening the edition" hint="Setting type…" />
  );
}
