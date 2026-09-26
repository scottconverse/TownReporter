/**
 * Live progress for any long AI job. Needs @keyframes trPulse and trSlide (see guidelines/motion.css). Stalled after stallSeconds of no activity.
 * @startingPoint section="Desk" subtitle="Running · stalled · done · failed" viewport="700x200"
 */
export interface Job {
  title: string; model: string; state: 'running' | 'done' | 'failed';
  stages?: string[]; stage?: number; pct?: number | null; now?: string;
  startedAt: number; beatAt?: number; endedAt?: number;
  result?: string; error?: string; openLabel?: string;
}
export interface JobCardProps {
  job: Job; compact?: boolean; stallSeconds?: number; now?: number;
  onCancel?: () => void; onOpen?: () => void; onRetry?: () => void; onRetryNext?: () => void; onKeepWaiting?: () => void;
}
export function JobCard(props: JobCardProps): JSX.Element;
