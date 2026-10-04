// Pubblica regole e indici di Firestore, regole di Storage e la pagina delle approvazioni da browser solo da main
// uguale a origin/main, coi file intatti. È l'unica strada: firebase.json la richiama (--controlla) a ogni deploy.
// Decisioni: tests/unit/regolePubblica.test.mjs. Uso: npm run regole:pubblica [-- --dry-run]

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Gli indici vanno con le regole che li usano: una query senza il suo indice smette di rispondere in silenzio.
// La pagina delle approvazioni (#489) è la via d'uscita quando Filo non parte: pubblica solo ciò che è stato fuso.
export const BERSAGLI = Object.freeze(['firestore:rules', 'firestore:indexes', 'storage', 'hosting']);
const OPZIONI = ['--dry-run', '--controlla'];
// Il deploy lanciato da qui lo porta: il predeploy di firebase.json senza di esso è un firebase deploy a mano.
export const SEGNO_GUARDIA = 'FILO_REGOLE_DALLA_GUARDIA';

/** I file che i BERSAGLI pubblicano, letti da firebase.json. PURA. */
export function fileDaPubblicare(firebaseJson) {
  const fs = (firebaseJson && firebaseJson.firestore) || {};
  const st = firebaseJson && firebaseJson.storage;
  const storage = (Array.isArray(st) ? st : [st]).map((x) => x && x.rules);
  const ho = firebaseJson && firebaseJson.hosting;
  const pagine = (Array.isArray(ho) ? ho : [ho]).map((x) => x && x.public);
  return [fs.rules, fs.indexes, ...storage, ...pagine].filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim());
}

/** Il progetto di default di .firebaserc, '' se manca. PURA. */
export function progettoDi(firebaserc) {
  const p = firebaserc && firebaserc.projects && firebaserc.projects.default;
  return typeof p === 'string' ? p.trim() : '';
}

/** `git status --porcelain=v1 -z` sui file pubblicati → quelli toccati (anche solo in stage). PURA. */
export function fileToccati(statusZ) {
  return String(statusZ || '').split('\0').filter((r) => r.length > 3).map((r) => r.slice(3));
}

/**
 * Si pubblica? PURA. Ogni no porta il motivo da stampare.
 * @param {{ errore?: string, ramo: string, testa: string, origine: string, file: string[], progetto: string, toccati: string[] }} s
 */
export function decidi(s) {
  const corto = (sha) => String(sha || '?').slice(0, 9);
  if (s.errore) return { ok: false, motivo: s.errore };
  if (!s.file || s.file.length < BERSAGLI.length) return { ok: false, motivo: 'firebase.json non nomina i file di regole e indici di Firestore, delle regole di Storage e la cartella della pagina delle approvazioni' };
  if (!s.progetto) return { ok: false, motivo: '.firebaserc non dice su quale progetto pubblicare' };
  if (s.ramo !== 'main') return { ok: false, motivo: `il checkout è su «${s.ramo || 'testa staccata'}», non su main: si pubblica solo ciò che è stato fuso` };
  if (!s.origine) return { ok: false, motivo: 'origin/main non si legge' };
  if (s.testa !== s.origine) {
    return { ok: false, motivo: `main locale (${corto(s.testa)}) non è origin/main (${corto(s.origine)}): allinealo (git pull --ff-only) o porta prima il lavoro su main` };
  }
  if (s.toccati && s.toccati.length) return { ok: false, motivo: `file da pubblicare modificati e non fusi: ${s.toccati.join(', ')}` };
  return { ok: true };
}

/** Il comando di pubblicazione. PURA. */
export function passo({ radice, progetto }) {
  return { cmd: 'firebase', args: ['deploy', '--only', BERSAGLI.join(','), '--project', progetto], cwd: radice, env: { [SEGNO_GUARDIA]: '1' } };
}

