A lead’s newsworthiness score, shown at the left of every lead row.

```jsx
<ScoreBadge score={16} />
<ScoreBadge score={9} label={false} />
```

**Props and rules**
- `score`: 14 or higher is a yellow fill, 10–13 a 2px ink border, below 10 a 1px rule
- `label`: show the word “score” under it (default true)
