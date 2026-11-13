# How attribution works, and what to do when it fails

`scripts/attribute.js` runs inside the page. For each violating DOM node it finds the component that **wrote** the markup (the owner), then walks up to its callers.

| Framework | What it reads | Available in | Gives file path? |
|---|---|---|---|
| React 16–19 | `__reactFiber$…` key on the DOM node, then `fiber._debugOwner` (who created the element) or `fiber.return` | Dev builds. Prod builds keep fibers but minify names | Only React ≤ 18 dev (`_debugSource`). React 19 removed it, so `cluster.mjs` resolves by name |
| Vue 3 | `el.__vueParentComponent` → `type.__name` / `type.name`, `type.__file` | Dev builds (`__file` comes from the SFC compiler) | Yes for `.vue` SFCs in dev |
| Vue 2 | `el.__vue__` → `$options.name`, `$options.__file` | Dev builds | Yes in dev |
| Angular 12+ | `window.ng.getOwningComponent(el)` and `ng.getComponent(host)` | Only in dev mode (`ng serve`). `enableProdMode()` removes `window.ng` | No, resolved by name (`FooComponent` → `foo.component.ts`) |
| Anything | Nearest `data-component` or `data-testid` attribute | Always | No |

## Symptoms and fixes

**Attribution rate below 70%, names like `t`, `n`, `e`**
The app is a production or minified build. Run the dev server instead. If only a deployed build is available, ask the user whether components carry `data-component` / `data-testid` attributes, otherwise the report is only usable per page.

**Everything attributed to a layout component (`App`, `Layout`, `RouterView`)**
React without `_debugOwner` falls back to the render tree. Check that `NODE_ENV` is `development`. In Vue, content passed through a slot can be attributed to the component that renders the slot: check the "Used by" column and the example markup before deciding the fix layer.

**`(unattributed)` nodes**
- Inside an `<iframe>`: scan the iframe URL directly.
- Inside a web component's shadow DOM: attribution stops at the shadow host. Fix inside the web component.
- Rendered by a portal (modals, toasts, tooltips): React portals keep the fiber link, so usually fine. Libraries that inject raw HTML (some toast libs, `v-html`, `[innerHTML]`) have no component: grep the project for the HTML snippet shown in the report.
- Markup added by a third-party script (chat widget, cookie banner): out of the project's code. Report it to the user separately.

**Two components share a name** (e.g. two `Card` in different folders)
`cluster.mjs` lists all candidate files. Open each and match the example markup from the report.

**Source file "not found"**
The component lives outside `--root` (monorepo package, design-system package in `node_modules`). Re-run with `--root` at the monorepo root, or treat it as third-party.

## Pages that need interaction

The scan sees the page after load. Dialogs, menus, error states and multi-step forms that only appear after a click are not scanned. For those, give the user a URL that opens the state directly (`?modal=open`, a Storybook story URL), or scan Storybook: each story URL (`/iframe.html?id=button--icon-only`) is a page, and stories render each component state in isolation, which also makes attribution very clean.
