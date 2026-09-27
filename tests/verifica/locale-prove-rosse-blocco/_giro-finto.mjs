// Un giro locale finto in un repo temporaneo: tre prove del giro (a, b, c), un server finto dei bilanci,
// e verify-local.mjs del ramo lanciato su quel repo. Serve alle prove giro1-* di questa cartella.

import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella } from '../../helpers/percorsi.mjs';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const VERIFY = join(REPO, 'scripts', 'verify-local.mjs');

export const CRITICA = [
  'Provato il demo con tre prove del giro, una per rilievo, tutte rosse sul codice di partenza del giro.',
  '[2i] il rilievo a non è chiuso: la prova a è rossa',
  '[1i?] il rilievo b chiede una scelta: la prova b è rossa',
  '[2i] il rilievo c non è chiuso: la prova c è rossa',
].join('\n');
export const REPORT = 'Correzione del giro finto: sistemato il codice della demo e consegnato per la verifica successiva.';

function spec(lettera) {
  return [
    "import { test, expect } from '@playwright/test';",
    "import { readFileSync } from 'node:fs';",
    `test('rilievo ${lettera} chiuso', () => {`,
    `  expect(readFileSync('demo/stato.txt', 'utf8')).toContain('${lettera}-corretto');`,
    '});',
    '',
  ].join('\n');
}

export async function giroFinto() {
  const dir = cartellaTemporanea('giro-finto-');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'prova');
  git('config', 'user.email', 'prova@example.invalid');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n.claude/\ntest-results/\n');
  mkdirSync(join(dir, 'demo'));
  writeFileSync(join(dir, 'demo', 'stato.txt'), 'bug\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'claude/demo');
  const cartella = join(dir, 'tests', 'verifica', 'locale-demo');
  mkdirSync(cartella, { recursive: true });
  for (const l of ['a', 'b', 'c']) writeFileSync(join(cartella, `giro1-${l}.spec.mjs`), spec(l));
  git('add', '-A');
  git('commit', '-qm', 'prove del giro');
  collegaCartella(join(REPO, 'node_modules'), join(dir, 'node_modules'));

  const server = http.createServer((_req, res) => {
    const fields = {};
    for (const [k, v] of Object.entries({ cap3: 3, cap2: 3, cap1: 3, cap0: 0 })) fields[k] = { integerValue: String(v) };
    fields.fixInstructions = { stringValue: 'Istruzioni finte: correggi e consegna.' };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ fields }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = {
    ...process.env,
    FILO_REPO_ROOT: dir,
    FILO_ROUTINE_CONFIG_URL: `http://127.0.0.1:${server.address().port}/config`,
    FILO_ADMIN_ID_TOKEN: 'finto',
  };
  const verify = (...args) => new Promise((r) => {
    execFile(process.execPath, [VERIFY, ...args], { cwd: dir, env, encoding: 'utf8', maxBuffer: 1 << 26 },
      (err, stdout, stderr) => r({ code: err ? (err.code ?? 1) : 0, out: `${stdout}\n${stderr}` }));
  });
  const scrivi = (testo) => writeFileSync(join(dir, 'demo', 'stato.txt'), `${testo}\n`);
  const togli = (...lettere) => git('rm', '-q', ...lettere.map((l) => `tests/verifica/locale-demo/giro1-${l}.spec.mjs`));
  const commit = (msg) => { git('add', '-A'); git('commit', '-qm', msg); };
  const chiudi = () => { server.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, verify, scrivi, togli, commit, chiudi };
}
