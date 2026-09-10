// Verifica locale del lavoro «suite-locale», sesto giro.
// Le porte dei giri passati restano chiuse (le prove dei giri 1–5 lo dicono).
// Qui si prova quello che resta: la regola del nome trova uno spec solo se
// il nome del file sta IN TESTA al nome dello spec. Ma molti spec portano il
// nome del file in mezzo o in coda (tab-browser-shortcuts, auth-shell,
// context-menu-*, hidden-window, net-error-page, spellcheck-languages,
// preferences-tab-color): per quei file — un terzo dell'app, 84 su 255 — il
// comando dei controlli non sceglie niente. Il primo test è rosso di
// proposito. Gli altri due ri-provano due cose che devono restare vere:
// uno spec cancellato dal ramo non viene lanciato, e uno fra i rossi noti
// toccato direttamente non blocca.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const tracked = execFileSync('git', ['ls-files', 'tests/*.spec.mjs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

async function mod() {
  return import(pathToFileURL(join(ROOT, 'scripts', 'finish-local.mjs')).href);
}

test('un file il cui nome sta dentro al nome di uno spec (non in testa) lo fa partire', async () => {
  // Rilievo con punto di domanda del sesto giro: quale regola allargare (il
  // nome ovunque nel nome dello spec, o una mappa a mano) la decide l'owner.
  // Atteso rosso finché non decide (poi togliere questa riga).
  test.fail(true, 'il nome del file conta solo in testa allo spec: decisione owner aperta');
  const m = await mod();
  const attesi = {
    'src/main/shortcuts.js': 'tests/tab-browser-shortcuts',
    'src/renderer/shell.js': 'tests/auth-shell',
    'src/content/extractContext.js': 'tests/context-menu-grow',
    'src/main/window.js': 'tests/hidden-window',
    'src/pages/error/error.js': 'tests/net-error-page',
    'src/shared/spellLanguages.js': 'tests/spellcheck-languages',
    'src/shared/tabColor.js': 'tests/preferences-tab-color',
    'src/main/services/siteBlock.js': 'tests/geo-block-rules',
  };
  const mancanti = [];
  for (const [file, spec] of Object.entries(attesi)) {
    expect(tracked, `${spec} esiste`).toContain(`${spec}.spec.mjs`);
    if (!m.specsForChangedFiles([file], tracked).includes(spec)) mancanti.push(`${file} → ${spec}`);
  }
  expect(mancanti, 'file che non fanno partire lo spec che porta il loro nome').toEqual([]);
});

test('uno spec cancellato dal ramo non viene lanciato', async () => {
  const m = await mod();
  const specs = m.specsForChangedFiles(['tests/non-esiste-piu.spec.mjs', 'tests/tab-archive.spec.mjs'], tracked)
    .filter((s) => tracked.includes(`${s}.spec.mjs`));
  expect(specs).toEqual(['tests/tab-archive']);
});

test('uno spec fra i rossi noti toccato direttamente si lancia ma non blocca', async () => {
  const m = await mod();
  const noti = JSON.parse(readFileSync(join(ROOT, 'tests', 'rossi-noti.json'), 'utf8')).specs;
  expect(noti.length).toBeGreaterThan(0);
  const uno = noti[0];
  const specs = m.specsForChangedFiles([`${uno}.spec.mjs`], tracked);
  const { blocking, informative } = m.splitKnownRed(specs, noti);
  expect(informative).toEqual([uno]);
  expect(blocking).toEqual([]);
});
