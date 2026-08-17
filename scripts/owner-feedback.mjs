// owner-feedback.mjs — l'owner scrive sui feedback, con le SUE credenziali.
//
// PERCHÉ ESISTE (spec ROUTINE-AUTH-SPEC.md §8.5)
//   La coda su git nasceva da un vincolo delle ROUTINE: non potendo scrivere su
//   Firestore, depositavano la decisione come file nel repo e un automatismo la
//   applicava. L'owner quel vincolo non l'ha mai avuto — le sue credenziali
//   scrivono direttamente. Passava dalla coda solo perché la coda c'era.
//
//   Smontata la coda, questa è la strada dell'owner: diretta, senza fogliettini
//   nel repo pubblico e senza aspettare un automatismo.
//
//   Le decisioni delle routine NON passano di qui: passano dal canale
//   autenticato, dove il server le valida. Questo strumento presuppone le
//   credenziali dell'owner, che le routine non hanno.
//
// PERCHÉ IL CONTROLLO QUI FUNZIONA DAVVERO
//   La validazione dei passaggi di stato ha bisogno di leggere lo stato attuale,
//   che è cifrato. L'automatismo su GitHub la chiave non ce l'aveva, quindi non
//   sapeva mai da dove si partiva e per prudenza applicava lo stesso — era il
//   difetto (b) della spec. L'owner la chiave ce l'ha: qui il controllo gira.
//
// USO
//   node scripts/owner-feedback.mjs <id> <status> "nota"  [--branch <nome>]
//                                                         [--reason <slug>]
//                                                         [--starred|--unstar]
//                                                         [--come-routine]
//                                                         [--dry-run]
//
//   `--come-routine`: la macchina a stati distingue chi scrive. L'owner decide
//   sui feedback che aspettano lui (approvare, riaprire, archiviare); i passaggi
//   dell'ITER di lavorazione — prendere in carico, consegnare, chiudere un fix —
//   appartengono alle routine. Quando l'owner li fa al posto loro (chiude a mano
//   una pratica lavorata in locale) sta agendo come routine, e deve DIRLO. Non è
//   burocrazia: senza, chiudere a mano una pratica passerebbe da una tabella
//   che quel passaggio non contempla, e il controllo direbbe no per il motivo
//   sbagliato — oppure, se lo si allargasse, non direbbe più no a niente.
//
//   status ∈ todo | working | revision_capability | revision_security |
//            done | design | archived | attack_confirmed | spam_confirmed
//
//   La nota si AGGIUNGE alla conversazione, non la sostituisce.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { acquireBearer, FIRESTORE_BASE } from './lib/firestore-auth.mjs';
// Moduli IIFE: importarli li registra su globalThis.
import '../src/shared/feedbackThread.js';
import '../src/shared/feedbackCrypto.js';
import '../src/shared/feedback.js';
import '../src/shared/feedbackStatus.js';

const THREAD = globalThis.SN_FEEDBACK_THREAD;
const FS = globalThis.SN_FB_STATUS;
const CRYPTO = globalThis.SN_FEEDBACK_CRYPTO;
const statusToPublic = globalThis.SN_FEEDBACK?.statusToPublic;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// L'owner può fare tutto ciò che la macchina a stati concede al suo ruolo, più
// gli stati dell'iter (quando chiude una pratica a mano al posto di una routine).
export const ALLOWED = Object.freeze([
  'todo', 'working', 'revision_capability', 'revision_security',
  'done', 'design', 'archived', 'attack_confirmed', 'spam_confirmed', 'aligned', 'unlabeled',
]);

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (Number.isInteger(v)) return { integerValue: String(v) };
  if (typeof v === 'number') return { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  throw new Error('tipo non supportato per Firestore value');
}

/** La versione in costruzione: è quella in cui un fix confluisce. */
function packageVersion() {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version || '';
  } catch (_) { return ''; }
}

