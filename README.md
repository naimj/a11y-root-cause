# a11y-root-cause

An agent skill that fixes accessibility problems **at the component that causes them**, for React, Vue and Angular apps.

Most a11y tools give you a flat list: 140 violations, page by page. In a component-based app, most of those come from a handful of shared components. This skill:

1. **Scans the running app** in a real browser (Playwright + axe-core, WCAG 2.2 A/AA).
2. **Attributes each violation to the component that wrote the markup**: React fibers, Vue instances, Angular's `ng` debug API.
3. **Ranks components by leverage**: "fix `IconButton`, `Avatar` and `UserAvatar` → 70% of violations gone".
4. **Fixes at the right layer**: in the shared component, by tightening its API (required `label` / `alt`), or locally.
5. **Re-scans and diffs** against the baseline, per component, so regressions show up.

## Install

```bash
npx skills add <owner>/a11y-root-cause
cd <skills dir>/a11y-root-cause/scripts && npm install
```

Needs Node 18+ and a Chrome/Chromium (`npx playwright install chromium` if none).

## Use

Ask your agent: *"Audit the accessibility of this app and fix the biggest problems."*

Or run the scripts yourself against your dev server:

```bash
node scripts/scan.mjs --url http://localhost:5173/ --url http://localhost:5173/checkout --out a11y-scan.json
node scripts/cluster.mjs --in a11y-scan.json --root . --out-dir a11y-report
# after fixing
node scripts/scan.mjs --url ... --out after.json
node scripts/cluster.mjs --in after.json --baseline a11y-scan.json --root .
```

## Example output

```
Fixing the top 3 component(s) removes 69.7% of violating nodes.

| # | Component   | Scope  | Nodes | Cumulative |
|---|-------------|--------|------:|-----------:|
| 1 | IconButton  | shared |    13 |      39.4% |
| 2 | Avatar      | shared |     5 |      54.5% |
| 3 | UserAvatar  | shared |     5 |      69.7% |
```

## Limits

- Run against a **development build**: production builds strip the component names attribution relies on.
- Automated checks find roughly a third to a half of WCAG issues. Keyboard flow, focus management and screen-reader wording still need a human.
- A clean scan is not a compliance certificate (WCAG, RGAA, EAA).

## License

MIT
