One lead in Today’s list and the Queue: score, labels, title, why line, evidence, and Start story / Hold / Kill.

```jsx
<LeadRow lead={{ score: 16, title: 'Dry Creek annexation returns Oct. 6', why: 'Second reading is the binding vote.', meta: 'Planning · 2 hours ago', opened: 3, failed: 1, chips: [{ kind: 'new', label: 'NEW' }] }} selected onStart={start} onHold={openHoldDialog} onKill={openKillDialog} />
```

**Props and rules**
- `status`: `open` · `held` · `killed` (dims to 60% and shows Undo)
- `selected`: panel fill and yellow inset (keyboard J/K)
- `onHold` and `onKill` must open the reason dialog (optional reason plus a “no reason” button), never act silently
- Action clicks don’t trigger `onSelect`
