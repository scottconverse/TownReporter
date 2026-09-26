A front-page story cell. StoryGrid draws the ruled 1px gaps between cells.

```jsx
<StoryGrid columns={3}>
  <StoryCell section="Planning" title="Council advances Dry Creek annexation" date="Sep 25" read="3 min" href="/articles/…" />
</StoryGrid>
```

**Props and rules**
- `StoryGrid columns`: 3 on desktop, 1 on phone
- There’s no dek in grid cells; the kicker is the section
