export function darkRunOutcome(stopReason: string | null | undefined): "failed" | "completed" {
  return stopReason === "synthesis-failed" ? "failed" : "completed";
}