async function getDoc(id, bearer) {
  const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`lettura fallita (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/**
 * Lo stato ATTUALE, decifrato. È il punto su cui il vecchio automatismo era
 * cieco: senza questo, "la transizione è legale?" non è una domanda a cui si
 * possa rispondere.
 * @returns {Promise<{ from: string, leggibile: boolean }>}
 */
export async function statoAttuale(doc) {
  const grezzo = doc?.fields?.status?.stringValue || '';
  if (!CRYPTO?.isEncrypted?.(grezzo)) return { from: grezzo, leggibile: true };
  try {
    const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
    const dec = await decryptFeedbackFields({ _id: doc.name, status: grezzo });
    const from = String(dec.status || '').trim();
    // Il placeholder che l'helper mette quando non riesce a decifrare non è uno
    // stato: fingerlo tale vorrebbe dire validare contro un'invenzione.
    if (!from || !FS.isCanonical(from)) return { from, leggibile: false };
    return { from, leggibile: true };
  } catch (_) {
    return { from: '', leggibile: false };
  }
}

/**
 * La transizione è ammessa? PURA rispetto ai suoi ingressi.
 *
 * `canReach` e non `canTransition`: chiudendo una pratica a mano si saltano i
 * passi intermedi (todo → done senza passare da working), e quei passi sono
 * comunque legali. Vale la catena.
 */
export function transizioneAmmessa(from, to, attore = 'owner') {
  if (!FS.isCanonical(from)) return { ok: false, motivo: `stato di partenza non riconosciuto ("${from}")` };
  if (from === to) return { ok: true };
  if (!FS.canReach(from, to, attore)) return { ok: false, motivo: `${from} → ${to} non è un passaggio permesso` };
  return { ok: true };
}

/**
 * Scrive la decisione. Ritorna { ok, from, to } oppure { ok:false, motivo }.
 */
export async function scrivi(id, to, nota, opts = {}) {
  if (!ALLOWED.includes(to)) return { ok: false, motivo: `stato non valido: "${to}"` };
  const bearer = await acquireBearer();
  const doc = await getDoc(id, bearer);
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };

  const { from, leggibile } = await statoAttuale(doc);
  if (!leggibile) {
    // In dubbio ci si ferma: applicare senza sapere da dove si parte è
    // esattamente ciò che il vecchio automatismo faceva "per prudenza".
    return { ok: false, motivo: 'stato attuale non decifrabile: non posso sapere se il passaggio è legale' };
  }
  const check = transizioneAmmessa(from, to, opts.attore || 'owner');
  if (!check.ok) return { ok: false, motivo: check.motivo, from };

  const fields = {};
  const mask = [];
  const set = (k, v) => { fields[k] = toFsValue(v); mask.push(k); };

  // Lo status fine va cifrato e imbottito a lunghezza fissa (il documento è
  // pubblico: il cifrato non deve rivelare lo stato con la sola lunghezza).
  let fine = to;
  if (CRYPTO?.isEnabled?.()) {
    try { fine = await CRYPTO.encryptForOwner(FS.padForCipher(to)); }
    catch (e) { return { ok: false, motivo: `cifratura dello stato fallita: ${e?.message || e}` }; }
  }
  set('status', fine);
  set('statusPublic', statusToPublic ? statusToPublic(to) : 'open');
  set('workingSince', to === 'working' ? new Date().toISOString() : '');

  if (typeof nota === 'string' && nota.trim()) {
    const esistenti = doc.fields?.notes?.stringValue || '';
    const fuse = THREAD ? THREAD.mergeModelReport(esistenti, nota) : nota;
    set('notes', THREAD?.capNotes ? THREAD.capNotes(fuse) : fuse);
  }
  if (typeof opts.branch === 'string') set('branch', opts.branch.slice(0, 200));
  if (typeof opts.reason === 'string') {
    set('statusReason', opts.reason.slice(0, 60));
    set('blockReason', opts.reason.slice(0, 60));
  }
  if (typeof opts.starred === 'boolean') set('starred', opts.starred);
  if (to === 'done') set('resolvedInVersion', packageVersion());
  // Una consegna reale azzera il contatore delle interruzioni.
  if (to !== 'working' && to !== 'todo') set('workingResets', 0);

  if (opts.dryRun) return { ok: true, from, to, dryRun: true, campi: mask };

  const q = mask.map((m) => `updateMask.fieldPaths=${m}`).join('&');
  const res = await fetch(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?${q}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) return { ok: false, motivo: `scrittura fallita (${res.status}): ${(await res.text()).slice(0, 200)}` };
  return { ok: true, from, to };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const argv = process.argv.slice(2);
  const flag = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const branch = flag('branch');
  const reason = flag('reason');
  const dryRun = argv.includes('--dry-run');
  let starred;
  if (argv.includes('--starred')) starred = true;
  else if (argv.includes('--unstar')) starred = false;

  const valoriDiFlag = new Set([branch, reason].filter((v) => v !== undefined));
  const posizionali = argv.filter((a) => !a.startsWith('--') && !valoriDiFlag.has(a));
  const [id, status, ...nota] = posizionali;

  if (!id || !status) {
    console.error('Uso: node scripts/owner-feedback.mjs <id> <status> "nota" [--branch <nome>] [--reason <slug>] [--starred|--unstar] [--dry-run]');
    console.error(`     status ∈ ${ALLOWED.join(' | ')}`);
    process.exit(1);
  }

  const r = await scrivi(id, status, nota.join(' '), { branch, reason, starred, dryRun });
  if (!r.ok) {
    console.error(`RIFIUTATO: ${r.motivo}`);
    process.exit(3);
  }
  console.log(r.dryRun
    ? `(prova a vuoto) ${r.from} → ${r.to}; campi che scriverei: ${r.campi.join(', ')}`
    : `OK: ${id} da "${r.from}" a "${r.to}".`);
}
