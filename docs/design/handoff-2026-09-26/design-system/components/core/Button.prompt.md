The one button family for every action on the paper and desk. Primary (yellow) is the single next step.

```jsx
<Button variant="primary" keyHint="S">Start story</Button>
<Button>Hold</Button>
<Button variant="danger">Kill</Button>
<Button variant="gated" disabled>Publish in Housing</Button>
```

**Props and rules**
- `variant`: `primary` · `secondary` (default) · `quiet` · `danger` · `gated`
- `size`: `md` (44px) · `lg` (48px, header actions)
- `keyHint`: a shortcut shown inside the button
- `disabled`: a disabled primary renders as `gated`; show the reason next to it
- All native button props pass through (`onClick`, `type`, `aria-*`, `style`)
