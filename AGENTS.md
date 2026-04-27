# Agent notes

## Refreshing `dist/` after changing `src/`

`dist/index.js` is a bundle produced by `@vercel/ncc` and is committed because GitHub resolves a JS action's `main:` from the tag's tree. It must be regenerated and re-committed whenever `src/` changes.

Always rebuild with:

```sh
npm run build:dist
```

That script runs `npm ci` before `ncc`, which reinstalls `node_modules` strictly from `package-lock.json` so the bundle matches the dependency tree CI's `check-dist` workflow uses.

Building from a stale or `npm install`-mutated tree produces a `dist/index.js` whose internal ncc module IDs drift from the CI build, and `check-dist` will fail on the resulting PR even though the source diff is correct.
