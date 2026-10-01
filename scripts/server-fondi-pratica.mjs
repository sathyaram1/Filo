// Il lavoro locale sul server con la sua pratica (#908): la controlla come start --feedback, la prende in carico,
// lancia server:fondi di filo-security (che senza pratica si rifiuta) e a fusione riuscita la chiude, se l'app non ha
// un ramo aperto sulla stessa pratica. Regole: tests/unit/serverFondiPratica.test.mjs. Uso: npm run server:fondi -- claude/<ramo> --feedback <N>

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { estraiOpzioneFeedback, risolviFeedback } from './lib/pratica-locale.mjs';
import { argomentiDaNpm } from './lib/argomenti.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Lo legge server:fondi di filo-security: senza, si rifiuta e rimanda qui.
export const PRATICA_ENV = 'FILO_SERVER_PRATICA';
const USO = 'Uso, dal repo Filo: npm run server:fondi -- claude/<ramo> --feedback <N> [--dry-run]';

export const SENZA_PRATICA = [
  'Questo lavoro sul server non ha la sua pratica, e ogni lavoro locale ne ha una: in Gestione è il registro di cosa fa ogni sessione.',
  'Aprila, se non c’è ancora, e rilancia col suo numero:',
  '  npm run feedback:apri -- "<titolo>" "<cosa fa il lavoro>" --locale',
  '  npm run server:fondi -- <ramo> --feedback <N>',
  'Non ho toccato niente.',
].join('\n');

/** La cartella functions del checkout del server accanto al repo Filo, anche da una sua worktree; '' se non c'è. */
export function cartellaDelServer(radice, esiste = existsSync) {
  let d = resolve(radice);
  for (let i = 0; i < 8; i += 1) {
    const f = join(dirname(d), 'filo-security', 'functions');
    if (esiste(join(f, 'tools', 'server-fondi.js'))) return f;
    const su = dirname(d);
    if (su === d) break;
    d = su;
  }
  return '';
}

/** Ramo, pratica e prova a vuoto, anche quando npm si è preso le opzioni. PURA. */
export function leggiArgomenti(argv, env = {}) {
  const daNpm = argomentiDaNpm(env, { opzioni: ['--feedback', '--dry-run'], conValore: ['--feedback'] });
  if (daNpm.errore) return { errore: daNpm.errore };
  const f = estraiOpzioneFeedback([...(Array.isArray(argv) ? argv : []), ...daNpm.args]);
  if (f.errore) return { errore: f.errore };
  const dryRun = f.resto.includes('--dry-run');
  const altri = f.resto.filter((a) => a !== '--dry-run');
  const sconosciute = altri.filter((a) => /^-/.test(a));
  if (sconosciute.length) return { errore: `argomenti non capiti (${sconosciute.join(' ')})` };
  if (altri.length > 1) return { errore: `un ramo solo, non ${altri.length} (${altri.join(' ')})` };
  return { ramo: altri[0] || '', pratica: f.valore, dryRun, nota: daNpm.nota };
}

export const notaInizio = (ramo) => `Lavoro sul server: porto ${ramo} su main di filo-security (npm run server:fondi).`;
export const notaFine = (ramo, sha) => `Fuso su main di filo-security: ${ramo}${sha ? ` a ${sha.slice(0, 9)}` : ''}. In produzione va col deploy, npm run server:pubblica.`;

/**
 * I rami dell'app legati alla pratica (verify-local start --feedback, in ogni worktree del repo) e non ancora su
 * origin/main: un lavoro che tocca app e server lo chiude la fusione dell'app, che salta L5 solo a pratica aperta.
 */
export function ramiApertiDellaPratica(id, { radice = ROOT, git = gitIn, leggi = leggiJson } = {}) {
  const lista = git(radice, ['worktree', 'list', '--porcelain']);
  if (lista === null) return [];
  const cartelle = lista.split('\n').filter((r) => r.startsWith('worktree ')).map((r) => r.slice('worktree '.length).trim());
  const rami = new Set();
  for (const c of cartelle) {
    const stato = leggi(join(c, '.claude', 'verify-local.json')) || {};
    for (const [ramo, e] of Object.entries(stato)) {
      if (!e || e.feedbackId !== id) continue;
      if (git(radice, ['merge-base', '--is-ancestor', ramo, 'refs/remotes/origin/main']) === null) rami.add(ramo);
    }
  }
  return [...rami];
}

function gitIn(cwd, args) {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (_) { return null; }
}

function leggiJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function lanciaServer(cartella, args, env) {
  const r = spawnSync(process.execPath, [join('tools', 'server-fondi.js'), ...args], { cwd: cartella, stdio: 'inherit', env });
  return typeof r.status === 'number' ? r.status : 1;
}

