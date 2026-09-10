// Verifica locale del lavoro «suite-locale», quarto giro.
// La porta del terzo giro («far girare solo i test utili» non girava niente)
// riprovata da altre cartelle: i file dell'app che stanno DIRETTAMENTE in
// src/main/services (adblock, cookies, downloads, terminal, geoBlock…), in
// src/styles, in src/preload e in src/main/shim. Per loro il comando dei
// controlli non sceglie nessuno spec, anche quando ne esiste uno con lo
// STESSO nome (tests/adblock, tests/cookies, tests/fingerprint,
// tests/wheel-zoom) o una famiglia col nome dell'area davanti
// (downloads-*, geo-block-*, history-*, proxy-tab*, spellcheck-*, popup-*).
// Contati sull'albero del 2026-09-10: 36 file così, 19 dei 39 di services.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(process.cwd());
const tracked = execFileSync('git', ['ls-files', 'tests/*.spec.mjs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean);

async function mod() {
  return import(pathToFileURL(join(ROOT, 'scripts', 'finish-local.mjs')).href);
}

test('un servizio, uno stile o un preload toccato trova lo spec col suo stesso nome', async () => {
  const m = await mod();
  const casi = [
    ['src/main/services/adblock.js', 'tests/adblock'],
    ['src/main/services/cookies.js', 'tests/cookies'],
    ['src/main/services/fingerprint.js', 'tests/fingerprint'],
    ['src/preload/wheel-zoom.js', 'tests/wheel-zoom'],
    ['src/styles/spellcheck.css', 'tests/spellcheck'],
  ];
  for (const [file, atteso] of casi) {
    expect(existsSync(join(ROOT, `${atteso}.spec.mjs`)), `${atteso} deve esistere perché la prova abbia senso`).toBe(true);
    const specs = m.specsForChangedFiles([file], tracked);
    expect(specs, `${file} → ${specs.join(', ') || '(niente)'}`).toContain(atteso);
  }
});

test('un servizio toccato porta con sé la famiglia di spec della sua area', async () => {
  const m = await mod();
  const casi = [
    ['src/main/services/downloads.js', /^tests\/downloads?-/],
    ['src/main/services/geoBlock.js', /^tests\/geo-block-/],
    ['src/main/services/historyStore.js', /^tests\/history-/],
    ['src/main/services/proxyTab.js', /^tests\/proxy-tab/],
    ['src/main/services/terminal.js', /^tests\/terminal/],
    ['src/styles/popup.css', /^tests\/popup-/],
    ['src/styles/menu.css', /^tests\/menu-/],
  ];
  for (const [file, atteso] of casi) {
    const specs = m.specsForChangedFiles([file], tracked);
    expect(specs.some((s) => atteso.test(s)), `${file} → ${specs.join(', ') || '(niente)'}`).toBe(true);
    for (const s of specs) expect(existsSync(join(ROOT, `${s}.spec.mjs`)), `${s} non esiste`).toBe(true);
  }
});
