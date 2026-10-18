// Nelle pagine interne un <button> scritto nell'HTML senza classe resta col disegno del sistema (bianco acceso in tema
// scuro): il foglio condiviso non dà uno stile ai bottoni nudi (#1084). Vale anche un id o un contenitore che la pagina
// stessa disegna.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PAGINE = join(ROOT, 'src', 'pages');
const condiviso = readFileSync(join(ROOT, 'src', 'styles', 'pages.css'), 'utf8');

function html(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...html(p));
    else if (n.endsWith('.html')) out.push(p);
  }
  return out;
}

test('ogni bottone scritto nelle pagine interne ha uno stile: una classe, o un id o un contenitore disegnati', () => {
  const nudi = [];
  for (const f of html(PAGINE)) {
    const s = readFileSync(f, 'utf8');
    if (!s.includes('filo://style/pages.css')) continue;
    const proprio = [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
    const css = `${condiviso}\n${proprio}`;
    for (const m of s.matchAll(/<button\b([^>]*)>/g)) {
      const attr = m[1];
      if (/\bclass\s*=/.test(attr)) continue;
      const id = (/\bid\s*=\s*"([^"]+)"/.exec(attr) || [])[1];
      if (id && css.includes(`#${id}`)) continue;
      // Un contenitore che disegna i suoi bottoni («.bd-auth button»): il bottone dev'essere dentro quel contenitore.
      const prima = s.slice(0, m.index);
      const contenitori = [...proprio.matchAll(/\.([\w-]+)\s+button\b/g)].map((x) => x[1]);
      if (contenitori.some((c) => new RegExp(`class="[^"]*\\b${c}\\b`).test(prima.slice(prima.lastIndexOf('<div')))) ) continue;
      nudi.push(`${relative(ROOT, f).replace(/\\/g, '/')}: <button${attr}>`);
    }
  }
  assert.deepEqual(nudi, [], 'un bottone nudo prende il disegno del sistema: dagli «sn-btn sn-btn-secondary» o uno stile suo');
});
