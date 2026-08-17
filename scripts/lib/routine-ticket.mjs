// routine-ticket.mjs — il biglietto del giro in corso, ritrovabile da solo.
//
// PERCHÉ ESISTE
//   Il biglietto arriva all'orchestratore, che lo passa al lavoratore. Ma le
//   consegne (verdetti, cambi di stato, note, nuovi feedback) le fanno script
//   diversi, invocati in momenti diversi: pretendere che il lavoratore si
//   ricordi di passare il biglietto a ognuno di loro è la stessa scommessa che
//   sulla provenienza dei feedback si è già persa — su decine di ritrovamenti
//   uno solo risultava firmato giusto, finché a firmare doveva pensarci chi
//   lavorava.
//
//   Quindi lo scrive `dispatch.mjs`, che il biglietto ce l'ha per costruzione, e
//   chi consegna lo rilegge da qui senza doverci pensare.
//
// IL FILE
//   `.claude/routine-ticket.json`, accanto agli altri marcatori di sessione e
//   con la stessa natura: EFFIMERO, locale alla macchina, gitignorato. Non
//   finisce mai in un commit, e non è un segreto che valga: apre UN feedback,
//   per la durata di UN semaforo, e muore col semaforo. È l'opposto della
//   chiave privata, che apriva tutto e viveva nell'ambiente di chiunque.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Oltre questa età il marcatore non è più credibile: il semaforo lato server
// dura al massimo otto ore, quindi un biglietto più vecchio è certamente morto
// e riprovarci significa solo prendersi un rifiuto.
export const MAX_AGE_MS = 9 * 60 * 60 * 1000;

export function ticketFile(root) {
  return resolve(root, '.claude', 'routine-ticket.json');
}

/** Il marcatore è ancora credibile? PURA. */
export function isFresh(marker, nowMs = Date.now(), maxAgeMs = MAX_AGE_MS) {
  if (!marker || typeof marker.ticket !== 'string' || !marker.ticket) return false;
  const t = Date.parse(String(marker.since || ''));
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= maxAgeMs && nowMs - t >= -60 * 1000;
}

export function writeTicket(root, ticket) {
  const t = String(ticket || '').trim();
  if (!t) return null;
  try {
    mkdirSync(resolve(root, '.claude'), { recursive: true });
    const marker = { ticket: t, since: new Date().toISOString() };
    writeFileSync(ticketFile(root), JSON.stringify(marker, null, 2) + '\n', 'utf8');
    return marker;
  } catch (_) {
    // Best-effort: non poter ricordare il biglietto è una perdita di comodità,
    // non un motivo per non consegnare il lavoro.
    return null;
  }
}

export function clearTicket(root) {
  try {
    const f = ticketFile(root);
    if (existsSync(f)) rmSync(f, { force: true });
  } catch (_) { /* best-effort */ }
}

function readMarkerFrom(dir) {
  try {
    const f = ticketFile(dir);
    if (!existsSync(f)) return null;
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (_) {
    return null;
  }
}

/**
 * Il biglietto del giro in corso, o '' se non c'è.
 *
 * Stessa precedenza del marcatore di ruolo: variabile esplicita > marcatore di
 * QUESTA directory > marcatore del checkout principale. L'ultimo passaggio
 * serve ai ruoli che lavorano dentro una cartella di lavoro separata, dove
 * `.claude/` è un'altra cartella ma il marcatore l'ha scritto dispatch nel
 * checkout principale.
 */
export function readTicket(root, { now = Date.now() } = {}) {
  const fromEnv = String(process.env.FILO_ROUTINE_TICKET || '').trim();
  if (fromEnv) return fromEnv;

  const here = readMarkerFrom(root);
  if (isFresh(here, now)) return here.ticket;

  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (common) {
      const main = readMarkerFrom(resolve(common, '..'));
      if (isFresh(main, now)) return main.ticket;
    }
  } catch (_) { /* niente git o repo nudo: pazienza */ }

  return '';
}
