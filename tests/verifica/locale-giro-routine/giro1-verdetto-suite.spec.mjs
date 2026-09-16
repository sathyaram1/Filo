// Prove del giro 1 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 1: la suite completa gira in GitHub e il verdetto toglie dal conto i
// rossi noti del contenitore. Qui si fa girare una PICCOLA suite vera (verde,
// due rossi, un flaky, un saltato, un rosso dentro un describe) con lo stesso
// comando del lavoro di release — reporter list+json, il JSON nel file detto
// da PLAYWRIGHT_JSON_OUTPUT_NAME — e si dà il suo esito allo script del
// verdetto con elenchi di rossi noti scritti apposta.

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERDETTO = join(ROOT, 'scripts', 'suite-verdict.mjs');
// Dentro tests/.smoke (gitignorata) perché gli spec di prova devono trovare
// @playwright/test risalendo ai node_modules del repo.
const SCRATCH = join(ROOT, 'tests', '.smoke', 'giro-routine-verdetto');

const SPEC = `import { test, expect } from '@playwright/test';
test('verde', () => { expect(1).toBe(1); });
test('rosso noto del contenitore', () => { expect(1).toBe(2); });
test('rosso nuovo', () => { expect(1).toBe(3); });
test.describe('cornice', () => {
  test('rosso nella cornice', () => { expect(true).toBe(false); });
});
test('instabile', ({}, info) => { if (info.retry === 0) throw new Error('primo colpo'); });
test.skip('saltato', () => {});
`;

const CONFIG = `export default { testDir: '.', retries: 1, workers: 1, timeout: 10000 };\n`;

function ambientePulito() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(PLAYWRIGHT_|PW_|TEST_WORKER_INDEX|TEST_PARALLEL_INDEX)/.test(k)) delete env[k];
  }
  return env;
}

/** Come si lancia Playwright: il suo cli.js se si trova, altrimenti `npx playwright` (con la shell). */
function lanciaPlaywright(args, opts) {
  for (const p of ['node_modules/@playwright/test/cli.js', 'node_modules/playwright/cli.js']) {
    if (existsSync(join(ROOT, p))) return spawnSync(process.execPath, [join(ROOT, p), ...args], opts);
  }
  return spawnSync('npx', ['playwright', ...args], { ...opts, shell: true });
}

function verdetto(json, noti, out) {
  const args = [VERDETTO, json, '--out', out];
  if (noti) args.push('--rossi', noti);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

let esito;

test.beforeAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  writeFileSync(join(SCRATCH, 'playwright.config.mjs'), CONFIG);
  writeFileSync(join(SCRATCH, 'prova.spec.mjs'), SPEC);
  // Come nel lavoro di release: nome RELATIVO nel file, cwd = cartella della config.
  const r = lanciaPlaywright(['test', '--config', 'playwright.config.mjs', '--reporter=list,json'], {
    cwd: SCRATCH, encoding: 'utf8', env: { ...ambientePulito(), PLAYWRIGHT_JSON_OUTPUT_NAME: 'suite-risultati.json' }, timeout: 120000,
  });
  esito = { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
});

test.describe('verdetto della suite — rossi noti e rossi nuovi', () => {
  test('la piccola suite ha lasciato il JSON dove il lavoro di release lo legge', () => {
    expect(esito.status, esito.stderr.slice(-800)).not.toBe(0);
    expect(existsSync(join(SCRATCH, 'suite-risultati.json'))).toBe(true);
  });

  test('con due rossi noti scritti per titolo, resta UN rosso nuovo e la suite è rossa', () => {
    const noti = join(SCRATCH, 'noti-per-titolo.json');
    writeFileSync(noti, JSON.stringify({ contenitore: { specs: [
      { spec: 'tests/prova', caso: ['rosso noto del contenitore', 'rosso nella cornice'], perche: 'prova', feedback: '#0' },
    ] } }));
    const out = join(SCRATCH, 'rossi-nuovi-1.txt');
    const v = verdetto(join(SCRATCH, 'suite-risultati.json'), noti, out);
    expect(v.status, v.stdout + v.stderr).toBe(1);
    const righe = readFileSync(out, 'utf8').split('\n').filter(Boolean);
    expect(righe).toHaveLength(1);
    expect(righe[0]).toMatch(/prova\.spec\.mjs › rosso nuovo$/);
    expect(v.stdout).toMatch(/Rossi NUOVI: 1/);
    expect(v.stdout).toMatch(/coperti: 2/);
    expect(v.stdout).toMatch(/flaky \(verdi dopo un tentativo\): 1/);
    expect(v.stdout).toMatch(/saltati: 1/);
  });

  test('con lo spec intero fra i rossi noti la suite passa', () => {
    const noti = join(SCRATCH, 'noti-spec-intero.json');
    writeFileSync(noti, JSON.stringify({ contenitore: { specs: [{ spec: 'tests/prova', perche: 'prova', feedback: '#0' }] } }));
    const out = join(SCRATCH, 'rossi-nuovi-2.txt');
    const v = verdetto(join(SCRATCH, 'suite-risultati.json'), noti, out);
    expect(v.status, v.stdout + v.stderr).toBe(0);
    expect(readFileSync(out, 'utf8').trim()).toBe('');
  });

  test('un titolo scritto quasi giusto NON copre: tre rossi nuovi', () => {
    const noti = join(SCRATCH, 'noti-sbagliati.json');
    writeFileSync(noti, JSON.stringify({ contenitore: { specs: [
      { spec: 'tests/prova', caso: 'rosso noto del contenitore (vecchio titolo)', perche: 'prova', feedback: '#0' },
    ] } }));
    const out = join(SCRATCH, 'rossi-nuovi-3.txt');
    const v = verdetto(join(SCRATCH, 'suite-risultati.json'), noti, out);
    expect(v.status).toBe(1);
    expect(readFileSync(out, 'utf8').split('\n').filter(Boolean)).toHaveLength(3);
  });

  test('senza JSON (suite non partita) il verdetto non è un verde', () => {
    const v = verdetto(join(SCRATCH, 'non-esiste.json'), null, join(SCRATCH, 'rossi-nuovi-4.txt'));
    expect(v.status).toBe(2);
    expect(v.stderr).toMatch(/NON è partita/);
  });

  test('un JSON senza casi (zero test raccolti) non è un verde', () => {
    const vuoto = join(SCRATCH, 'vuoto.json');
    writeFileSync(vuoto, JSON.stringify({ suites: [], errors: [] }));
    const v = verdetto(vuoto, null, join(SCRATCH, 'rossi-nuovi-5.txt'));
    expect(v.status).toBe(2);
  });

  test('i rossi noti VERI del repo citano titoli che esistono negli spec', () => {
    const noti = JSON.parse(readFileSync(join(ROOT, 'tests', 'rossi-noti.json'), 'utf8'));
    for (const voce of noti.contenitore.specs) {
      const file = join(ROOT, `${voce.spec}.spec.mjs`);
      expect(existsSync(file), `${voce.spec}: lo spec non c'è`).toBe(true);
      const src = readFileSync(file, 'utf8');
      const titoli = Array.isArray(voce.caso) ? voce.caso : (voce.caso ? [voce.caso] : []);
      for (const t of titoli) {
        expect(src.includes(t.replace(/\s+/g, ' ')) || src.includes(t), `${voce.spec}: titolo «${t}» non trovato`).toBe(true);
      }
    }
  });
});
