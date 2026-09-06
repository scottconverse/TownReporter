import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { InkButton } from "@/components/desk-chrome";
import { followUpDueLabel, followUpIsOverdue } from "@/lib/news/desk-copy";
import type { FollowUpRow } from "@/lib/news/types";

/**
 * One Follow-ups item, shared by the rail block (desk.index.tsx) and the
 * full list at /desk/follow-ups -- same anatomy either place, per
 * docs/design/DIRECTION-A-BUILD-NOTES-2026-09-06.md: who · what · due ·
 * the story it belongs to, then Record reply / Nudge / Drop.
 */
export function FollowUpItem({
  item,
  onReply,
  onNudge,
  onDrop,
  nudging = false,
  dropping = false,
  replying = false,
}: {
  item: FollowUpRow;
  onReply?: (replyText: string, repliedOn: string) => void;
  onNudge?: () => void;
  onDrop?: () => void;
  nudging?: boolean;
  dropping?: boolean;
  replying?: boolean;
}) {
  const [showReply, setShowReply] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [repliedOn, setRepliedOn] = useState(() => new Date().toISOString().slice(0, 10));

  const dueLabel = followUpDueLabel(item.due_on);
  const overdue = followUpIsOverdue(item.due_on);
  const storyTo = item.lead_id
    ? { to: "/desk/story/$leadId" as const, params: { leadId: String(item.lead_id) } }
    : item.article_slug
      ? { to: "/articles/$slug" as const, params: { slug: item.article_slug } }
      : null;
  const storyTitle = item.lead_headline ?? item.article_headline;

  return (
    <div className={"followup-item" + (item.status !== "open" ? " done" : "")}>
      <p className="followup-who">{item.who}</p>
      <p className="followup-what">{item.what}</p>
      <p className="meta">
        {dueLabel ? <span className={overdue ? "text-warn" : undefined}>{dueLabel}</span> : null}
        {dueLabel && storyTo ? " · " : null}
        {storyTo ? (
          <Link {...storyTo} className="inline-link">
            {storyTitle ?? "the story"}
          </Link>
        ) : null}
      </p>
      {item.status === "answered" ? (
        <p className="wire-sum">Answered{item.reply_text ? `: ${item.reply_text}` : ""}</p>
      ) : item.status === "dropped" ? (
        <p className="wire-sum">Dropped.</p>
      ) : (
        <>
          <div className="lead-actions">
            {onReply ? (
              <InkButton tone="quiet" small onClick={() => setShowReply((v) => !v)}>
                Record reply
              </InkButton>
            ) : null}
            {onNudge ? (
              <InkButton tone="quiet" small disabled={nudging} onClick={onNudge}>
                {item.nudged_at ? `Nudged ${new Date(item.nudged_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Nudge"}
              </InkButton>
            ) : null}
            {onDrop ? (
              confirmDrop ? (
                <>
                  <InkButton
                    tone="danger"
                    small
                    disabled={dropping}
                    onClick={() => {
                      setConfirmDrop(false);
                      onDrop();
                    }}
                  >
                    Yes, drop
                  </InkButton>
                  <InkButton tone="quiet" small onClick={() => setConfirmDrop(false)}>
                    Keep
                  </InkButton>
                </>
              ) : (
                <InkButton tone="quiet" small onClick={() => setConfirmDrop(true)}>
                  Drop
                </InkButton>
              )
            ) : null}
          </div>
          {showReply && onReply ? (
            <div className="note-add followup-reply-form">
              <input
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="What they said…"
                aria-label="What they said"
              />
              <input
                type="date"
                value={repliedOn}
                onChange={(e) => setRepliedOn(e.target.value)}
                aria-label="Date of reply"
              />
              <InkButton
                small
                tone="ghost"
                disabled={!replyText.trim() || replying}
                onClick={() => {
                  onReply(replyText.trim(), repliedOn);
                  setReplyText("");
                  setShowReply(false);
                }}
              >
                Save
              </InkButton>
              <InkButton small tone="quiet" onClick={() => setShowReply(false)}>
                Cancel
              </InkButton>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
