“This week” on the front page and “Dates in this story” on the article page: a block panel of dated events.

```jsx
<DatesPanel items={[{ dow: 'Tue', day: '6', what: 'Council public hearing: Dry Creek annexation', note: '6 p.m.' }]} footLink={{ label: 'Full calendar →', href: '/calendar' }} />
```

**Props and rules**
- `title`: defaults to “This week”
- `items`: `{ dow, day, what, note? }[]`, with dates from the record
- `footLink`: optional
