// #860 giro 1 — una riga fusa su main quando la sua versione è già uscita non la vede chi aggiorna, e nessun test lo dice.
// Si rifà la storia vera in una copia del repo: rilasci col solo package.json, ramo verificato prima di un'uscita e
// fuso dopo. Passa se la guardia diventa rossa su main dopo la fusione, oppure se il riepilogo mostra la riga.

import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const prossima = (v) => { const [a, b, c] = v.split('.').map(Number); return `${a}.${b}.${c + 1}`; };

function copia() {
  const dir = join(cartellaTemporanea('filo-860-'), 'repo');
  git(ROOT, 'clone', '--quiet', '--no-checkout', ROOT, dir);
  git(dir, 'checkout', '--quiet', '--detach', git(ROOT, 'rev-parse', 'HEAD'));
  git(dir, 'config', 'user.email', 'v@v');
  git(dir, 'config', 'user.name', 'verifica');
  return dir;
}
const versione = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version;
function rilascia(dir, v) {
  const f = join(dir, 'package.json');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/("version"\s*:\s*")[^"]*(")/, `$1${v}$2`));
  git(dir, 'commit', '--quiet', '-am', `rilascio ${v}`);
  return git(dir, 'rev-parse', 'HEAD');
}
function apriBlocco(dir, v, riga) {
  const f = join(dir, 'src', 'shared', 'patchNotes.js');
  writeFileSync(f, readFileSync(f, 'utf8').replace('const NOTES = [',
    `const NOTES = [\n    { version: '${v}', date: '2026-10-01', features: [${JSON.stringify(riga)}], fixes: [] },`));
  git(dir, 'commit', '--quiet', '-am', `blocco ${v}`);
}
function aggiungiInCima(dir, riga) {
  const f = join(dir, 'src', 'shared', 'patchNotes.js');
  const s = readFileSync(f, 'utf8');
  const i = s.indexOf('features: [', s.indexOf("version: '", s.indexOf('const NOTES = ['))) + 'features: ['.length;
  writeFileSync(f, s.slice(0, i) + `\n        ${JSON.stringify(riga)},` + s.slice(i));
  git(dir, 'commit', '--quiet', '-am', 'riga nel blocco in cima');
}
// Il registro (dati e funzioni) di un commit: è quello che gira nella build di quella versione.
function registro(dir, ref) {
  const sb = {};
  vm.runInNewContext(git(dir, 'show', `${ref}:src/shared/patchNotes.js`), sb);
  return sb.SN_PATCH_NOTES;
}
// Il gesto del cancello: fonde il ramo su main senza rifare le prove sul risultato.
function fondi(dir, ramo) {
  git(dir, 'merge', '--quiet', '--no-edit', ramo);
  const m = git(dir, 'rev-parse', 'HEAD');
  git(dir, 'update-ref', 'refs/remotes/origin/main', m);
  return m;
}
const guardiaRossa = (dir) => spawnSync(process.execPath, ['--test', 'tests/unit/patchNotes.test.mjs'],
  { cwd: dir, encoding: 'utf8' }).status !== 0;
const righe = (notes) => notes.flatMap((n) => [...(n.features || []), ...(n.fixes || [])]);

test('il ramo che apre il blocco nuovo, fuso dopo che quella versione è uscita', () => {
  const dir = copia();
  try {
    const v0 = versione(dir), v1 = prossima(v0), v2 = prossima(v1), v3 = prossima(v2);
    const r1 = rilascia(dir, v1);
    git(dir, 'update-ref', 'refs/remotes/origin/main', r1);
    apriBlocco(dir, v2, 'RIGA DEL RAMO VERIFICATO PRIMA');
    const ramo = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '--quiet', '--detach', r1);
    const r2 = rilascia(dir, v2);
    git(dir, 'update-ref', 'refs/remotes/origin/main', r2);
    const foto = registro(dir, r2).fotografia(v2);
    fondi(dir, ramo);
    if (guardiaRossa(dir)) return;
    apriBlocco(dir, v3, 'scritta dopo');
    const visti = righe(registro(dir, 'HEAD').recap(v2, v3, foto));
    expect(visti, `chi aveva la ${v2} passa alla ${v3}`).toContain('RIGA DEL RAMO VERIFICATO PRIMA');
  } finally { rmSync(resolve(dir, '..'), { recursive: true, force: true }); }
});

test('la riga del blocco in cima, fusa dopo due uscite', () => {
  const dir = copia();
  try {
    const v0 = versione(dir), v1 = prossima(v0), v2 = prossima(v1), v3 = prossima(v2);
    const base = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'update-ref', 'refs/remotes/origin/main', base);
    aggiungiInCima(dir, 'RIGA DEL RAMO RIMASTO INDIETRO');
    const ramo = git(dir, 'rev-parse', 'HEAD');
    git(dir, 'checkout', '--quiet', '--detach', base);
    rilascia(dir, v1);
    apriBlocco(dir, v2, `della ${v2}`);
    const r2 = rilascia(dir, v2);
    git(dir, 'update-ref', 'refs/remotes/origin/main', r2);
    const foto = registro(dir, r2).fotografia(v2);
    fondi(dir, ramo);
    if (guardiaRossa(dir)) return;
    apriBlocco(dir, v3, 'scritta dopo');
    const visti = righe(registro(dir, 'HEAD').recap(v2, v3, foto));
    expect(visti, `chi aveva la ${v2} passa alla ${v3}`).toContain('RIGA DEL RAMO RIMASTO INDIETRO');
  } finally { rmSync(resolve(dir, '..'), { recursive: true, force: true }); }
});
