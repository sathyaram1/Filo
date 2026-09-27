// Una copia del ramo in una cartella temporanea, con un server finto dei bilanci e un'origine che non esiste:
// ci gira verify-local come in un giro locale vero, e niente arriva al repo vero. Serve alle prove giro3-*.

import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea, collegaCartella } from '../../helpers/percorsi.mjs';

const RADICE = fileURLToPath(new URL('../../../', import.meta.url));
const CAMPI = {
  cap3: { integerValue: '2' }, cap2: { integerValue: '2' }, cap1: { integerValue: '2' }, cap0: { integerValue: '1' },
  fixInstructions: { stringValue: 'Correggi i rilievi e consegna con node scripts/verify-local.mjs corretto "<report>".' },
};
export const RIASSUNTO = 'Provato il giro finto con le prove del giro rosse sul codice di partenza, riassunto abbastanza lungo.';
export const REPORT = 'Corretto il rilievo a, dice chi corregge: report abbastanza lungo da superare il minimo della consegna.';

export async function copia() {
  const server = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ fields: CAMPI }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/config`;
  const base = cartellaTemporanea('giro3-');
  const dir = join(base, 'repo');
  const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: RADICE, encoding: 'utf8' }).trim();
  execFileSync('git', ['clone', '-q', '--shared', '--no-checkout', RADICE, dir], { stdio: 'ignore' });
  git('checkout', '-q', '-f', sha);
  git('remote', 'set-url', 'origin', join(base, 'nessuna-origine'));
  git('config', 'user.email', 'verifica@example.invalid');
  git('config', 'user.name', 'verifica');
  collegaCartella(resolve(RADICE, 'node_modules'), join(dir, 'node_modules'));

  // Asincrono: il server finto vive in questo processo.
  const vl = (...args) => new Promise((ok) => {
    const env = { ...process.env, FILO_ROUTINE_CONFIG_URL: url, FILO_ADMIN_ID_TOKEN: 'finto', FILO_NO_BEAT: '1', FILO_REPO_ROOT: dir };
    delete env.FILO_ADMIN_REFRESH_TOKEN;
    const p = spawn(process.execPath, ['scripts/verify-local.mjs', ...args], { cwd: dir, env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (status) => ok({ status, out }));
  });
  const scrivi = (p, t) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), t); };
  const leggi = (p) => readFileSync(join(dir, p), 'utf8');
  const commit = (m) => { git('add', '-A'); git('commit', '-q', '-m', m); };

  // Un ramo nuovo per ogni scenario, dal commit del ramo vero: il lavoro (i file stato-*) nasce prima di start,
  // le prove del giro dopo, come in una verifica vera.
  let n = 0;
  const ramo = async (nome, lettere) => {
    git('checkout', '-q', '-f', sha);
    n += 1;
    const b = `${nome}-${n}`;
    git('checkout', '-q', '-b', `claude/${b}`);
    for (const k of lettere) scrivi(`stato-${k}.txt`, 'rotto\n');
    commit('lavoro');
    const s = await vl('start', 'richiesta finta per provare il giro');
    if (s.status !== 0) throw new Error(`start non è partito:\n${s.out}`);
    return `tests/verifica/locale-${b}`;
  };
  const prova = (cartella, file, casi) => {
    const righe = ["import { test, expect } from '@playwright/test';", "import { readFileSync } from 'node:fs';"];
    for (const k of casi) {
      righe.push(`test('rilievo ${k} chiuso', () => {`, `  expect(readFileSync('stato-${k}.txt', 'utf8')).toContain('corretto');`, '});');
    }
    scrivi(`${cartella}/${file}`, `${righe.join('\n')}\n`);
  };

  // Prima il collegamento, mai il suo contenuto: node_modules è quello del repo vero.
  const chiudi = () => {
    server.close();
    const nm = join(dir, 'node_modules');
    try { unlinkSync(nm); } catch (_) { try { rmdirSync(nm); } catch (_) { /* resta: non si cancella niente */ } }
    if (!existsSync(nm)) rmSync(base, { recursive: true, force: true });
  };
  return { dir, git, vl, scrivi, leggi, commit, ramo, prova, chiudi };
}
