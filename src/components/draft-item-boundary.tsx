import { Component, type ReactNode } from "react";
import type { DeskDraftState } from "../lib/news/desk-drafts.ts";
import { StoryReadinessChip } from "./story-readiness-chip.tsx";

/** Empty/queued/failed placeholders have a desk state, but no readiness verdict. */
export function DraftStateChip({ state }: { state: DeskDraftState }) {
  return state.readiness && !state.running ? (
    <StoryReadinessChip readiness={state.readiness} />
  ) : (
    <span className="chip d-quiet" role="status">
      {state.label}
    </span>
  );
}

export function DraftItemUnavailable({ item, reason }: { item: string; reason: string }) {
  return (
    <p role="alert">
      {item}: This draft could not be shown: {reason}. <a href="/desk/queue">Open it from the Queue.</a>
    </p>
  );
}

function DraftItemContent({ render }: { render: () => ReactNode }) {
  return render();
}

/** Run row preparation AND descendant rendering inside the boundary. */
export class DraftItemBoundary extends Component<
  {
    item: string;
    children: () => ReactNode;
  },
  { reason: string | null }
> {
  state = { reason: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return {
      reason: error instanceof Error ? error.message.split("\n")[0] : "Unreadable draft data",
    };
  }

  render() {
    return this.state.reason ? (
      <DraftItemUnavailable item={this.props.item} reason={this.state.reason} />
    ) : (
      <DraftItemContent render={this.props.children} />
    );
  }
}
