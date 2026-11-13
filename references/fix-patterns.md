# Fix patterns by axe rule and framework

Read only the sections for the rules in your report. Each pattern shows the **component-level** fix: the goal is to make the wrong usage impossible, not to patch one call site.

## Framework pitfalls that cause many violations

- **Angular**: ARIA is an attribute, not a property. `[aria-label]="x"` throws or does nothing; use `[attr.aria-label]="x"`. Same for `[attr.aria-expanded]`, `[attr.aria-describedby]`.
- **Vue 3**: attributes passed to a component land on its root element (`inheritAttrs`). If the root is a wrapper `<div>` but the real control is an inner `<button>`, `aria-label` ends up on the div. Set `inheritAttrs: false` and bind `v-bind="$attrs"` on the control.
- **React**: a wrapper that does not spread `...rest` onto the native element swallows `aria-*`, `id`, `htmlFor`. Spread rest props and `forwardRef` (or the `ref` prop in React 19) to the native element.
- **All**: IDs used for `for` / `aria-labelledby` must be unique per instance. Use `useId()` (React 18+), `useId()` (Vue 3.5+) or a counter, never a hard-coded id inside a reusable component.

## button-name / link-name (icon-only controls)

Make the accessible name required at the API level.

React (TypeScript):
```tsx
type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: React.ReactNode };
export function IconButton({ label, icon, ...rest }: IconButtonProps) {
  return <button type="button" aria-label={label} {...rest}>{icon}</button>;
}
// The icon's <svg> gets aria-hidden="true" focusable="false"
```

Vue 3:
```vue
<script setup lang="ts">
defineProps<{ label: string }>();   // required by type
defineOptions({ inheritAttrs: false });
</script>
<template>
  <button type="button" :aria-label="label" v-bind="$attrs"><slot /></button>
</template>
```

Angular (17.1+ `input.required`, or `@Input({ required: true })` from v16):
```ts
@Component({
  selector: 'app-icon-button',
  template: `<button type="button" [attr.aria-label]="label()"><ng-content /></button>`,
})
export class IconButtonComponent { label = input.required<string>(); }
```

Then update every caller listed under "Used by" with a label describing the **action** ("Delete item", not "Trash icon").

## image-alt / svg-img-alt / role-img-alt

- Informative image: `alt` describes what it conveys. Make `alt` a required prop of `Avatar` / `Image` components.
- Decorative image: `alt=""` (empty, not missing). Offer it as an explicit opt-in (`decorative` prop) so it is a decision, not a default.
- Inline SVG icon next to text: `aria-hidden="true" focusable="false"`. Standalone meaningful SVG: `role="img"` + `<title>` or `aria-label`.
- Avatar next to the person's name: decorative (`alt=""`), the name already says it.
- Do not guess content. Unknown → `alt="TODO(a11y): describe"` and list it for the user.

## label / select-name / form-field labelling

Every input needs a programmatic label. Placeholder is not a label.

React: `const id = useId(); <label htmlFor={id}>{label}</label><input id={id} {...rest} />`
Vue: `<label :for="id">{{ label }}</label><input :id="id" v-bind="$attrs" />` with `const id = useId()`
Angular: `<label [for]="id">{{ label() }}</label><input [id]="id" />` with a per-instance id (`'f-' + nextId++`)

Visually hidden label when the design has none: a `.sr-only` / `.visually-hidden` class, never `display:none`.
Errors: link with `aria-describedby` and set `aria-invalid="true"` when invalid.

## color-contrast

Required: 4.5:1 for normal text, 3:1 for large text (≥ 24px, or ≥ 18.66px bold) and for UI component boundaries (WCAG 1.4.11).
- Find where the color comes from: component style, utility class (`text-gray-400`), or design token. Fix the **token** if several components use it.
- Pick the closest passing shade from the existing palette rather than an arbitrary hex, and tell the user the visual change.
- Text over images/gradients: add a solid or semi-opaque backdrop.
- axe reports `incomplete` for some backgrounds it cannot compute; those need a manual check.

## aria-* rules (aria-allowed-attr, aria-required-attr, aria-valid-attr-value, aria-hidden-focus)

- Usually means ARIA was added by hand on the wrong element. First try removing ARIA and using the native element.
- `aria-hidden-focus`: a hidden container still has focusable children (closed drawer, off-screen menu). Use the `inert` attribute on the hidden container, or don't render it.
- `aria-expanded` / `aria-controls` must be on the trigger button, updated with state.

## nested-interactive, scrollable-region-focusable

- Interactive inside interactive (button in a link, link in a button, clickable card containing buttons): make the card non-interactive and stretch the main link with a pseudo-element, keep secondary buttons separate.
- Scrollable region with no focusable content: add `tabindex="0"`, `role="region"` and an `aria-label`.

## list / listitem / definition-list

`<li>` must be a direct child of `<ul>/<ol>`. Common cause: a `ListItem` component rendering a wrapper `<div>`, or a framework wrapper (Angular host element `<app-item>` between `<ul>` and `<li>`). In Angular, put `role="listitem"` on the host via `host: { role: 'listitem' }` or render the `<li>` from the parent.

## heading-order, page-has-heading-one, landmark-*, region

Page-level structure: fix in the **layout** component (one `<main>`, a `<header>`/`<nav>`/`<footer>`, one `h1` per page). Reusable components should not hard-code heading levels: take the level as a prop (`as="h3"` / `level={3}`).

## document-title, html-has-lang

Fix once in the root: `index.html` `<html lang="…">`, and a per-route title (React Router `handle` + effect, `vue-router` `meta.title` + `afterEach`, Angular `Routes.title` / `TitleStrategy`).
