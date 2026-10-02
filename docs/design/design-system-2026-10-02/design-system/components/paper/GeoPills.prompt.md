The geography switch in the masthead. The order is fixed: Longmont · Nearby · Boulder County · Colorado.

```jsx
<GeoPills active="Longmont" hrefFor={(p) => '/?area=' + p} />
```

**Props and rules**
- `active`: the current place (ink fill)
- `places`: override only if the owner changes the geography
- `hrefFor(place)`: link builder; each pill is at least 44px
