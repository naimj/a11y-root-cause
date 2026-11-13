// Runs INSIDE the page (injected by scan.mjs).
// Defines window.__a11yAttribute(element) -> { framework, owner, chain }
//   owner : the component whose source code wrote this markup (where the fix usually goes)
//   chain : owner first, then its ancestors (callers), innermost -> outermost
// Works on development builds. Production builds lose names/files: see references/attribution.md.
(() => {
  const MAX = 6;

  const entry = (name, file, line) => ({
    name: name || 'Anonymous',
    file: file || null,
    line: line || null,
  });

  // ---------- React (16 – 19) ----------
  function reactFiberOf(el) {
    for (let n = el; n; n = n.parentNode) {
      for (const k in n) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return n[k];
      }
    }
    return null;
  }
  function reactName(type) {
    if (!type) return null;
    if (typeof type === 'function') return type.displayName || type.name || null;
    if (typeof type === 'object') {
      if (type.displayName) return type.displayName;
      if (type.render) return type.render.displayName || type.render.name || 'ForwardRef';
      if (type.type) return reactName(type.type); // memo
    }
    return null;
  }
  const isReactComponent = (f) => f && (typeof f.type === 'function' || (f.type && typeof f.type === 'object' && (f.type.render || f.type.type)));
  function reactAttribute(el) {
    const fiber = reactFiberOf(el);
    if (!fiber) return null;
    const chain = [];
    // Prefer _debugOwner (dev only): the component that CREATED the element, even when it
    // was passed down as children/props. Falls back to the render tree (`return`).
    let f = fiber._debugOwner || fiber.return;
    const seen = new Set();
    while (f && chain.length < MAX) {
      if (isReactComponent(f) && !seen.has(f)) {
        seen.add(f);
        const src = f._debugSource; // React <= 18 dev only; React 19 removed it
        const name = reactName(f.type);
        if (name && !/^(Fragment|StrictMode|Suspense|Provider|Consumer)$/.test(name)) {
          chain.push(entry(name, src && src.fileName, src && src.lineNumber));
        }
      }
      f = f._debugOwner || f.return;
    }
    return chain.length ? { framework: 'react', chain } : { framework: 'react', chain: [] };
  }

  // ---------- Vue 3 ----------
  function vue3Attribute(el) {
    let inst = null;
    for (let n = el; n && !inst; n = n.parentNode) inst = n.__vueParentComponent || null;
    if (!inst) return null;
    const chain = [];
    while (inst && chain.length < MAX) {
      const t = inst.type || {};
      let name = t.__name || t.name;
      if (!name && t.__file) name = t.__file.split('/').pop().replace(/\.vue$/, '');
      chain.push(entry(name, t.__file));
      inst = inst.parent;
    }
    return { framework: 'vue', chain };
  }

  // ---------- Vue 2 ----------
  function vue2Attribute(el) {
    let vm = null;
    for (let n = el; n && !vm; n = n.parentNode) vm = n.__vue__ || null;
    if (!vm) return null;
    const chain = [];
    while (vm && chain.length < MAX) {
      const o = vm.$options || {};
      chain.push(entry(o.name || o._componentTag, o.__file));
      vm = vm.$parent;
    }
    return { framework: 'vue2', chain };
  }

  // ---------- Angular (dev mode exposes window.ng) ----------
  function angularAttribute(el) {
    const ng = window.ng;
    if (!ng || typeof ng.getComponent !== 'function') return null;
    const chain = [];
    const seen = new Set();
    const push = (c) => {
      if (c && !seen.has(c)) {
        seen.add(c);
        chain.push(entry(c.constructor && c.constructor.name));
      }
    };
    // Component whose TEMPLATE contains this element = where the markup lives.
    try { if (ng.getOwningComponent) push(ng.getOwningComponent(el)); } catch (_) {}
    for (let n = el; n && chain.length < MAX; n = n.parentNode) {
      try { push(ng.getComponent(n)); } catch (_) {}
    }
    return chain.length ? { framework: 'angular', chain } : null;
  }

  // ---------- Fallback: explicit markers ----------
  function markerAttribute(el) {
    const chain = [];
    for (let n = el; n && n.getAttribute && chain.length < MAX; n = n.parentNode) {
      const c = n.getAttribute('data-component') || n.getAttribute('data-testid');
      if (c) chain.push(entry(c));
    }
    return chain.length ? { framework: 'marker', chain } : null;
  }

  window.__a11yAttribute = function (el) {
    if (!el) return { framework: 'unknown', owner: null, chain: [] };
    const r =
      angularAttribute(el) || // check first: Angular apps never have React/Vue keys
      vue3Attribute(el) ||
      vue2Attribute(el) ||
      reactAttribute(el) ||
      markerAttribute(el) ||
      { framework: 'unknown', chain: [] };
    r.owner = r.chain[0] || null;
    return r;
  };

  window.__a11yDetectFramework = function () {
    if (window.ng && window.ng.getComponent) return 'angular';
    if (document.querySelector('[data-v-app]') || window.__VUE__) return 'vue';
    const all = document.querySelectorAll('body *');
    for (let i = 0; i < Math.min(all.length, 200); i++) {
      for (const k in all[i]) if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) return 'react';
      if (all[i].__vue__) return 'vue2';
      if (all[i].__vueParentComponent) return 'vue';
    }
    return 'unknown';
  };
})();
