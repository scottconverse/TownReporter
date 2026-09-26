The modal shell for every desk sub-view (New story, Add a lead, Hold, Kill, Headline, Compare, Legal removal…). ChoiceCard is its single-choice option.

```jsx
<Dialog open title="Kill this lead" subtitle="Kept 30 days in Recently deleted." primaryLabel="Kill with this reason" altLabel="Kill, no reason" footNote="Cancel keeps the lead." onClose={close} onPrimary={kill} onAlt={killNoReason}>
  <ChoiceCard label="Not news" note="Routine notice" selected onSelect={pick} />
</Dialog>
```

**Props and rules**
- The footer is always: note, then Cancel, an optional alternate action, then the primary action
- Escape and backdrop click call `onClose`
- In production, build on Radix Dialog (focus trap, scroll lock, focus return) with this styling
