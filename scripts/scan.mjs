#!/usr/bin/env node
// Runtime accessibility scan with component attribution.
// Renders each URL in a real browser, runs axe-core, and attributes every violating
// DOM node to the React / Vue / Angular component that wrote it.
//
// Usage:
//   node scan.mjs --url http://localhost:5173/ --url http://localhost:5173/login --out a11y-scan.json
//   node scan.mjs --urls urls.txt --out a11y-scan.json
// Options:
//   --tags wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa   axe rule tags (default shown)
//   --wait 1500            extra ms after load for SPA rendering (default 1000)
//   --storage-state f.json Playwright storage state for logged-in pages
//   --browser-path /path   use a specific Chrome/Chromium binary
//   --viewport 1280x800    (default)
//
// Exit codes: 0 = scan done (violations or not), 2 = setup error.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const a = { url: [], tags: 'wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa', wait: 1000, out: 'a11y-scan.json', viewport: '1280x800' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i].replace(/^--/, '');
    const v = argv[i + 1];
    if (k === 'url') { a.url.push(v); i++; }
    else if (['urls', 'tags', 'wait', 'out', 'storage-state', 'browser-path', 'viewport'].includes(k)) { a[k] = v; i++; }
    else if (k === 'help' || k === 'h') a.help = true;
  }
  if (a.urls) a.url.push(...readFileSync(a.urls, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#')));
  return a;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.url.length) {
  console.error('Usage: node scan.mjs --url <url> [--url <url>...] [--out a11y-scan.json]');
  process.exit(args.help ? 0 : 2);
}

let chromium;
try { ({ chromium } = require('playwright-core')); }
catch { try { ({ chromium } = require('playwright')); } catch {
  console.error('Missing dependency: run `npm install` in the skill\'s scripts/ folder (playwright-core, axe-core).');
  process.exit(2);
} }
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const attributeSource = readFileSync(join(here, 'attribute.js'), 'utf8');

async function launch() {
  const tries = [];
  if (args['browser-path']) tries.push({ executablePath: args['browser-path'] });
  tries.push({}, { channel: 'chrome' }, { channel: 'msedge' });
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) {
    if (existsSync(p)) tries.push({ executablePath: p });
  }
  let last;
  for (const opts of tries) {
    try { return await chromium.launch({ headless: true, ...opts }); } catch (e) { last = e; }
  }
  console.error('Could not launch a browser. Install one with `npx playwright install chromium` or pass --browser-path.\n' + (last && last.message));
  process.exit(2);
}

const [vw, vh] = args.viewport.split('x').map(Number);
const browser = await launch();
const context = await browser.newContext({
  viewport: { width: vw || 1280, height: vh || 800 },
  ...(args['storage-state'] ? { storageState: args['storage-state'] } : {}),
});
await context.addInitScript(attributeSource);

const tags = args.tags.split(',').map((s) => s.trim()).filter(Boolean);
const result = { tool: 'a11y-root-cause/scan', version: 1, scannedAt: new Date().toISOString(), tags, pages: [] };

for (const url of args.url) {
  const page = await context.newPage();
  const pageResult = { url, framework: 'unknown', violations: [], incomplete: 0, passes: 0, error: null };
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
    if (resp && resp.status() >= 400) throw new Error(`HTTP ${resp.status()}`);
    try { await page.waitForLoadState('networkidle', { timeout: 10000 }); } catch {}
    await page.waitForTimeout(Number(args.wait));
    await page.addScriptTag({ content: axeSource });
    const out = await page.evaluate(async (tags) => {
      const r = await window.axe.run(document, {
        runOnly: { type: 'tag', values: tags },
        elementRef: true,
        resultTypes: ['violations'],
      });
      return {
        framework: window.__a11yDetectFramework ? window.__a11yDetectFramework() : 'unknown',
        incomplete: r.incomplete.length,
        passes: r.passes.length,
        violations: r.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          helpUrl: v.helpUrl,
          tags: v.tags.filter((t) => /^wcag|^best-practice$/.test(t)),
          nodes: v.nodes.map((n) => {
            const attr = window.__a11yAttribute ? window.__a11yAttribute(n.element) : { framework: 'unknown', owner: null, chain: [] };
            return {
              target: n.target,
              html: (n.html || '').slice(0, 300),
              failureSummary: n.failureSummary,
              framework: attr.framework,
              owner: attr.owner,
              chain: attr.chain,
            };
          }),
        })),
      };
    }, tags);
    Object.assign(pageResult, out);
  } catch (e) {
    pageResult.error = e.message.split('\n')[0];
  }
  const n = pageResult.violations.reduce((s, v) => s + v.nodes.length, 0);
  console.error(`${pageResult.error ? 'ERROR' : 'ok   '} ${url}  framework=${pageResult.framework}  violations=${pageResult.violations.length} rules / ${n} nodes${pageResult.error ? '  ' + pageResult.error : ''}`);
  result.pages.push(pageResult);
  await page.close();
}

await browser.close();
writeFileSync(args.out, JSON.stringify(result, null, 2));
console.error(`\nWrote ${args.out}. Next: node cluster.mjs --in ${args.out} --root <project root>`);
