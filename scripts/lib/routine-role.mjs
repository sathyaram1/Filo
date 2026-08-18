// routine-role.mjs — chi è l'istanza che sta lavorando, adesso, in questa
// directory.
//
// PERCHÉ ESISTE (feedback #443)
//   In dashboard i feedback aperti dalle automazioni erano tutti indistinguibili:
//   uno trovato esplorando l'app, uno nato mentre si implementava una spec e uno
//   segnalato da chi verificava il lavoro di un altro arrivavano con la stessa
//   identità, e a colpo d'occhio sembravano tutti "esplorazioni". Distinguere
//   serve a leggere la coda: un ritrovamento del verificatore parla del lavoro
//   appena fatto, un ritrovamento dell'esploratore parla dell'app in generale.
//
//   La provenienza NON può dipendere dal fatto che il worker si ricordi di
//   passare una bandierina: è esattamente il motivo per cui, prima di questo,
//   un solo feedback su decine risultava "esplorazione" — l'unica volta che
//   qualcuno se ne era ricordato. Quindi la scrive il dispatcher, che il ruolo
//   lo SA per costruzione. Da quando le consegne passano dal canale autenticato
//   è il server a timbrare la provenienza, leggendola dal biglietto: qui resta
//   la traccia locale di chi sta girando adesso in questa directory.
//
// IL FILE
//   `.claude/routine-role.json`, accanto a `.claude/branch-expect.json` e con la
//   stessa natura: EFFIMERO, locale alla macchina, gitignorato. Vale finché non
//   arriva il worker successivo (i worker delle routine girano uno alla volta).
//   Un file più vecchio di MAX_AGE_MS viene ignorato: meglio una provenienza
//   generica che una sbagliata.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Oltre questa età il marcatore non è più credibile (una sessione di routine
// dura ore, non giorni): meglio "automazione" generica che l'etichetta sbagliata.
export const MAX_AGE_MS = 12 * 60 * 60 * 1000;

// I ruoli che il dispatcher può consegnare. Un valore fuori da qui viene
// scartato: il marcatore finisce nell'identità pubblica del feedback, quindi
// non deve poter contenere testo arbitrario.
export const KNOWN_ROLES = ['prober', 'verifier', 'secaudit', 'fixer', 'new-work'];

export function roleFile(root) {
  return resolve(root, '.claude', 'routine-role.json');
}

/** Normalizza un ruolo: stringa nota, oppure '' (sconosciuto). PURA. */
export function normalizeRole(role) {
  const r = String(role || '').trim().toLowerCase();
  return KNOWN_ROLES.includes(r) ? r : '';
}

/**
 * Il marcatore è ancora valido? PURA (testabile senza toccare il disco).
 * @param {{role?: string, since?: string}} marker
 * @param {number} nowMs
 */
export function isFresh(marker, nowMs = Date.now(), maxAgeMs = MAX_AGE_MS) {
  if (!marker || !normalizeRole(marker.role)) return false;
  const t = Date.parse(String(marker.since || ''));
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= maxAgeMs && nowMs - t >= -60 * 1000; // tolleranza di un minuto sull'orologio
}

export function writeRole(root, role) {
  const r = normalizeRole(role);
  if (!r) return null;
  try {
    mkdirSync(resolve(root, '.claude'), { recursive: true });
    const marker = { role: r, since: new Date().toISOString() };
    writeFileSync(roleFile(root), JSON.stringify(marker, null, 2) + '\n', 'utf8');
    return marker;
  } catch (_) {
    // Best-effort: non sapere chi siamo è una perdita di informazione, non un
    // motivo per non consegnare il lavoro.
    return null;
  }
}

export function clearRole(root) {
  try {
    const f = roleFile(root);
    if (existsSync(f)) rmSync(f, { force: true });
  } catch (_) { /* best-effort */ }
}

function readMarkerFrom(dir) {
  try {
    const f = roleFile(dir);
    if (!existsSync(f)) return null;
    const o = JSON.parse(readFileSync(f, 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (_) {
    return null;
  }
}

/**
 * Il ruolo dell'istanza corrente, o '' se non si sa.
 *
 * Precedenza: variabile d'ambiente esplicita > marcatore di QUESTA directory >
 * marcatore del checkout principale. L'ultimo passaggio serve ai ruoli che
 * lavorano dentro una cartella di lavoro separata (`.claude/worktrees/…`): lì
 * `.claude/` è un'altra cartella, ma il marcatore l'ha scritto il dispatcher nel
 * checkout principale. Stesso trucco già usato per ritrovare la chiave privata.
 */
export function readRole(root, { now = Date.now() } = {}) {
  const fromEnv = normalizeRole(process.env.FILO_ROUTINE_ROLE);
  if (fromEnv) return fromEnv;

  const here = readMarkerFrom(root);
  if (isFresh(here, now)) return normalizeRole(here.role);

  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (common) {
      const main = readMarkerFrom(resolve(common, '..'));
      if (isFresh(main, now)) return normalizeRole(main.role);
    }
  } catch (_) { /* niente git o repo nudo: pazienza */ }

  return '';
}
