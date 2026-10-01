// Pubblica le regole di Firestore e i loro indici solo da main uguale a origin/main, coi file delle regole intatti.
// È l'unica strada: un ramo o una modifica locale pubblicati sarebbero regole che nessuno ha fuso. Decisioni pure:
// tests/unit/regolePubblica.test.mjs. Uso: npm run regole:pubblica [-- --dry-run]

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Gli indici vanno con le regole che li usano: una query senza il suo indice smette di rispondere in silenzio.
export const BERSAGLI = Object.freeze(['firestore:rules', 'firestore:indexes']);
const OPZIONI = ['--dry-run'];

/** I file che i BERSAGLI pubblicano, letti da firebase.json. PURA. */
export function fileDaPubblicare(firebaseJson) {
  const fs = (firebaseJson && firebaseJson.firestore) || {};
  return [fs.rules, fs.indexes].filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim());
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
  if (!s.file || s.file.length < BERSAGLI.length) return { ok: false, motivo: 'firebase.json non nomina i file delle regole e degli indici di Firestore' };
  if (!s.progetto) return { ok: false, motivo: '.firebaserc non dice su quale progetto pubblicare' };
  if (s.ramo !== 'main') return { ok: false, motivo: `il checkout è su «${s.ramo || 'testa staccata'}», non su main: si pubblica solo ciò che è stato fuso` };
  if (!s.origine) return { ok: false, motivo: 'origin/main non si legge' };
  if (s.testa !== s.origine) {
    return { ok: false, motivo: `main locale (${corto(s.testa)}) non è origin/main (${corto(s.origine)}): allinealo (git pull --ff-only) o porta prima il lavoro su main` };
  }
  if (s.toccati && s.toccati.length) return { ok: false, motivo: `file delle regole modificati e non fusi: ${s.toccati.join(', ')}` };
  return { ok: true };
}

/** Il comando di pubblicazione. PURA. */
export function passo({ radice, progetto }) {
  return { cmd: 'firebase', args: ['deploy', '--only', BERSAGLI.join(','), '--project', progetto], cwd: radice };
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

async function main(argv) {
  const { controllaArgomenti, argomentiDaNpm, opzioneStorpiata } = await import('./lib/argomenti.mjs');
  const storpiata = opzioneStorpiata(process.env, OPZIONI);
  if (storpiata) { console.error(`RIFIUTATO: ${storpiata}`); return 1; }
  // npm si mangia `--dry-run` (su PowerShell anche dopo i due trattini): lo si riprende dall'ambiente.
  const daNpm = argomentiDaNpm(process.env, { opzioni: OPZIONI });
  if (daNpm.nota) console.error(daNpm.nota);
  const args = [...argv, ...daNpm.args];
  const male = controllaArgomenti(args, { opzioni: OPZIONI, senzaParoleLibere: true });
  if (male) { console.error(`RIFIUTATO: ${male}`); return 1; }
  const dryRun = args.includes('--dry-run');

  const s = stato();
  const d = decidi(s);
  if (!d.ok) { console.error(`RIFIUTATO: ${d.motivo}.`); return 3; }
  const p = passo({ radice: ROOT, progetto: s.progetto });
  console.log(`main = origin/main (${s.testa.slice(0, 9)}), ${s.file.join(' e ')} intatti.`);
  console.log(`  in ${p.cwd}\n  $ ${p.cmd} ${p.args.join(' ')}`);
  if (dryRun) { console.log('(prova a vuoto: non ho pubblicato niente)'); return 0; }
  // Su Windows firebase è un .cmd, che Node lancia solo attraverso la shell; gli argomenti non hanno spazi.
  const r = spawnSync(p.cmd, p.args, { cwd: p.cwd, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true });
  const codice = r.error ? 127 : (r.status ?? 1);
  if (codice !== 0) console.error(`firebase deploy è uscito con ${codice}: le regole in produzione potrebbero essere quelle di prima.`);
  return codice;
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(await main(process.argv.slice(2)));
}
