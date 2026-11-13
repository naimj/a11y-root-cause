#!/usr/bin/env node
// Groups the violations from scan.mjs by the component that wrote them, ranks components by
// leverage (how many violating nodes a single fix removes), resolves each component to its
// source file, and writes a report the agent works from.
//
// Usage:
//   node cluster.mjs --in a11y-scan.json --root /path/to/project [--out-dir a11y-report]
//   node cluster.mjs --in after.json --baseline before.json --root .   # verify mode
// Writes: <out-dir>/clusters.json and <out-dir>/report.md
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';

const argv = process.argv.slice(2);
const opt = { root: '.', 'out-dir': 'a11y-report' };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, '');
  opt[k] = argv[i + 1]; i++;
}
if (!opt.in) { console.error('Usage: node cluster.mjs --in a11y-scan.json --root <project> [--baseline before.json]'); process.exit(2); }

const IMPACT_WEIGHT = { critical: 4, serious: 3, moderate: 2, minor: 1 };

// ---------- grouping ----------
function collect(scan) {
  const nodes = [];
  for (const p of scan.pages) {
    for (const v of p.violations || []) {
      for (const n of v.nodes) {
        nodes.push({
          page: p.url, rule: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags,
          target: n.target, html: n.html, failureSummary: n.failureSummary,
          framework: n.framework, owner: n.owner, chain: n.chain || [],
        });
      }
    }
  }
  return nodes;
}

function group(nodes) {
  const comps = new Map();
  for (const n of nodes) {
    const name = n.owner ? n.owner.name : '(unattributed)';
    if (!comps.has(name)) comps.set(name, { component: name, framework: n.framework, file: null, line: null, nodes: 0, weighted: 0, pages: new Set(), callers: new Map(), rules: new Map() });
    const c = comps.get(name);
    if (!c.file && n.owner && n.owner.file) { c.file = n.owner.file; c.line = n.owner.line; }
    c.nodes++;
    c.weighted += IMPACT_WEIGHT[n.impact] || 1;
    c.pages.add(n.page);
    const caller = n.chain[1] ? n.chain[1].name : '(root)';
    c.callers.set(caller, (c.callers.get(caller) || 0) + 1);
    if (!c.rules.has(n.rule)) c.rules.set(n.rule, { rule: n.rule, impact: n.impact, help: n.help, helpUrl: n.helpUrl, tags: n.tags, count: 0, examples: [] });
    const r = c.rules.get(n.rule);
    r.count++;
    if (r.examples.length < 3) r.examples.push({ page: n.page, target: n.target, html: n.html, failureSummary: n.failureSummary, caller });
  }
  return [...comps.values()].map((c) => {
    const distinctCallers = [...c.callers.keys()].filter((k) => k !== '(root)').length;
    const shared = c.component !== '(unattributed)' && (distinctCallers >= 2 || c.pages.size >= 2);
    return {
      component: c.component,
      framework: c.framework,
      file: c.file,
      line: c.line,
      nodes: c.nodes,
      weightedScore: c.weighted,
      pages: [...c.pages],
      callers: Object.fromEntries([...c.callers.entries()].sort((a, b) => b[1] - a[1])),
      scope: shared ? 'shared' : 'local',
      rules: [...c.rules.values()].sort((a, b) => (IMPACT_WEIGHT[b.impact] || 0) - (IMPACT_WEIGHT[a.impact] || 0) || b.count - a.count),
    };
  }).sort((a, b) => b.weightedScore - a.weightedScore || b.nodes - a.nodes);
}