function git(args) {
  // Il repo lo decide la cartella: un GIT_DIR ereditato da un hook manderebbe ogni comando su un altro repo.
  const env = { ...process.env };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  const r = spawnSync('git', args, { cwd: ROOT, env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return { codice: r.error ? 127 : r.status, out: r.stdout || '', err: (r.stderr || String(r.error || '')).trim() };
}

const leggiJson = (nome) => { try { return JSON.parse(readFileSync(resolve(ROOT, nome), 'utf8')); } catch (_) { return null; } };

function stato() {
  const file = fileDaPubblicare(leggiJson('firebase.json'));
  const progetto = progettoDi(leggiJson('.firebaserc'));
  const f = git(['fetch', '--quiet', 'origin', 'main']);
  if (f.codice !== 0) return { errore: `non riesco ad aggiornare origin/main (${f.err.split('\n')[0] || f.codice}): senza, non so se main è quello fuso`, file, progetto };
  const ramo = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const testa = git(['rev-parse', 'HEAD']);
  const origine = git(['rev-parse', '--verify', '--quiet', 'origin/main^{commit}']);
  const st = file.length ? git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...file]) : { codice: 0, out: '' };
  if (ramo.codice !== 0 || testa.codice !== 0 || st.codice !== 0) return { errore: `git non risponde: ${ramo.err || testa.err || st.err}`, file, progetto };
  return {
    ramo: ramo.out.trim() === 'HEAD' ? '' : ramo.out.trim(), testa: testa.out.trim(), origine: origine.codice === 0 ? origine.out.trim() : '',
    file, progetto, toccati: fileToccati(st.out),
  };
}

function lancia(p) {
  // Su Windows firebase è un .cmd, che Node lancia solo attraverso la shell; gli argomenti non hanno spazi.
  const r = spawnSync(p.cmd, p.args, { cwd: p.cwd, env: { ...process.env, ...p.env }, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
  return r.error ? 127 : (r.status ?? 1);
}

/** `--controlla` è il predeploy di firebase.json: decide e esce, 3 al rifiuto, che ferma il deploy. */
export async function main(argv, { leggiStato = stato, esegui = lancia, env = process.env, log = console.log, err = console.error } = {}) {
  const { controllaArgomenti, argomentiDaNpm, opzioneStorpiata } = await import('./lib/argomenti.mjs');
  const storpiata = opzioneStorpiata(env, OPZIONI);
  if (storpiata) { err(`RIFIUTATO: ${storpiata}`); return 1; }
  // npm si mangia `--dry-run` (su PowerShell anche dopo i due trattini): lo si riprende dall'ambiente.
  const daNpm = argomentiDaNpm(env, { opzioni: OPZIONI });
  if (daNpm.nota) err(daNpm.nota);
  const args = [...argv, ...daNpm.args];
  const male = controllaArgomenti(args, { opzioni: OPZIONI, senzaParoleLibere: true });
  if (male) { err(`RIFIUTATO: ${male}`); return 1; }
  const controlla = args.includes('--controlla');
  const dryRun = args.includes('--dry-run');
  if (controlla && env[SEGNO_GUARDIA] !== '1') {
    err('RIFIUTATO: firebase deploy lanciato a mano. Si pubblica con npm run regole:pubblica, da main allineato a origin/main: regole e indici di Firestore, regole di Storage e pagina delle approvazioni insieme.');
    return 3;
  }

  const s = leggiStato();
  const d = decidi(s);
  if (!d.ok) { err(`RIFIUTATO: ${d.motivo}.`); return 3; }
  if (controlla) { log(`Guardia della pubblicazione: main = origin/main (${s.testa.slice(0, 9)}), file intatti.`); return 0; }
  const p = passo({ radice: ROOT, progetto: s.progetto });
  log(`main = origin/main (${s.testa.slice(0, 9)}), ${s.file.join(', ')} intatti.`);
  log(`  in ${p.cwd}\n  $ ${p.cmd} ${p.args.join(' ')}`);
  if (dryRun) { log('(prova a vuoto: non ho pubblicato niente)'); return 0; }
  const codice = esegui(p);
  if (codice !== 0) err(`firebase deploy è uscito con ${codice}: regole e pagina in produzione potrebbero essere quelle di prima.`);
  return codice;
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(await main(process.argv.slice(2)));
}
