---
name: a11y-root-cause
description: Find and fix accessibility (a11y / WCAG) problems in a React, Vue or Angular app at their source. Renders the running app with Playwright + axe-core, traces every violation back to the component that wrote it, ranks components by how many violations one fix removes ("fix these 3 components, 70% of issues disappear"), then fixes them and re-scans to prove it. Use when asked to audit, check, validate or fix accessibility, a11y, WCAG, RGAA or contrast in a frontend project, or when an axe/Lighthouse report has too many issues to fix one by one. Not for static HTML files with no running app, or for native mobile apps.
---

# a11y-root-cause

Accessibility debt in component-based apps is concentrated: one shared `IconButton` without an accessible name produces the same violation on every page. Fixing violations one by one treats symptoms. This skill fixes the **component that wrote the markup**, in the order that removes the most violations, and proves the result with a re-scan.

Division of labour: the scripts produce deterministic evidence (what fails, where, which component, how often). You make the judgment calls (which layer to fix, what the right accessible name is) and write the fixes.

## 0. Setup (once per machine)

```bash
cd <this skill>/scripts && npm install
```

The scan needs a Chrome/Chromium. If none is found: `npx playwright install chromium`, or pass `--browser-path`.

## 1. Prepare the target

1. **Run the app in development mode** (`npm run dev`, `ng serve`, `vite`, `next dev`...). Attribution relies on dev-only debug data; a production build gives "(unattributed)" everywhere. Check `package.json` scripts to find the right command, start it in the background, wait until it answers.
2. **List the pages to scan** in a `urls.txt` (one URL per line). Get routes from the router config (`app/` or `pages/` folders, `createBrowserRouter`, `vue-router` routes, Angular `Routes`). Cover each distinct layout and every page with forms, dialogs or tables. If the route list is unclear, ask the user for the 5–10 most important pages instead of guessing.
3. **Pages behind login**: ask the user to log in once, then save a Playwright storage state and pass `--storage-state state.json`. Never type the user's real credentials yourself.

## 2. Scan

```bash
node <skill>/scripts/scan.mjs --urls urls.txt --out a11y-scan.json
```

Options: `--tags` (default `wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa`), `--wait <ms>` for slow SPAs, `--viewport 375x812` for a mobile pass.

Read the console summary. A page with `ERROR` did not load: fix the URL or server, do not skip it silently.

## 3. Cluster by component

```bash
node <skill>/scripts/cluster.mjs --in a11y-scan.json --root <project root> --out-dir a11y-report
```

Read `a11y-report/report.md`. It gives the headline, the leverage table, and for each component: source file (or candidates), callers, rules violated, example markup. `clusters.json` has the same data for scripting.

If the attribution rate is below 70%, stop and read `references/attribution.md` before going further.

## 4. Decide the fix layer, component by component

Work down the leverage table. For each component, open its source and choose:

| Situation | Fix where |
|---|---|
| `scope: shared`, the markup itself is wrong (div used as button, missing `<label>`, bad contrast in the component's styles) | **In the component, once.** Every caller benefits. |
| `scope: shared`, the fix needs content only the caller knows (accessible name of an icon button, alt text) | **Change the component API**: make the prop required (TypeScript required prop / Vue `required: true` / Angular `input.required()`), add a dev-time warning, then update every caller listed under "Used by". |
| `scope: local` | Fix at that one place. |
| `third-party` (file in `node_modules`) | Never edit `node_modules`. Pass the right props, wrap it, or theme it. Mention the upstream issue to the user. |
| Contrast coming from a design token / theme variable | Fix the token, then check other components using it. |
| `(unattributed)` | See `references/attribution.md` (iframe, portal, shadow DOM, or prod build). |

Framework-specific fix patterns per axe rule: `references/fix-patterns.md`. Read the section for the rules in the report before editing.

## 5. Fix rules (non-negotiable)

- **Native first.** `<button>` over `<div role="button" tabindex="0">`. Add ARIA only when no native element does the job.
- **Never silence axe.** No `aria-hidden` on focusable content, no `role="presentation"` on meaningful images, no `alt=""` on informative images, no removing elements from the scan.
- **Do not invent human content.** If you cannot tell what an image shows or what an icon button does, use a clearly marked placeholder (`alt="TODO(a11y): describe"`) and list it for the user. A wrong label is worse than a flagged one.
- **Preserve visuals.** Swapping a `div` for a `button` needs a style reset; changing colors changes the design. Say so when you do it.
- **Keep diffs per component**, so the user can review the leverage fix by fix.

## 6. Verify

Re-scan the same URLs and compare:

```bash
node <skill>/scripts/scan.mjs --urls urls.txt --out a11y-scan-after.json
node <skill>/scripts/cluster.mjs --in a11y-scan-after.json --baseline a11y-scan.json --root <project root> --out-dir a11y-report
```

The report starts with a before/after table per component. Any `NEW` or `worse` row is a regression you introduced: fix it before reporting. Also run the project's own tests and type-check.

## 7. Report to the user

Keep it short:
- Before → after violating nodes, and the headline (top components and their share).
- What you changed, one line per component, with the API changes callers must know about.
- Placeholders that need a human (alt texts, labels).
- What automation cannot check: keyboard-only navigation, focus order and visibility, focus after route changes and in dialogs, screen-reader wording, zoom to 200% / reflow at 320px. Offer to walk through these manually.

Automated tools catch roughly a third to a half of WCAG issues. Never present a clean scan as "the app is accessible" or "WCAG/RGAA compliant".
