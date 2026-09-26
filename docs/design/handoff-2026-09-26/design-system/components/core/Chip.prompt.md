A state label. The state is always in words; color only reinforces it.

```jsx
<Chip kind="ok">✓ No change</Chip>
<Chip kind="fail">Could not check</Chip>
<Chip kind="warn">! Needs review</Chip>
<Chip kind="absent">Checked · not found</Chip>
```

**Props and rules**
- `kind`: `new` · `changed` · `ok` · `absent` · `fail` · `warn` · `printed` · `neutral`
- Never use `ok` and `fail` interchangeably: “no change” and “could not check” must look different.
