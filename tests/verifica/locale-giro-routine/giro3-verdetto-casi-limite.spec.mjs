// Prove del giro 3 (verifica locale) sul lavoro «giro di routine del 14/09»,
// punto 1: il verdetto della suite davanti agli esiti che il giro 1 non aveva
// messo alla prova. Una piccola suite vera, con lo stesso comando del lavoro di
// release: un caso che scade (timedOut, non «failed»), un rosso atteso
// (test.fail) che fallisce come deve, un rosso atteso che invece passa, un
// fixme; e poi un file di spec che non si carica nemmeno (errore di sintassi).

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const VERDETTO = join(ROOT, 'scripts', 'suite-verdict.mjs');
// Dentro tests/.smoke (gitignorata): gli spec di prova trovano @playwright/test
// risalendo ai node_modules del repo.
const SCRATCH = join(ROOT, 'tests', '.smoke', 'giro3-verdetto-casi-limite');

const CONFIG = `export default { testDir: '.', retries: 1, workers: 1, timeout: 10000 };\n`;
const SPEC = `import { test, expect } from '@playwright/test';
test('verde', () => { expect(1).toBe(1); });
test('scaduto', async () => { test.setTimeout(700); await new Promise((r) => setTimeout(r, 3000)); });
test('rosso atteso', () => { test.fail(true, 'rilievo aperto'); expect(1).toBe(2); });
test('rosso atteso che invece passa', () => { test.fail(true, 'rilievo chiuso'); expect(1).toBe(1); });
test.fixme('da sistemare', () => {});
`;
const ROTTO = `import { test } from '@playwright/test';
test('mai eseguito', () => {}
`;

function ambientePulito() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(PLAYWRIGHT_|PW_|TEST_WORKER_INDEX|TEST_PARALLEL_INDEX)/.test(k)) delete env[k];
  }
  return env;
}

function lanciaPlaywright(cwd) {
  const args = ['test', '--config', 'playwright.config.mjs', '--reporter=list,json'];
  const opts = { cwd, encoding: 'utf8', env: { ...ambientePulito(), PLAYWRIGHT_JSON_OUTPUT_NAME: 'suite-risultati.json' }, timeout: 180000 };
  for (const p of ['node_modules/@playwright/test/cli.js', 'node_modules/playwright/cli.js']) {
    if (existsSync(join(ROOT, p))) return spawnSync(process.execPath, [join(ROOT, p), ...args], opts);
  }
  return spawnSync('npx', ['playwright', ...args], { ...opts, shell: true });
}

function verdetto(dir) {
  const noti = join(dir, 'noti.json');
  writeFileSync(noti, JSON.stringify({ contenitore: { specs: [] } }));
  const out = join(dir, 'rossi-nuovi.txt');
  const r = spawnSync(process.execPath, [VERDETTO, join(dir, 'suite-risultati.json'), '--rossi', noti, '--out', out], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || ''), righe: existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean) : null };
}

test.describe('verdetto della suite — gli esiti oltre «failed»', () => {
  test('un caso scaduto e un rosso atteso che passa sono rossi; un rosso atteso che fallisce e un fixme no', () => {
    const dir = join(SCRATCH, 'esiti');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'playwright.config.mjs'), CONFIG);
    writeFileSync(join(dir, 'casi.spec.mjs'), SPEC);
    const pw = lanciaPlaywright(dir);
    expect(existsSync(join(dir, 'suite-risultati.json')), String(pw.stderr).slice(-600)).toBe(true);
    const v = verdetto(dir);
    expect(v.status, v.stdout + v.stderr).toBe(1);
    expect(v.righe).toEqual(['tests/casi.spec.mjs › scaduto', 'tests/casi.spec.mjs › rosso atteso che invece passa']);
    expect(v.stdout).toMatch(/verdi: 2 /);
    expect(v.stdout).toMatch(/saltati: 1/);
  });

  test('un file di spec che non si carica ferma la pubblicazione (uscita 2, non un verde)', () => {
    const dir = join(SCRATCH, 'rotto');
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'playwright.config.mjs'), CONFIG);
    writeFileSync(join(dir, 'casi.spec.mjs'), SPEC);
    writeFileSync(join(dir, 'rotto.spec.mjs'), ROTTO);
    lanciaPlaywright(dir);
    // Playwright, davanti a un file che non compila, non esegue NESSUN caso.
    const v = verdetto(dir);
    expect(v.status, v.stdout + v.stderr).toBe(2);
    expect(v.stderr).toMatch(/nessun caso/);
    expect(v.stderr).toMatch(/rotto\.spec\.mjs/);
  });
});
