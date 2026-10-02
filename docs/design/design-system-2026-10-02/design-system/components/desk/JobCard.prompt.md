Live progress for any long AI job: stage, current step, elapsed time and last activity. It flags a stall after 60s of silence.

```jsx
<JobCard job={{ title: 'Drafting story', model: 'Codex Sol · high', state: 'running', stages: ['Read', 'Draft', 'Headline', 'Save'], stage: 1, pct: 42, now: 'Writing paragraph 4', startedAt, beatAt }} onCancel={cancel} />
```

**Props and rules**
- `job.state`: `running` · `done` · `failed`; stalled is derived from `beatAt`
- `pct: null` gives an indeterminate bar
- `compact` hides the stage list
- Callbacks: `onCancel`, `onOpen`, `onRetry`, `onRetryNext`, `onKeepWaiting`
- Needs `tokens/motion.css` for the keyframes; honours reduced motion