function puntaDelServer(cartella) {
  try { return execFileSync('git', ['rev-parse', 'refs/remotes/origin/main'], { cwd: cartella, encoding: 'utf8' }).trim(); } catch (_) { return ''; }
}

/**
 * Tutto il giro; ritorna il codice d'uscita (0 fatto, 1 fermo, 2 uso, 3 pratica rifiutata, 4 server non raggiungibile).
 * Le dipendenze si iniettano nei test; la rete passa dal fetch globale, come negli strumenti delle pratiche.
 */
export async function esegui(argv, deps = {}) {
  const env = deps.env || process.env;
  const log = deps.log || console.log;
  const err = deps.err || console.error;
  const a = leggiArgomenti(argv, env);
  if (a.errore) { err(`server:fondi: ${a.errore}. ${USO}`); return 2; }
  if (a.nota) log(a.nota);
  if (!a.pratica) { err(SENZA_PRATICA); return 1; }
  if (!a.ramo) { err(`server:fondi: manca il ramo del server (claude/<nome>). ${USO}`); return 2; }
  const cartella = deps.funzioni !== undefined ? deps.funzioni : cartellaDelServer(deps.radice || ROOT);
  if (!cartella) { err('server:fondi: accanto al repo Filo non trovo il checkout del server (cartella filo-security). Non ho toccato niente.'); return 1; }

  const of = await import('./owner-feedback.mjs');
  let bearer = deps.bearer;
  let base = deps.base;
  try {
    if (!bearer || !base) {
      const auth = await import('./lib/firestore-auth.mjs');
      bearer = bearer || await auth.acquireBearer();
      base = base || auth.FIRESTORE_BASE;
    }
    const r = await risolviFeedback(a.pratica, { bearer, base });
    if (!r.ok) { err(`Pratica non trovata: ${r.motivo}. Non ho toccato niente.`); return 3; }
    const chi = r.seq ? `#${r.seq}` : r.id;
    const lav = await of.praticaPerLaSessione(r.id, { bearer });
    if (!lav.ok) { err(`${of.rifiutoPratica(a.pratica, lav)}\nNon ho toccato niente.`); return 3; }
    // La stessa presa in carico della verifica: rifiuta una pratica chiusa o nei Ricevuti prima di muovere il server.
    const prova = await of.annotaPratica(r.id, notaInizio(a.ramo), { bearer, dryRun: true });
    if (!prova.ok) { err(`La pratica ${chi} non porta un lavoro (${prova.motivo}): per un lavoro nuovo aprine una. Non ho toccato niente.`); return 3; }
    const figlio = { ...env, [PRATICA_ENV]: chi };
    const lancia = deps.lancia || lanciaServer;
    const ramiApp = (deps.ramiAperti || ramiApertiDellaPratica)(r.id);
    const dopo = ramiApp.length
      ? `resterebbe aperta: la chiude la fusione di ${ramiApp.join(', ')} dell'app`
      : `si chiuderebbe con «${notaFine(a.ramo, '')}»`;
    if (a.dryRun) {
      const k = lancia(cartella, [a.ramo, '--dry-run'], figlio);
      log(`PROVA: la pratica ${chi} andrebbe in lavorazione e, a fusione riuscita, ${dopo}.`);
      return k;
    }
    const presa = await of.annotaPratica(r.id, notaInizio(a.ramo), { bearer });
    if (!presa.ok) { err(`Pratica ${chi} non aggiornata (${presa.motivo}): non porto il ramo su main senza.`); return 1; }
    log(`Pratica ${chi}: ${presa.from === presa.to ? 'giro annotato' : 'presa in carico («In lavorazione»)'}.`);
    const k = lancia(cartella, [a.ramo], figlio);
    if (k !== 0) {
      await of.annotaPratica(r.id, `server:fondi si è fermato (uscita ${k}) su ${a.ramo}: main del server non si è mosso.`, { bearer }).catch(() => null);
      err(`La pratica ${chi} resta in lavorazione: sistema e rilancia lo stesso comando.`);
      return k;
    }
    const sha = (deps.punta || puntaDelServer)(cartella);
    const chiusa = await of.scrivi(r.id, 'done', notaFine(a.ramo, sha), { bearer, attore: 'routine' });
    if (!chiusa.ok) {
      err(`${a.ramo} è su main del server, ma la pratica ${chi} non si è chiusa (${chiusa.motivo}). Chiudila a mano:\n  npm run feedback -- ${r.id} done "${notaFine(a.ramo, sha)}" --come-routine`);
      return 1;
    }
    log(`Pratica ${chi} chiusa: ${a.ramo} è su main del server. Per il deploy: npm run server:pubblica, da filo-security/functions.`);
    return 0;
  } catch (e) {
    err(`Server dei feedback non raggiungibile: ${String((e && e.message) || e).slice(0, 200)}`);
    return 4;
  }
}

if (resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url))) {
  process.exit(await esegui(process.argv.slice(2)));
}