// ---------- source resolution ----------
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '.angular', 'coverage', 'out', '.output', '.svelte-kit', 'storybook-static']);
const EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.mjs']);
function walk(dir, acc = [], depth = 0) {
  if (depth > 12 || acc.length > 20000) return acc;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.storybook') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) walk(p, acc, depth + 1); }
    else if (EXT.has(extname(e.name))) acc.push(p);
  }
  return acc;
}
const kebab = (s) => s.replace(/Component$/, '').replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
let FILES = null;
function resolveSource(name, root, framework) {
  if (!name || name.startsWith('(') || name === 'Anonymous') return null;
  // Names come from the scanned page (untrusted): only accept plain identifiers,
  // so they can never inject regex syntax or path segments.
  if (!/^[A-Za-z_$][\w$-]{0,80}$/.test(name)) return null;
  FILES ||= walk(root);
  const base = (f) => basename(f).replace(/\.(component|stories|spec|test)?\.?(t|j)sx?$|\.vue$|\.svelte$/, '');
  // 1. filename match (Button.tsx, Button.vue, button.component.ts, Button/index.tsx)
  let hits = FILES.filter((f) => {
    const b = basename(f);
    if (/\.(spec|test|stories)\./.test(b)) return false;
    return base(f) === name || b === `${kebab(name)}.component.ts` || ((/^index\./.test(b)) && basename(join(f, '..')) === name);
  });
  // 2. content match
  if (!hits.length) {
    const n = name.replace(/[$]/g, '\\$&'); // `$` is the only regex metachar allowed by the check above
    const re = new RegExp(`(export\\s+(default\\s+)?(class|function)\\s+${n}\\b|(const|let|var)\\s+${n}\\s*[=:]|name:\\s*['"\`]${n}['"\`]|displayName\\s*=\\s*['"\`]${n}['"\`])`);
    for (const f of FILES) {
      if (/\.(spec|test|stories)\./.test(f)) continue;
      try { if (statSync(f).size < 400000 && re.test(readFileSync(f, 'utf8'))) hits.push(f); } catch {}
      if (hits.length > 5) break;
    }
  }
  if (!hits.length) return null;
  // Prefer files that match the detected framework, keep the rest only if nothing matches.
  const fits = {
    react: (f) => /\.(j|t)sx?$/.test(f) && !/\.component\.ts$/.test(f),
    vue: (f) => /\.vue$/.test(f), vue2: (f) => /\.vue$/.test(f),
    angular: (f) => /\.component\.ts$/.test(f),
  }[framework];
  if (fits && hits.some(fits)) hits = hits.filter(fits);
  return hits.map((f) => relative(root, f));
}

// ---------- leverage ----------
function leverage(comps, total) {
  let cum = 0;
  return comps.map((c, i) => { cum += c.nodes; return { rank: i + 1, component: c.component, nodes: c.nodes, cumulativePct: total ? Math.round((cum / total) * 1000) / 10 : 0 }; });
}

// ---------- main ----------
const scan = JSON.parse(readFileSync(opt.in, 'utf8'));
const nodes = collect(scan);
const comps = group(nodes);
for (const c of comps) {
  if (c.file && /node_modules/.test(c.file)) { c.thirdParty = true; continue; }
  if (!c.file) {
    const hits = resolveSource(c.component, opt.root, c.framework);
    c.candidateFiles = hits;
  }
}
const lev = leverage(comps, nodes.length);
const attributed = nodes.filter((n) => n.owner).length;
const top3 = lev[Math.min(2, lev.length - 1)];

let verify = null;
if (opt.baseline) {
  const before = group(collect(JSON.parse(readFileSync(opt.baseline, 'utf8'))));
  const beforeMap = new Map(before.map((c) => [c.component, c.nodes]));
  const afterMap = new Map(comps.map((c) => [c.component, c.nodes]));
  const names = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  verify = [...names].map((n) => ({ component: n, before: beforeMap.get(n) || 0, after: afterMap.get(n) || 0 }))
    .map((r) => ({ ...r, status: r.after === 0 && r.before > 0 ? 'fixed' : r.after > r.before ? (r.before === 0 ? 'NEW' : 'worse') : r.after < r.before ? 'improved' : 'unchanged' }))
    .sort((a, b) => (b.status === 'NEW') - (a.status === 'NEW') || b.before - a.before);
  verify.totals = { before: before.reduce((s, c) => s + c.nodes, 0), after: nodes.length };
}

