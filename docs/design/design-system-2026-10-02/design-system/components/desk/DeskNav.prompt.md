The desk’s left navigation, with counts and the live Running box that summarizes every job in progress.

```jsx
<DeskNav active="Today" items={[{ label: 'Today' }, { label: 'Queue', count: 9 }]} running={[{ title: 'Drafting story', line: '2:18 · Draft' }]} onNavigate={go} />
```

**Props and rules**
- Item order: Today, Queue, Drafts, Published, Opinion, Follow-ups, Dark Desk, Sources & scan, Models, Server, Stats
- `running`: shown only when non-empty; clicking it goes to Today
- `themeLabel`, `onToggleTheme`
