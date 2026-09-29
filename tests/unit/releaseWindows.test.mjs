// La metà Windows di release.yml: la bozza si pubblica solo se installer e manifesto di aggiornamento ci sono.
// Il passo di controllo si ESEGUE qui, con un `gh` finto: electron-builder può finire verde
// senza aver caricato niente, e allora la versione uscirebbe senza il programma per Windows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cartellaTemporanea } from '../helpers/percorsi.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const YML = readFileSync(join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function jobWindows() {
  const inizio = YML.search(/^\s{2}release:\s*$/m);
  assert.ok(inizio >= 0, 'nel workflow manca il job `release`');
  const resto = YML.slice(inizio + 1);
  const fine = resto.search(/^\s{2}[a-z][\w-]*:\s*$/m);
  return fine >= 0 ? YML.slice(inizio, inizio + 1 + fine) : YML.slice(inizio);
}

const NOME_CONTROLLO = /-\s+name:\s*I file per Windows sono davvero nella bozza\?/;

function scriptDelControllo() {
  const job = jobWindows();
  const at = job.search(NOME_CONTROLLO);
  assert.ok(at >= 0, 'manca il controllo della bozza: un caricamento a vuoto uscirebbe verde, senza il programma per Windows');
  const passo = job.slice(at).split(/\n\s{6}-\s+name:/)[0];
  const righe = passo.split('\n');
  const i = righe.findIndex((r) => /^\s*run:\s*\|\s*$/.test(r));
  assert.ok(i >= 0, 'il controllo della bozza non ha un blocco `run: |`');
  const corpo = [];
  for (const r of righe.slice(i + 1)) {
    if (r.trim() && !r.startsWith(' '.repeat(10))) break;
    corpo.push(r.slice(10));
  }
  return corpo.join('\n');
}

const haBash = spawnSync('bash', ['-c', 'true']).status === 0;

/** Esegue il passo con un `gh` finto che elenca `allegati`; restituisce esito e riepilogo. */
function eseguiControllo(allegati, { crlf = false, ghFallisce = false } = {}) {
  const dir = cartellaTemporanea('filo-release-win-');
  try {
    const elenco = join(dir, 'elenco.txt');
    writeFileSync(elenco, allegati.map((a) => a + (crlf ? '\r\n' : '\n')).join(''));
    const gh = join(dir, 'gh');
    writeFileSync(gh, ghFallisce
      ? '#!/usr/bin/env bash\necho "release not found" >&2\nexit 1\n'
      : `#!/usr/bin/env bash\necho "$@" > "${join(dir, 'argomenti.txt')}"\ncat "${elenco}"\n`);
    chmodSync(gh, 0o755);
    const riepilogo = join(dir, 'riepilogo.md');
    writeFileSync(riepilogo, '');
    const script = scriptDelControllo()
      .replace(/\$\{\{\s*steps\.bump\.outputs\.version\s*\}\}/g, 'v9.9.9')
      .replace(/\$\{\{\s*github\.repository\s*\}\}/g, 'proprietario/Filo');
    assert.doesNotMatch(script, /\$\{\{/, 'il controllo usa un\'espressione che il test non sa sostituire');
    const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
      encoding: 'utf8',
      env: { ...process.env, PATH: dir + delimiter + process.env.PATH, GITHUB_STEP_SUMMARY: riepilogo },
    });
    let argomenti = '';
    try { argomenti = readFileSync(join(dir, 'argomenti.txt'), 'utf8'); } catch {}
    return { status: r.status, out: r.stdout + r.stderr, riepilogo: readFileSync(riepilogo, 'utf8'), argomenti };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TUTTI = ['Filo-Setup.exe', 'Filo-Setup.exe.blockmap', 'latest.yml'];

test('il controllo sta fra il caricamento e la pubblicazione, e gira solo quando si pubblica', () => {
  const job = jobWindows();
  const carica = job.search(/run:\s*npm run release\s*$/m);
  const controllo = job.search(NOME_CONTROLLO);
  const pubblica = job.search(/gh release edit[^\n]*--draft=false/);
  assert.ok(carica >= 0 && pubblica >= 0, 'caricamento o pubblicazione spariti dal job Windows');
  assert.ok(carica < controllo && controllo < pubblica,
    'il controllo deve stare DOPO il caricamento e PRIMA che la bozza diventi pubblica');
  const passo = job.slice(controllo).split(/\n\s{6}-\s+name:/)[0];
  assert.match(passo, /if:\s*steps\.check\.outputs\.should_release == 'true'/);
});

test('i nomi controllati sono quelli che la costruzione produce', () => {
  assert.equal(pkg.build.win.artifactName.replace('${ext}', 'exe'), 'Filo-Setup.exe',
    'il nome dell\'installer è cambiato: il controllo della bozza e il collegamento del sito cercano Filo-Setup.exe');
});

test('bozza completa: il controllo passa e chiede la bozza giusta', { skip: !haBash && 'serve bash' }, () => {
  const r = eseguiControllo(TUTTI);
  assert.equal(r.status, 0, r.out);
  assert.match(r.argomenti, /release view v9\.9\.9 --repo proprietario\/Filo/);
});

for (const manca of ['Filo-Setup.exe', 'latest.yml']) {
  test(`senza ${manca} la bozza non si pubblica, e il riepilogo lo dice`, { skip: !haBash && 'serve bash' }, () => {
    const r = eseguiControllo(TUTTI.filter((a) => a !== manca));
    assert.notEqual(r.status, 0, `senza ${manca} il controllo è passato: la versione uscirebbe monca`);
    assert.match(r.out, new RegExp(`::error::manca ${manca.replace('.', '\\.')}`));
    assert.match(r.riepilogo, new RegExp(`manca ${manca.replace('.', '\\.')}`));
  });
}

test('bozza vuota o introvabile: rosso', { skip: !haBash && 'serve bash' }, () => {
  assert.notEqual(eseguiControllo([]).status, 0);
  assert.notEqual(eseguiControllo(TUTTI, { ghFallisce: true }).status, 0);
});

test('un nome solo simile non conta come l\'installer', { skip: !haBash && 'serve bash' }, () => {
  assert.notEqual(eseguiControllo(['Filo-Setup.exe.blockmap', 'latest.yml']).status, 0);
});

test('righe con \\r in coda (gh su Windows) non bloccano una bozza completa', { skip: !haBash && 'serve bash' }, () => {
  const r = eseguiControllo(TUTTI, { crlf: true });
  assert.equal(r.status, 0, r.out);
});
