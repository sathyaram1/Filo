// routine-beat.mjs — il battito parte da solo, insieme al biglietto.
//
// PERCHÉ ESISTE
//   Il semaforo del server cade dopo 30 minuti senza battito. La suite completa
//   in cloud ne dura 37. Il primo giro che ci è finito dentro ha perso un lavoro
//   intero: venti commit spinti sul ramo, consegna rifiutata (`dead_ticket`),
//   esito e report mai registrati da nessuna parte. Non è un caso isolato:
//   capita a ogni ruolo che lanci la suite completa.
//
//   Il comando che tiene vivo il semaforo esisteva già (`routine-channel.mjs
//   heartbeat --loop`), ma nessuno lo lanciava: non stava in nessuna ricetta di
//   ruolo. La toppa ovvia — scriverlo nel prompt del lavoratore — è la stessa
//   scommessa già persa due volte in questo repo (la firma dei feedback, il
//   biglietto passato agli script di consegna): quello che deve succedere
//   SEMPRE non si chiede a chi lavora, lo fa lo strumento.
//
//   Quindi lo avvia `dispatch.mjs`, che il biglietto ce l'ha per costruzione, e
//   nel momento in cui ce l'ha. Nessuna ricetta da ricordare, nessun prompt da
//   aggiornare.
//
// IL PROCESSO
//   Staccato (`detached` + `unref`): deve sopravvivere a dispatch, che esce
//   dopo pochi secondi, e restare vivo per tutta la sessione del lavoratore.
//   Muore da solo quando il biglietto muore — rilasciato o scaduto — perché il
//   ciclo del battito esce al primo `dead_ticket`. Nessun processo che resta
//   appeso a battere il cuore di un morto.
//
//   Il biglietto viaggia nell'AMBIENTE del figlio, non fra gli argomenti: la
//   riga di comando di un processo la legge chiunque sulla macchina.
//
// IL MARCATORE
//   `.claude/routine-beat.json` accanto a quello del biglietto, stessa natura:
//   effimero, locale, gitignorato. Serve a non aprire un secondo battito quando
//   dispatch viene invocato più volte con lo stesso biglietto, e a poter fermare
//   quello aperto (i test lo usano per non lasciare processi in giro).

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Un marcatore più vecchio del tetto duro del semaforo (8 ore lato server) non
// descrive più niente di vivo: si riparte, non si eredita.
export const MAX_AGE_MS = 9 * 60 * 60 * 1000;

export function beatFile(root) {
  return resolve(root, '.claude', 'routine-beat.json');
}

/** Il processo esiste ancora? Segnale 0: chiede e basta, non tocca niente. */
export function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch (e) {
    // EPERM = esiste ma è di un altro utente: esiste, ed è quello che chiediamo.
    return !!(e && e.code === 'EPERM');
  }
}

/**
 * C'è già un battito vivo per QUESTO biglietto? PURA (il "è vivo" si inietta).
 *
 * Il confronto sul biglietto non è pignoleria: fra un lavoratore e il successivo
 * il biglietto cambia, e un battito rimasto acceso sul biglietto vecchio non
 * tiene vivo niente del giro nuovo.
 */
export function beatIsLive(marker, ticket, { now = Date.now(), alive = pidAlive } = {}) {
  if (!marker || !ticket) return false;
  if (String(marker.ticket || '') !== String(ticket)) return false;
  const t = Date.parse(String(marker.since || ''));
  if (!Number.isFinite(t) || now - t > MAX_AGE_MS || now - t < -60 * 1000) return false;
  return alive(marker.pid);
}

export function readBeat(root) {
  try {
    const f = beatFile(root);
    if (!existsSync(f)) return null;
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (_) {
    return null;
  }
}

export function clearBeat(root) {
  try {
    const f = beatFile(root);
    if (existsSync(f)) rmSync(f, { force: true });
  } catch (_) { /* best-effort */ }
}

/**
 * Avvia il battito in sottofondo per `ticket`, se non ce n'è già uno vivo.
 *
 * Best-effort per scelta: non poter aprire il battito è un rischio (il semaforo
 * cadrà durante una lavorazione lunga), non un motivo per non consegnare il
 * lavoro. Il guasto si scrive su stderr, che nei giri finisce nei log.
 *
 * @returns {{ started: boolean, why: string, pid?: number }}
 */
export function startBeat(root, ticket, { now = Date.now(), spawnImpl = spawn, alive = pidAlive } = {}) {
  const t = String(ticket || '').trim();
  if (!t) return { started: false, why: 'no_ticket' };
  // Via di fuga per i test e per chi lancia dispatch a mano da locale: un
  // battito staccato che sopravvive alla sessione è comodo in cloud e molesto
  // sulla macchina di casa.
  if (String(process.env.FILO_NO_BEAT || '') === '1') return { started: false, why: 'disabled' };

  if (beatIsLive(readBeat(root), t, { now, alive })) return { started: false, why: 'already_live' };

  try {
    const script = resolve(HERE, '..', 'routine-channel.mjs');
    const child = spawnImpl(process.execPath, [script, 'heartbeat', '--loop'], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      // Il biglietto nell'ambiente, non fra gli argomenti: `readTicket` lo
      // ritrova da lì (stessa precedenza di tutti gli altri script).
      env: { ...process.env, FILO_ROUTINE_TICKET: t },
    });
    child.unref();
    mkdirSync(resolve(root, '.claude'), { recursive: true });
    writeFileSync(beatFile(root),
      JSON.stringify({ pid: child.pid, ticket: t, since: new Date(now).toISOString() }, null, 2) + '\n',
      'utf8');
    return { started: true, why: 'started', pid: child.pid };
  } catch (e) {
    return { started: false, why: `error: ${(e && e.message) || e}` };
  }
}

/** Ferma il battito aperto da questa macchina, se c'è. Best-effort. */
export function stopBeat(root, { alive = pidAlive } = {}) {
  const m = readBeat(root);
  if (m && alive(m.pid)) {
    try { process.kill(Number(m.pid)); } catch (_) { /* già morto */ }
  }
  clearBeat(root);
}
