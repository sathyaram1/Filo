// Il controllo di fine lavoro fermato dal tetto di un comando si rilancia e riparte dagli spec non ancora verdi
// (#2113): il lancio a lotti vero segna ogni spec appena passa, anche in un lotto rosso o ucciso a metà, e il
// rilancio salta solo quelli. La chiave della memoria la provano gli unit (finishRipresaSpec).
import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { cartellaTemporanea } from './helpers/percorsi.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FINISH = join(REPO, 'scripts', 'finish-local.mjs');
// Il controllo di fine lavoro lancia questo spec in una cartella staccata col node_modules un livello sopra: si chiede
// a Node dove sta, invece di presumerlo dentro il repo.
const MODULI = dirname(dirname(dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json'))));

function repoProva(prefisso) {
  const dir = cartellaTemporanea(prefisso);
  const g = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 't@t'); g('config', 'user.name', 't'); g('config', 'commit.gpgsign', 'false');
  return { dir, g };
}

// Due spec in un lotto solo: il primo passa e lascia un segno, il secondo è rosso o lento.
function alberoConDueSpec(secondo) {
  const { dir, g } = repoProva('finish-ripresa-');
  mkdirSync(join(dir, 'tests'), { recursive: true });
  symlinkSync(MODULI, join(dir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\nb-avviato\n');
  // Un nuovo tentativo per i rossi passeggeri, come la suite di Filo.
  writeFileSync(join(dir, 'playwright.config.mjs'), "export default { testDir: 'tests', workers: 1, retries: 1, timeout: 300_000, reporter: 'line' };\n");
  const passeggero = `if (!existsSync(${JSON.stringify(join(dir, 'b-avviato'))})) { writeFileSync(${JSON.stringify(join(dir, 'b-avviato'))}, '1'); throw new Error('avvio passeggero'); }`;
  writeFileSync(join(dir, 'tests', 'a-verde.spec.mjs'), [
    "import { test } from '@playwright/test';",
    "import { writeFileSync } from 'node:fs';",
    `test('verde', () => { writeFileSync(${JSON.stringify(join(dir, 'a-fatto'))}, '1'); });`,
  ].join('\n'));
  const corpi = {
    rosso: ["import { test, expect } from '@playwright/test';", "test('rosso', () => { expect(1).toBe(2); });"],
    lento: ["import { test } from '@playwright/test';", "test('lento', async () => { await new Promise((r) => setTimeout(r, 120_000)); });"],
    // Il test passa, il lancio è rosso: l'errore arriva fuori da ogni test.
    chiusura: [
      "import { test as base } from '@playwright/test';",
      "const test = base.extend({ w: [async ({}, use) => { await use(1); throw new Error('chiusura rotta'); }, { scope: 'worker' }] });",
      "test('chiusura', ({ w }) => {});",
    ],
    // Il secondo test viene saltato perché qualcosa prima è caduto una volta, poi è rosso a ogni nuovo tentativo.
    preparazione: [
      "import { test, expect } from '@playwright/test';",
      "import { existsSync, writeFileSync } from 'node:fs';",
      `test.beforeAll(() => { ${passeggero} });`,
      "test('si apre', () => {});",
      "test('salva', () => { expect(1).toBe(2); });",
    ],
    fila: [
      "import { test, expect } from '@playwright/test';",
      "import { existsSync, writeFileSync } from 'node:fs';",
      "test.describe.configure({ mode: 'serial' });",
      `test('si apre', () => { ${passeggero} });`,
      "test('salva', () => { expect(1).toBe(2); });",
    ],
  };
  writeFileSync(join(dir, 'tests', 'b-altro.spec.mjs'), corpi[secondo].join('\n'));
  g('add', '-A'); g('commit', '-qm', 'spec');
  return { dir, g };
}

// Lo stesso lancio del controllo: spec a lotti, memoria dei verdi sulla punta della cartella.
function scriptLancio(dir) {
  const s = join(dir, 'lancia.mjs');
  writeFileSync(s, [
    `import { runSpecsALotti, memoriaSpecVerdi } from ${JSON.stringify(pathToFileURL(FINISH).href)};`,
    "import { execFileSync } from 'node:child_process';",
    `const dir = ${JSON.stringify(dir)};`,
    "const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();",
    `const ok = runSpecsALotti(['tests/a-verde', 'tests/b-altro'], 'prova', { dir, moduli: ${JSON.stringify(MODULI)} }, memoriaSpecVerdi(dir, sha));`,
    'process.stdout.write(`ESITO ${ok ? "verde" : "rosso"}\\n`);',
  ].join('\n'));
  return s;
}

async function verdiDopo(dir, g) {
  const { memoriaSpecVerdi } = await import(pathToFileURL(FINISH).href);
  return memoriaSpecVerdi(dir, g('rev-parse', 'HEAD')).verdi;
}

test('un lotto con un rosso tiene il suo verde, e il rilancio rifà solo il rosso', async () => {
  test.setTimeout(240_000);
  const { dir, g } = alberoConDueSpec('rosso');
  try {
    execFileSync(process.execPath, [scriptLancio(dir)], { cwd: dir, stdio: 'ignore', timeout: 150_000 });
    expect(existsSync(join(dir, 'a-fatto')), 'lo spec verde ha girato').toBe(true);
    expect([...(await verdiDopo(dir, g))]).toEqual(['tests/a-verde']);

    rmSync(join(dir, 'a-fatto'));
    execFileSync(process.execPath, [scriptLancio(dir)], { cwd: dir, stdio: 'ignore', timeout: 150_000 });
    expect(existsSync(join(dir, 'a-fatto')), 'il rilancio ha rifatto lo spec già verde').toBe(false);
    expect([...(await verdiDopo(dir, g))], 'il rosso non entra nella memoria').toEqual(['tests/a-verde']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un lotto ucciso a metà dal tetto del comando tiene gli spec già passati', async () => {
  test.setTimeout(240_000);
  const { dir, g } = alberoConDueSpec('lento');
  try {
    const figlio = spawn(process.execPath, [scriptLancio(dir)], { cwd: dir, stdio: 'ignore', detached: true, windowsHide: true });
    const scadenza = Date.now() + 150_000;
    while (!existsSync(join(dir, 'a-fatto')) && Date.now() < scadenza) await new Promise((r) => setTimeout(r, 500));
    expect(existsSync(join(dir, 'a-fatto')), 'lo spec verde ha girato').toBe(true);
    await new Promise((r) => setTimeout(r, 5_000));
    // Il tetto di un comando in sottofondo uccide tutto il gruppo, senza dargli il tempo di salvare.
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(figlio.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-figlio.pid, 'SIGKILL');
    } catch (_) { /* già uscito */ }
    expect([...(await verdiDopo(dir, g))]).toContain('tests/a-verde');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('un lancio rosso per un errore fuori dai test resta rosso anche al rilancio', async () => {
  test.setTimeout(240_000);
  const { dir, g } = alberoConDueSpec('chiusura');
  try {
    const lancio = () => execFileSync(process.execPath, [scriptLancio(dir)], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 150_000 });
    expect(lancio(), 'il primo lancio è rosso').toContain('ESITO rosso');
    expect([...(await verdiDopo(dir, g))], 'nessuno spec di un lancio rotto resta verde').toEqual([]);
    expect(lancio(), 'il rilancio sullo stesso contenuto resta rosso').toContain('ESITO rosso');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

for (const caso of ['preparazione', 'fila']) {
  test(`un test saltato per un errore prima di lui (${caso}) e poi rosso non fa saltare lo spec al rilancio`, async () => {
    test.setTimeout(240_000);
    const { dir, g } = alberoConDueSpec(caso);
    try {
      const lancio = () => execFileSync(process.execPath, [scriptLancio(dir)], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 150_000 });
      expect(lancio(), 'il primo lancio è rosso').toContain('ESITO rosso');
      expect([...(await verdiDopo(dir, g))], 'solo lo spec verde è nella memoria').toEqual(['tests/a-verde']);
      expect(lancio(), 'il rilancio rifà lo spec rosso e resta rosso').toContain('ESITO rosso');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
