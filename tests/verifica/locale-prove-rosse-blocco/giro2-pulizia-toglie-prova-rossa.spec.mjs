// Verifica locale, giro 2 (ramo claude/prove-rosse-blocco): la pulizia non fa uscire la prova ancora rossa di un
// rilievo da correggere, nemmeno quando i rilievi messi da parte sono più delle loro prove (una domanda, un esterno).
// Gira su una copia del ramo con un server finto dei bilanci e un'origine irraggiungibile: niente arriva al repo vero.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella } from '../../helpers/percorsi.mjs';

const RADICE = fileURLToPath(new URL('../../../', import.meta.url));
const RAMO = 'claude/prova-pulizia';
const CARTELLA = 'tests/verifica/locale-prova-pulizia';
const CAMPI = {
  cap3: { integerValue: '2' }, cap2: { integerValue: '2' }, cap1: { integerValue: '1' }, cap0: { integerValue: '0' },
  fixInstructions: { stringValue: 'Correggi i rilievi e consegna con node scripts/verify-local.mjs corretto "<report>".' },
};

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

let server;
let url = '';
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ fields: CAMPI }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/config`;
});
test.afterAll(() => { if (server) server.close(); });

function copia(prove) {
  const base = cartellaTemporanea('pulizia-giro2-');
  const dir = join(base, 'repo');
  const sha = git(['rev-parse', 'HEAD'], RADICE);
  execFileSync('git', ['clone', '-q', '--shared', '--no-checkout', RADICE, dir], { stdio: 'ignore' });
  git(['checkout', '-q', '-b', RAMO, sha], dir);
  git(['remote', 'set-url', 'origin', join(base, 'nessuna-origine')], dir);
  git(['config', 'user.email', 'verifica@example.invalid'], dir);
  git(['config', 'user.name', 'verifica'], dir);
  collegaCartella(resolve(RADICE, 'node_modules'), join(dir, 'node_modules'));
  mkdirSync(join(dir, CARTELLA), { recursive: true });
  for (const k of prove) {
    writeFileSync(join(dir, CARTELLA, `giro1-${k}.spec.mjs`), [
      "import { test, expect } from '@playwright/test';",
      "import { readFileSync } from 'node:fs';",
      `test('rilievo ${k} chiuso', () => {`,
      `  expect(readFileSync('stato-${k}.txt', 'utf8')).toContain('corretto');`,
      '});',
      '',
    ].join('\n'));
    writeFileSync(join(dir, `stato-${k}.txt`), 'rotto\n');
  }
  git(['add', '-A'], dir);
  git(['commit', '-q', '-m', 'prove del giro 1'], dir);
  return { base, dir };
}

// Prima il collegamento, mai il suo contenuto: node_modules è quello del repo vero.
function butta({ base, dir }) {
  const nm = join(dir, 'node_modules');
  try { unlinkSync(nm); } catch (_) { try { rmdirSync(nm); } catch (_) { /* resta: non si cancella niente */ } }
  if (!existsSync(nm)) rmSync(base, { recursive: true, force: true });
}

function vl(dir, ...args) {
  const env = { ...process.env, FILO_ROUTINE_CONFIG_URL: url, FILO_ADMIN_ID_TOKEN: 'finto', FILO_NO_BEAT: '1', FILO_REPO_ROOT: dir };
  delete env.FILO_ADMIN_REFRESH_TOKEN;
  const r = spawnSync(process.execPath, ['scripts/verify-local.mjs', ...args], { cwd: dir, env, encoding: 'utf8' });
  return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
}

async function giro({ prove, critica, tolteNellaPulizia }) {
  const c = copia(prove);
  try {
    expect(vl(c.dir, 'start', 'richiesta di prova per la pulizia').status).toBe(0);
    const crit = vl(c.dir, 'critica', critica);
    expect(crit.out).toContain('ESITO: c\'è da correggere');
    for (const k of tolteNellaPulizia) git(['rm', '-q', `${CARTELLA}/giro1-${k}.spec.mjs`], c.dir);
    git(['commit', '-q', '-m', 'pulizia del giro'], c.dir);
    const pulizia = vl(c.dir, 'pulizia');
    writeFileSync(join(c.dir, 'stato-a.txt'), 'corretto\n');
    git(['commit', '-q', '-a', '-m', 'correggo solo a'], c.dir);
    const consegna = vl(c.dir, 'corretto', 'Corretti i rilievi a e c, report abbastanza lungo da superare il minimo della consegna.');
    return { pulizia, consegna };
  } finally {
    butta(c);
  }
}

// Il rilievo c resta rotto: la sua prova non può uscire senza che qualcuno lo sappia. O la pulizia la respinge, o la
// consegna si ferma; se passano tutte e due, c è aperto e il giro va avanti come se fosse chiuso.
test('una domanda per l\'owner senza prova sua non lascia uscire la prova rossa di un rilievo da correggere', async () => {
  test.setTimeout(240_000);
  const { pulizia, consegna } = await giro({
    prove: ['a', 'c'],
    critica: [
      'Provato il giro con due rilievi da correggere e una domanda di gusto, riassunto lungo abbastanza per il minimo.',
      '[2i] rilievo a: la cosa a non funziona.',
      '[1i?] rilievo b: il bordo è grigio, caldo come il resto? Scelta di gusto.',
      '[1i] rilievo c: la cosa c non funziona.',
    ].join('\n'),
    tolteNellaPulizia: ['c'],
  });
  expect(pulizia.status === 0 && consegna.status === 0, `${pulizia.out}\n---\n${consegna.out}`).toBe(false);
});

test('un rilievo esterno non allarga la pulizia fino alla prova rossa di un rilievo da correggere', async () => {
  test.setTimeout(240_000);
  const { pulizia, consegna } = await giro({
    prove: ['a', 'b', 'c'],
    critica: [
      'Provato il giro con due rilievi da correggere, uno da decidere e un esterno, riassunto lungo abbastanza.',
      '[2i] rilievo a: la cosa a non funziona.',
      '[1i?] rilievo b: scelta di gusto sulla cosa b.',
      '[1i] rilievo c: la cosa c non funziona.',
      '[1e] rilievo x: un difetto di un altro lavoro.',
    ].join('\n'),
    tolteNellaPulizia: ['b', 'c'],
  });
  expect(pulizia.status === 0 && consegna.status === 0, `${pulizia.out}\n---\n${consegna.out}`).toBe(false);
});