const summary = {
  pages: scan.pages.length,
  pagesWithErrors: scan.pages.filter((p) => p.error).map((p) => ({ url: p.url, error: p.error })),
  frameworks: [...new Set(scan.pages.map((p) => p.framework))],
  violatingNodes: nodes.length,
  rules: new Set(nodes.map((n) => n.rule)).size,
  components: comps.length,
  attributionRate: nodes.length ? Math.round((attributed / nodes.length) * 1000) / 10 : 100,
  headline: top3 ? `Fixing the top ${top3.rank} component(s) removes ${top3.cumulativePct}% of violating nodes.` : 'No violations found.',
};

mkdirSync(opt['out-dir'], { recursive: true });
writeFileSync(join(opt['out-dir'], 'clusters.json'), JSON.stringify({ summary, leverage: lev, components: comps, verify }, null, 2));

// ---------- report.md ----------
const L = [];
L.push(`# Accessibility root-cause report`, '');
L.push(`Scanned ${summary.pages} page(s) · ${summary.violatingNodes} violating nodes · ${summary.rules} axe rules · ${summary.components} components · attribution ${summary.attributionRate}%`, '');
if (summary.pagesWithErrors.length) L.push(`**Pages that failed to load:** ${summary.pagesWithErrors.map((p) => `${p.url} (${p.error})`).join('; ')}`, '');
if (summary.attributionRate < 70 && nodes.length) L.push(`> ⚠️ Low attribution rate. The app is probably a production build. Re-run against the dev server (see references/attribution.md).`, '');
if (verify) {
  L.push(`## Verification against baseline`, '', `Total violating nodes: ${verify.totals.before} → ${verify.totals.after}`, '', '| Component | Before | After | Status |', '|---|---:|---:|---|');
  for (const r of verify) L.push(`| ${r.component} | ${r.before} | ${r.after} | ${r.status} |`);
  L.push('');
}
L.push(`## Headline`, '', `**${summary.headline}**`, '');
L.push('| # | Component | Scope | Nodes | Cumulative |', '|---:|---|---|---:|---:|');
for (const r of lev.slice(0, 15)) {
  const c = comps[r.rank - 1];
  L.push(`| ${r.rank} | ${r.component} | ${c.thirdParty ? 'third-party' : c.scope} | ${r.nodes} | ${r.cumulativePct}% |`);
}
L.push('');
L.push(`## Components, highest leverage first`, '');
for (const c of comps) {
  const src = c.file ? `${c.file}${c.line ? ':' + c.line : ''}` : c.candidateFiles ? `candidates: ${c.candidateFiles.join(', ')}` : 'source not found';
  L.push(`### ${c.component} — ${c.nodes} node(s), ${c.thirdParty ? 'third-party' : c.scope}`);
  L.push(`- Source: \`${src}\``);
  L.push(`- Used by: ${Object.entries(c.callers).map(([k, v]) => `${k} (${v})`).join(', ')}`);
  L.push(`- Pages: ${c.pages.length}`);
  for (const r of c.rules) {
    L.push(`- **${r.rule}** [${r.impact}] × ${r.count} — ${r.help} ([rule](${r.helpUrl}))`);
    for (const e of r.examples) L.push(`  - \`${(e.html || '').replace(/`/g, "'").slice(0, 160)}\` (caller: ${e.caller})`);
  }
  L.push('');
}
L.push(`---`, `Automated checks find roughly a third to a half of WCAG issues. Keyboard flow, focus order, screen-reader wording and content still need manual review.`);
writeFileSync(join(opt['out-dir'], 'report.md'), L.join('\n'));
console.error(summary.headline);
console.error(`Wrote ${join(opt['out-dir'], 'report.md')} and clusters.json`);
