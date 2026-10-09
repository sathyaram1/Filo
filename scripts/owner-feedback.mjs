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
// LE SESSIONI LOCALI (#908): UNA REGOLA, NON UN MURO
//   Lo usano soprattutto le sessioni locali, che hanno le credenziali dell'owner
//   e quindi tutti i suoi poteri. Per regola però non spostano feedback DAI
//   Ricevuti (aspettano una decisione dell'owner, in Gestione) né dalle sue
//   conferme, non lavorano feedback di utenti senza il sì dell'owner (solo da Gestione, #957) e non stampano testo dei feedback:
//   qui si rifiuta prima di scrivere. Firestore lo permetterebbe; è una scelta.
//
// PERCHÉ IL CONTROLLO QUI FUNZIONA DAVVERO
//   La validazione dei passaggi di stato ha bisogno di leggere lo stato attuale,
//   che è cifrato. L'automatismo su GitHub la chiave non ce l'aveva, quindi non
//   sapeva mai da dove si partiva e per prudenza applicava lo stesso — era il
//   difetto (b) della spec. L'owner la chiave ce l'ha: qui il controllo gira.
//
// USO
//   node scripts/owner-feedback.mjs <n|id> <status> "nota"  [--branch <nome>]
//                                                         [--reason <slug>]
//                                                         [--starred|--unstar]
//                                                         [--preapprova|--chiedi-prima]
//                                                         [--frase "per l'utente"]
//                                                         [--priorita <0-3>]
//                                                         [--come-routine]
//                                                         [--dry-run]
//   node scripts/owner-feedback.mjs <n|id> --preapprova     (solo il segno, stato invariato)
//   node scripts/owner-feedback.mjs <n|id> --chiedi-prima
//   node scripts/owner-feedback.mjs <n|id> --frase "…"     (solo la frase per chi ha segnalato, stato invariato)
//   node scripts/owner-feedback.mjs <n|id> --priorita <0-3> (solo la priorità, stato invariato)
//   node scripts/owner-feedback.mjs <n|id> --solo-locale    (segno «solo in locale»)
//   node scripts/owner-feedback.mjs <n|id> --non-locale
//   node scripts/owner-feedback.mjs <n|id> --serve-locale ["perché"]
//   node scripts/owner-feedback.mjs <n|id> --aspetta 676,663.2   (attese, stato invariato)
//   node scripts/owner-feedback.mjs <n|id> --aspetta-niente
//
//   <n|id>: il numero del feedback (910, #910, 22.1) o il suo id.
//   `--priorita`: come il pallino di Gestione (cifrata, `priorityManual`: il giudice non la riabbassa). Da sola vale
//   su ogni stato, Ricevuti compresi, perché non sposta la pratica; con uno stato segue le regole del passaggio.
//   Un segno locale su una pratica chiusa ne toglie la scheda dalla bacheca pubblica: era un lavoro locale.
//
//   `--solo-locale`: la pratica la lavora solo una sessione locale, nessuna
//   routine la prende, e in Gestione sta nei Lavori locali. Solo sui feedback
//   dell'owner o di una sessione con la prova del mittente (#595).
//   `--non-locale` lo toglie. Su un feedback di un utente il segno si rifiuta:
//   se richiede lavoro locale, `--serve-locale` lo riporta nei Ricevuti
//   (stato design, nota «Richiede lavoro locale») e decide l'owner.
//   Il sì dell'owner a un feedback di un utente o di una routine (`localApproval`, #913) qui non si dà: solo il
//   tasto «💻 Lavoro locale» dei Ricevuti in Gestione (#957). Salta L5, e una sessione ingannata da un testo
//   d'utente, con le credenziali dell'owner, se lo darebbe da sola. `--approva-locale` si rifiuta. Per la
//   stessa ragione `--riconosci`: la prova del mittente data a mano la dà solo «🙋 È mio» in Gestione.
//
//   `--preapprova`: «fondi senza chiedermelo» su QUESTA pratica. Se i controlli
//   del server fermano il lavoro di una routine, il server fonde lo stesso e
//   registra cosa era stato fermato (Gestione → Automazioni, «Fuse senza
//   chiedere»). `--chiedi-prima` toglie il segno. Vale finché la pratica è
//   aperta; il lavoro locale (npm run finish) non lo guarda. Salta il sì alla fusione come il lavoro locale: da qui
//   solo sulle pratiche dell'owner o di una sessione (#957); sulle altre lo mette l'owner, in Gestione.
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
import { isRoutineInstance } from './lib/routine-role.mjs';
import { fetchRitentato } from './lib/rete.mjs';
import { avvisoDaCampi, parseRiferimento, risolviFeedback } from './lib/pratica-locale.mjs';
import { PARTI, RAMO_RE, partiDaCampi } from './lib/parti-lavoro.mjs';
import { firmaOra, patchFirmato } from './lib/firma-ora.mjs';
import { PRIORITA_AMMESSE, parsePriorita } from './lib/priorita.mjs';
// Moduli IIFE: importarli li registra su globalThis.
import '../src/shared/feedbackThread.js';
// La PUBBLICA va caricata PRIMA della cifratura: senza, il gate risulta spento e
// lo stato verrebbe riscritto IN CHIARO su un documento pubblico — cioè si
// disferebbe, un feedback alla volta, la cifratura che protegge lo stato.
import '../src/shared/feedbackPublicKey.js';
import '../src/shared/feedbackCrypto.js';
import '../src/shared/feedback.js';
import '../src/shared/feedbackStatus.js';
import '../src/shared/feedbackAttese.js';
import '../src/shared/manageReview.js';

const THREAD = globalThis.SN_FEEDBACK_THREAD;
const FS = globalThis.SN_FB_STATUS;
const CRYPTO = globalThis.SN_FEEDBACK_CRYPTO;
const MR = globalThis.SN_MANAGE_REVIEW;
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
  if (typeof v === 'object') {
    const fields = {};
    for (const [k, vv] of Object.entries(v)) fields[k] = toFsValue(vv);
    return { mapValue: { fields } };
  }
  throw new Error('tipo non supportato per Firestore value');
}

/**
 * Chi sta scrivendo, per il segno «fondi senza chiedermelo»: l'email dentro
 * il token dell'owner, o l'account di servizio. Un bearer che non è un JWT
 * (token di accesso OAuth) non dice chi è: si scrive che è lo script.
 */
export function chiScrive(bearer) {
  try {
    const parti = String(bearer || '').split('.');
    if (parti.length === 3) {
      const payload = JSON.parse(Buffer.from(parti[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      const email = String(payload.email || payload.client_email || payload.iss || '').trim();
      if (email) return email.slice(0, 120);
    }
  } catch (_) { /* non è un JWT leggibile */ }
  return 'owner (script)';
}

/**
 * Il segno «fondi senza chiedermelo» su una pratica, senza toccare lo stato.
 * `valore` true lo mette ({ by, at }), false lo toglie (cancella il campo:
 * la maschera lo nomina e i campi non lo portano). È la stessa scrittura che
 * fa la dashboard dal dettaglio della pratica.
 */
export async function segnaPreapprovazione(id, valore, opts = {}) {
  const bearer = opts.bearer || await acquireBearer();
  const doc = await getDoc(id, bearer, valore ? CAMPI_PRATICA : ['statusPublic']);
  if (opts.letture) opts.letture.aggiungi(1, 'segnalazioni riscritte');
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };
  const pub = doc.fields?.statusPublic?.stringValue || 'open';
  if (valore && pub === 'closed') return { ok: false, motivo: 'pratica chiusa: il segno non conterebbe' };
  const vietata = valore ? preapprovaVietata(await praticaInChiaro(doc)) : '';
  if (vietata) return { ok: false, motivo: vietata };
  const fields = {};
  const mask = ['mergePreapproved', 'updatedAt'];
  fields.updatedAt = firmaOra();
  const segno = valore ? { by: chiScrive(bearer), at: new Date().toISOString() } : null;
  if (segno) fields.mergePreapproved = toFsValue(segno);
  if (opts.dryRun) return { ok: true, dryRun: true, campi: mask, segno };
  const qsSegno = mask.map((m) => `updateMask.fieldPaths=${m}`).join('&');
  const res = await patchFirmato(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?${qsSegno}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  }, { fetchImpl: fetchRitentato });
  if (!res.ok) return { ok: false, motivo: `scrittura fallita (${res.status}): ${(await res.text()).slice(0, 200)}` };
  return { ok: true, segno };
}

/** Togliere il segno si può sempre; metterlo, solo dove una sessione lavora già (MR.localSenderCheck). '' = si può. */
function preapprovaVietata(fb) {
  if (!fb) return 'mittente o stato non decifrabili: non so di chi è la pratica';
  return MR.localSenderCheck(fb).ok ? '' : SOLO_DA_GESTIONE_PREAPPROVA;
}

/**
 * Da qui una sessione non sposta niente (#908). PURA. '' = si può partire.
 * I Ricevuti aspettano una decisione dell'owner; i confermati SONO una sua decisione.
 */
export function partenzaVietata(from) {
  const s = String(from || '');
  if (MR.isRicevutiStatus(s)) {
    return `«${s}» è uno stato dei Ricevuti: aspetta una decisione dell'owner, in Gestione. Per regola una sessione non sposta feedback da lì`;
  }
  if (/_confirmed$/.test(s)) return `«${s}» è una conferma dell'owner: la cambia lui, in Gestione`;
  return '';
}

// Gli stati del lavoro: una sessione ci porta solo pratiche sue o dell'owner, la stessa regola di start/finish --feedback (#908).
export const STATI_DEL_LAVORO = Object.freeze(['working', 'revision_capability', 'revision_security', 'done']);

/** Il passaggio porta la pratica nel lavoro, e non è dell'owner né di una sessione? null = si può. */
async function lavoroVietato(doc, to) {
  if (!STATI_DEL_LAVORO.includes(to)) return null;
  const fb = await praticaInChiaro(doc);
  if (!fb) return { motivo: 'mittente o stato non decifrabili: non so di chi è la pratica', utente: false };
  const chi = MR.localSenderCheck(fb);
  if (!chi.ok) return { motivo: chi.motivo, utente: !!chi.utente, routine: !!chi.routine, senzaProva: !!chi.senzaProva, ...contestoDelRifiuto(fb) };
  // Presa in carico: la stessa regola di start --feedback (praticaPerLaSessione).
  if (to === 'working' && !MR.isLocalOnly(fb)) return { motivo: SENZA_SEGNO, utente: false, senzaSegno: true };
  return null;
}

const SENZA_SEGNO = 'manca il segno «solo in locale»: senza, le routine la prendono, e la riprendono mentre la lavori';

/** Dove sta la pratica rifiutata: decide quali strade il rifiuto può proporre (rifiutoPratica). PURA. */
function contestoDelRifiuto(fb) {
  return { ricevuti: MR.isRicevutiStatus(fb && fb.status), segnalato: !!MR.segnalatoComeAttacco(fb) };
}

/**
 * I campi che servono a decidere sul segno, decifrati. null se mittente o stato
 * non si leggono: senza sapere di chi è la pratica non si segna niente.
 */
async function praticaInChiaro(doc) {
  const f = doc?.fields || {};
  const grezzi = { _id: doc.name, clientId: f.clientId?.stringValue || '', status: f.status?.stringValue || '' };
  let dec = grezzi;
  if (CRYPTO?.isEncrypted?.(grezzi.clientId) || CRYPTO?.isEncrypted?.(grezzi.status)) {
    try {
      const { decryptFeedbackFields, PLACEHOLDER } = await import('./lib/decrypt-feedback-fields.mjs');
      dec = await decryptFeedbackFields(grezzi);
      if ([dec.clientId, dec.status].some((v) => v === PLACEHOLDER || CRYPTO.isEncrypted(v))) return null;
    } catch (_) { return null; }
  }
  const status = String(dec.status || '').trim();
  if (!FS.isCanonical(status)) return null;
  const lo = f.localOnly?.mapValue?.fields;
  const la = f.localApproval?.mapValue?.fields;
  // Il giudizio, per la regola del lettore (MR.segnalatoComeAttacco): un segnalato non prende segno né prova da qui.
  let pipeline;
  if (f.pipeline) {
    const { giudizioInChiaro } = await import('./leggi-feedback.mjs');
    const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
    pipeline = await giudizioInChiaro(f, decryptFeedbackFields);
  }
  return {
    clientId: String(dec.clientId || ''),
    status,
    ...(pipeline === undefined ? {} : { pipeline }),
    senderProof: f.senderProof?.stringValue || '',
    statusPublic: f.statusPublic?.stringValue || 'open',
    localOnly: lo ? { by: lo.by?.stringValue || '', at: Number(lo.at?.integerValue || 0) } : undefined,
    localApproval: la ? { by: la.by?.stringValue || '', at: Number(la.at?.integerValue || 0) } : undefined,
    userNote: f.userNote?.stringValue || '',
    beatAt: f.beatAt?.stringValue || f.beatAt?.timestampValue || '',
    workingSince: f.workingSince?.stringValue || f.workingSince?.timestampValue || '',
  };
}
const CAMPI_PRATICA = ['clientId', 'senderProof', 'status', 'statusPublic', 'localOnly', 'localApproval', 'localMerges', 'userNote', 'beatAt', 'workingSince', 'pipeline'];

/**
 * Il segno «solo in locale» (#908): `valore` true lo mette ({ by, at } in ms), false lo toglie.
 * La regola sta in SN_MANAGE_REVIEW.localSignCheck, la stessa del tasto in Gestione.
 * Ritorna { ok, segno } o { ok:false, motivo, utente } (utente = feedback di un utente).
 */
export async function segnaLocale(id, valore, opts = {}) {
  const bearer = opts.bearer || await acquireBearer();
  const doc = await getDoc(id, bearer, CAMPI_PRATICA);
  if (opts.letture) opts.letture.aggiungi(1, 'segnalazioni riscritte');
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };
  const fb = await praticaInChiaro(doc);
  if (!fb) return { ok: false, motivo: 'mittente o stato non decifrabili: non so di chi è la pratica' };
  const check = MR.localSignCheck(fb, valore);
  if (!check.ok) return { ok: false, motivo: check.motivo, utente: !!check.utente, routine: !!check.routine, senzaProva: !!check.senzaProva, ...contestoDelRifiuto(fb) };
  const segno = valore ? { by: chiScrive(bearer), at: Date.now() } : null;
  const chiusa = !!check.chiusa;
  // Il feedback di un utente approvato tiene la scheda: è da lì che chi l'ha mandato vede la risoluzione.
  const tieneScheda = MR.isLocalApproved(fb);
  if (opts.dryRun) return { ok: true, dryRun: true, segno, chiusa, tieneScheda };
  const fields = segno ? { localOnly: toFsValue(segno), updatedAt: firmaOra() } : { updatedAt: firmaOra() };
  // Il sì dell'owner (#913) resta anche col segno tolto: si dà solo dai Ricevuti, e senza il segno non si rimetterebbe.
  const res = await patchFirmato(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?updateMask.fieldPaths=localOnly&updateMask.fieldPaths=updatedAt`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  }, { fetchImpl: fetchRitentato });
  if (!res.ok) return { ok: false, motivo: `scrittura fallita (${res.status}): ${(await res.text()).slice(0, 200)}` };
  if (!chiusa) return { ok: true, segno, tieneScheda };
  // Tolto da una pratica chiusa: la scheda la rimette l'app dell'owner alla prossima sincronizzazione della bacheca.
  if (!valore || tieneScheda) return { ok: true, segno, chiusa, tieneScheda };
  const scheda = await togliScheda(id, bearer);
  return { ok: true, segno, chiusa, scheda };
}

/** Un lavoro locale non sta nella bacheca pubblica: la sua scheda si toglie. '' se fatto (o non c'era), sennò il motivo. */
async function togliScheda(id, bearer) {
  const res = await fetchRitentato(`${FIRESTORE_BASE}/feedback-public/${encodeURIComponent(id)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${bearer}` },
  });
  return res.ok || res.status === 404 ? '' : `la scheda nella bacheca pubblica è rimasta (${res.status})`;
}

/**
 * Le attese (#903), stato invariato: `numeri` come li scrive l'owner («676,663.2»), '' per toglierle. Le regole sono
 * quelle di Gestione (SN_FB_ATTESE.valida): numeri inesistenti, sé stesso, giri e più di venti si rifiutano col motivo.
 * @returns {Promise<{ ok: true, attese: Array<{id,num}>, dryRun?: true } | { ok: false, motivo: string }>}
 */
export async function segnaAttese(id, numeri, opts = {}) {
  const ATT = globalThis.SN_FB_ATTESE;
  const letti = ATT.leggiNumeri(numeri || '');
  if (!letti.ok) return letti;
  const bearer = opts.bearer || await acquireBearer();
  const doc = await getDoc(id, bearer, ['seq', 'subSeq']);
  if (opts.letture) opts.letture.aggiungi(1, 'segnalazioni riscritte');
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };
  let attese = [];
  if (letti.numeri.length) {
    const f = doc.fields || {};
    const v = await ATT.valida({
      id,
      num: globalThis.SN_FEEDBACK.formatNum(Number(f.seq?.integerValue), Number(f.subSeq?.integerValue)),
      numeri: letti.numeri,
      risolvi: async (n) => {
        const r = await risolviFeedback(n, { bearer, base: FIRESTORE_BASE });
        if (r.ok) return r.id;
        if (/^nessun feedback/.test(r.motivo)) return null;
        throw new Error(r.motivo);
      },
      leggiAttese: async (ids) => new Map(await Promise.all(ids.map(async (x) => {
        const d = await getDoc(x, bearer, [ATT.CAMPO]);
        return [x, ATT.atteseDi({ waitsFor: atteseDaCampo(d?.fields?.[ATT.CAMPO]) })];
      }))),
    });
    if (!v.ok) return v;
    attese = v.attese;
  }
  if (opts.dryRun) return { ok: true, dryRun: true, attese };
  const fields = attese.length ? { [ATT.CAMPO]: toFsValue(attese), updatedAt: firmaOra() } : { updatedAt: firmaOra() };
  const res = await patchFirmato(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?updateMask.fieldPaths=${ATT.CAMPO}&updateMask.fieldPaths=updatedAt`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) return { ok: false, motivo: `scrittura fallita (${res.status}): ${(await res.text()).slice(0, 200)}` };
  return { ok: true, attese };
}

/** Il campo `waitsFor` letto dall'API REST: [{ id, num }]. */
function atteseDaCampo(v) {
  return (v?.arrayValue?.values || []).map((x) => ({
    id: x?.mapValue?.fields?.id?.stringValue || '', num: x?.mapValue?.fields?.num?.stringValue || '',
  }));
}

/**
 * Un feedback di un utente che richiederebbe lavoro locale torna nei Ricevuti:
 * stato design, motivo 'locale', nota «Richiede lavoro locale». Decide l'owner.
 * È il passaggio che una routine fa quando ha domande, e si dichiara come tale.
 */
export async function serveLocale(id, nota = '', opts = {}) {
  const bearer = opts.bearer || await acquireBearer();
  const doc = await getDoc(id, bearer, CAMPI_PRATICA);
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };
  const fb = await praticaInChiaro(doc);
  if (!fb) return { ok: false, motivo: 'mittente o stato non decifrabili: non so di chi è la pratica' };
  if (MR.isProvenLocalSender(fb)) {
    return { ok: false, motivo: 'la pratica è dell’owner o di una sessione: per lavorarla in locale usa --solo-locale' };
  }
  if (fb.status === 'design') return { ok: false, motivo: 'è già nei Ricevuti, in attesa di una scelta dell’owner' };
  const testo = `Richiede lavoro locale.${String(nota || '').trim() ? ` ${String(nota).trim()}` : ''}`;
  return scrivi(id, 'design', testo, { ...opts, bearer, attore: 'routine', reason: 'locale' });
}

const STATI_DEL_LAVORO_LOCALE = Object.freeze(['todo', 'working', 'revision_capability', 'revision_security']);

/**
 * Il giro di un lavoro locale nella sua pratica (#908): presa in carico se è ancora in coda, e la nota nella
 * conversazione. Fuori dagli stati del lavoro (Ricevuti, chiusa) non la tocca.
 * @returns {Promise<{ ok: true, from: string, to: string } | { ok: false, motivo: string }>}
 */
export async function annotaPratica(id, nota, opts = {}) {
  const bearer = opts.bearer || await acquireBearer();
  const doc = await getDoc(id, bearer, ['status']);
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };
  const { from, leggibile } = await statoAttuale(doc);
  if (!leggibile) return { ok: false, motivo: 'stato non decifrabile' };
  if (!STATI_DEL_LAVORO_LOCALE.includes(from)) return { ok: false, motivo: `la pratica è in «${from}», fuori dal lavoro: non la tocco` };
  return scrivi(id, from === 'todo' ? 'working' : from, nota, { ...opts, bearer, attore: 'routine' });
}

/**
 * Una sessione locale può legare il suo lavoro a questa pratica (verify-local start --feedback, finish
 * --feedback)? Solo se è dell'owner o di una sessione con la prova, o se l'owner l'ha approvata come lavoro locale (#913).
 * Per cominciare serve anche il segno locale dove le routine la prendono: il server rimette in coda un «In
 * lavorazione» senza segno, e una routine la rifà mentre la sessione la lavora. `allaChiusura`: basta l'avviso.
 * @returns {Promise<{ ok: true, avviso: string } | { ok: false, motivo: string, utente: boolean }>}
 */
export async function praticaPerLaSessione(id, opts = {}) {
  const bearer = opts.bearer || await acquireBearer();
  const doc = await getDoc(id, bearer, CAMPI_PRATICA);
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente`, utente: false };
  const fb = await praticaInChiaro(doc);
  if (!fb) return { ok: false, motivo: 'mittente o stato non decifrabili: non so di chi è la pratica', utente: false };
  const chi = MR.localSenderCheck(fb);
  if (!chi.ok) return { ok: false, motivo: chi.motivo, utente: !!chi.utente, routine: !!chi.routine, senzaProva: !!chi.senzaProva, ...contestoDelRifiuto(fb) };
  if (!opts.allaChiusura && !MR.isLocalOnly(fb) && STATI_DEL_LAVORO_LOCALE.includes(fb.status)) {
    return { ok: false, motivo: SENZA_SEGNO, utente: false, senzaSegno: true };
  }
  return { ok: true, avviso: [avvisoDaCampi(doc.fields), avvisoFrase(fb, id)].filter(Boolean).join('\n') };
}

/** Il promemoria della frase per chi ha segnalato (regola: SN_MANAGE_REVIEW.fraseAttesa), '' se non serve. PURA. */
export function avvisoFrase(fb, rif) {
  if (!MR.fraseAttesa(fb)) return '';
  // Il comando si incolla: un «#951» in bash e in PowerShell apre un commento, e npm partirebbe senza argomenti.
  const chi = String(rif ?? '').trim().replace(/^#+/, '');
  return `Chi l’ha mandato è un utente: a pratica chiusa vede la risoluzione con la sola frase per lui, e questa pratica non ne ha una. Se il lavoro cambia qualcosa che vede, scrivila (una riga in chiaro, niente dettagli di sicurezza): npm run feedback -- ${chi} --frase "…". Vale anche a pratica chiusa.`;
}

/** Lo stesso promemoria letto in rete, per chi ha la pratica ma non l'ha appena riletta (finish, server:fondi). '' anche se non si legge. */
export async function fraseDaScrivere(id, rif = id, opts = {}) {
  try {
    const bearer = opts.bearer || await acquireBearer();
    const doc = await getDoc(id, bearer, CAMPI_PRATICA);
    const fb = doc && await praticaInChiaro(doc);
    return fb ? avvisoFrase(fb, rif) : '';
  } catch (_) { return ''; }
}

// Il tetto di `userNote` nelle regole del database: oltre, la frase si rifiuta col numero, mai tagliata.
const FRASE_MAX = 500;
function fraseTroppoLunga(testo) {
  return testo.length > FRASE_MAX ? `la frase è di ${testo.length} caratteri e la bacheca ne tiene ${FRASE_MAX}: accorciala` : '';
}

/**
 * Solo la frase per chi ha segnalato, stato invariato: `<n|id> --frase "…"`. Dai Ricevuti no, come ogni passaggio di una
 * sessione (partenzaVietata): lì decide l'owner. Su una pratica chiusa sì: la bacheca la mostra alla prossima sincronizzazione.
 */
export async function scriviFrase(id, frase, opts = {}) {
  const testo = String(frase || '').trim();
  if (!testo) return { ok: false, motivo: 'la frase è vuota' };
  const lunga = fraseTroppoLunga(testo);
  if (lunga) return { ok: false, motivo: lunga };
  const bearer = opts.bearer || await acquireBearer();
  const doc = await getDoc(id, bearer, ['status']);
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };
  const { from, leggibile } = await statoAttuale(doc);
  if (!leggibile) return { ok: false, motivo: 'stato attuale non decifrabile: non so dove sta la pratica' };
  const vietata = partenzaVietata(from);
  if (vietata) return { ok: false, motivo: vietata };
  const fields = { userNote: toFsValue(testo), updatedAt: firmaOra() };
  if (opts.dryRun) return { ok: true, dryRun: true };
  const res = await patchFirmato(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?updateMask.fieldPaths=userNote&updateMask.fieldPaths=updatedAt`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  }, { fetchImpl: fetchRitentato });
  if (!res.ok) return { ok: false, motivo: `scrittura fallita (${res.status}): ${(await res.text()).slice(0, 200)}` };
  return { ok: true };
}

/**
 * Stato in chiaro e parti già su main della pratica di un lavoro locale (#915).
 * @returns {Promise<{ ok: true, status: string, parti: object, locale: boolean } | { ok: false, motivo: string }>}
 */
export async function partiDellaPratica(id, opts = {}) {
  const bearer = opts.bearer || await acquireBearer();
  const doc = await getDoc(id, bearer, ['status', 'localOnly', 'localMerges']);
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };
  const { from, leggibile } = await statoAttuale(doc);
  if (!leggibile) return { ok: false, motivo: 'stato non decifrabile' };
  return { ok: true, status: from, parti: partiDaCampi(doc.fields), locale: !!doc.fields?.localOnly?.mapValue };
}

/**
 * La parte di un lavoro locale arrivata su main, nella pratica (#915): `localMerges.<parte>` = adesso, in ms.
 * `opts.solo`: il lavoro stava tutto in questa parte, e `localMerges.solo` lo dice a chi arrivasse dopo.
 * `opts.ramo`: il ramo fuso; una parte tardiva vale solo col suo stesso nome (parteTardiva).
 */
export async function registraParte(id, parte, opts = {}) {
  if (!PARTI.includes(parte)) return { ok: false, motivo: `parte sconosciuta: ${parte}` };
  const at = Math.floor(opts.ora ?? Date.now());
  if (opts.dryRun) return { ok: true, dryRun: true, at };
  const bearer = opts.bearer || await acquireBearer();
  const campi = {
    [parte]: { integerValue: String(at) },
    ...(opts.solo ? { solo: { stringValue: parte } } : {}),
    ...(RAMO_RE.test(String(opts.ramo || '')) ? { ramo: { stringValue: opts.ramo } } : {}),
  };
  const fields = { localMerges: { mapValue: { fields: campi } }, updatedAt: firmaOra() };
  const q = [...Object.keys(campi).map((k) => `updateMask.fieldPaths=localMerges.${k}`), 'updateMask.fieldPaths=updatedAt'].join('&');
  const res = await patchFirmato(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?${q}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  }, { fetchImpl: fetchRitentato });
  if (!res.ok) return { ok: false, motivo: `scrittura fallita (${res.status}): ${(await res.text()).slice(0, 200)}` };
  return { ok: true, at };
}

/**
 * Il rifiuto di una pratica come lo legge la sessione. PURA. Propone solo le strade che su QUESTA pratica
 * funzionano: niente ripasso né prova su parola a un segnalato, niente rimando nei Ricevuti a chi c'è già.
 */
export function rifiutoPratica(id, r) {
  const righe = [`RIFIUTATO: ${String((r && r.motivo) || 'pratica non lavorabile in locale').replace(/\.$/, '')}.`];
  if (r && r.senzaSegno) {
    righe.push('Se l’owner ti ha chiesto di lavorarla in locale, mettilo e rilancia (col segno, alla chiusura si fonde senza chiedergli):');
    righe.push(`  node scripts/owner-feedback.mjs ${id} --solo-locale`);
    righe.push('Se il segno l’ha tolto lui, chiediglielo prima: la vuole rivedere prima della fusione, o lasciare alle routine.');
  }
  if (r && r.senzaProva && r.segnalato) {
    righe.push('È segnalato dai giudici: la prova del mittente la può dare solo l’owner, in Gestione («È mio»), dopo averlo guardato.');
  } else if (r && r.senzaProva) {
    // #912: il ripasso non dà più la prova al solo nome.
    righe.push(SOLO_DA_GESTIONE_MIO);
    righe.push('Altrimenti vale come un utente.');
  }
  if (r && (r.utente || r.routine) && r.ricevuti) {
    righe.push(`È già nei Ricevuti: se richiede lavoro locale, dillo all’owner. ${SOLO_DA_GESTIONE}`);
  } else if (r && (r.utente || r.routine)) {
    righe.push('Se richiede lavoro locale, riportalo nei Ricevuti e decide l’owner:');
    righe.push(`  node scripts/owner-feedback.mjs ${id} --serve-locale "perché"`);
  }
  return righe.join('\n');
}

/** Il sì come lavoro locale a un feedback non dell'owner (#957): nessuno strumento delle sessioni lo scrive. */
export const SOLO_DA_GESTIONE = 'Come lavoro locale lo approva solo l’owner, in Gestione, col tasto «💻 Lavoro locale» dei Ricevuti dopo averlo letto: da riga di comando non si può.';
/** La prova del mittente data a mano (#957): stessa porta su L5, stesso tasto. */
export const SOLO_DA_GESTIONE_MIO = 'La prova del mittente la dà solo l’owner, in Gestione, col tasto «🙋 È mio» dopo averlo guardato: da riga di comando non si può.';
/** «Fondi senza chiedermelo» su una pratica non dell'owner né di una sessione: stessa porta su L5. */
export const SOLO_DA_GESTIONE_PREAPPROVA = 'il segno «fondi senza chiedermelo» salta il sì dell’owner alla fusione: su un feedback non suo né di una sua sessione lo mette solo lui, in Gestione, dal dettaglio della pratica. Da riga di comando non si può';

/** Il segno messo da qui non manda la fusione già ferma: la manda Gestione (#701). */
export const FUSIONE_FERMA_DA_GESTIONE = 'Una fusione già ferma su questa pratica non parte da qui: la manda Gestione appena vede il segno (subito, se è aperta) e lì ne leggi l’esito. Se è ferma per blocchi nuovi, aspetta il tuo sì.';

/** «910», «#910», «22.1»: un numero di feedback, non un id. PURA. */
export function numeroDiFeedback(riferimento) {
  return !!parseRiferimento(riferimento).seq;
}

/**
 * Il numero (#910, 910, #22.1) vale come nella lettura, nella verifica e nella chiusura: la sessione ha quello.
 * Un id passa così com'è. @returns {Promise<{ ok: true, id: string } | { ok: false, motivo: string }>}
 */
export async function idDelFeedback(riferimento, { bearer, base = FIRESTORE_BASE, fetchImpl = fetch } = {}) {
  if (!numeroDiFeedback(riferimento)) return { ok: true, id: String(riferimento) };
  const r = await risolviFeedback(riferimento, { bearer, base, fetchImpl });
  return r.ok ? { ok: true, id: r.id } : { ok: false, motivo: r.motivo };
}

/** La priorità da scrivere: una della scala, mai assente (chi scrive --priorita ne vuole una). PURA. */
export function prioritaDaScrivere(raw) {
  const p = parsePriorita(raw);
  if (!p.ok) return p;
  if (p.valore === null) return { ok: false, motivo: `--priorita vuole un valore: ammessi ${PRIORITA_AMMESSE.join(', ')}` };
  return p;
}

/** Cifrata come in Gestione (SN_FEEDBACK.updateStatus); senza cifratura non si scrive, mai in chiaro (#602). */
async function prioritaCifrata(valore) {
  if (!CRYPTO?.isEnabled?.()) return { ok: false, motivo: 'manca la chiave con cui si cifra: la priorità in chiaro, su un documento pubblico, non la scrivo' };
  try {
    const cifrata = await CRYPTO.encryptForOwner(String(valore));
    if (!CRYPTO.isEncrypted(cifrata)) return { ok: false, motivo: 'la priorità non risulta cifrata: non la scrivo' };
    return { ok: true, valore: cifrata };
  } catch (e) {
    return { ok: false, motivo: `cifratura della priorità fallita: ${e?.message || e}` };
  }
}

/** La priorità che c'era, per dire «era N». null se non c'era o non si legge (senza chiave privata). */
async function prioritaPrecedente(doc) {
  const f = doc?.fields?.priority;
  if (!f) return null;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (!CRYPTO?.isEncrypted?.(f.stringValue)) return null;
  try {
    const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
    const dec = await decryptFeedbackFields({ _id: doc.name, priority: f.stringValue });
    return Number.isInteger(dec.priority) ? dec.priority : null;
  } catch (_) { return null; }
}

/**
 * Solo la priorità, stato invariato (`<n|id> --priorita 3`): i campi del pallino di Gestione. Nessun controllo
 * sullo stato: un riordino non sposta la pratica, e i Ricevuti si riordinano come il resto.
 * @returns {Promise<{ ok: true, a: number, prima: number|null, dryRun?: true, campi?: string[] } | { ok: false, motivo: string }>}
 */
export async function scriviPriorita(id, raw, opts = {}) {
  const p = prioritaDaScrivere(raw);
  if (!p.ok) return p;
  const cifrata = await prioritaCifrata(p.valore);
  if (!cifrata.ok) return cifrata;
  const bearer = opts.bearer || await acquireBearer();
  // Letto prima: una PATCH su un id che non c'è creerebbe un documento.
  const doc = await getDoc(id, bearer, ['priority']);
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };
  const prima = await prioritaPrecedente(doc);
  const fields = { priority: { stringValue: cifrata.valore }, priorityManual: { booleanValue: true }, updatedAt: firmaOra() };
  const campi = Object.keys(fields);
  if (opts.dryRun) return { ok: true, dryRun: true, a: p.valore, prima, campi };
  const res = await patchFirmato(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?${campi.map((m) => `updateMask.fieldPaths=${m}`).join('&')}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  }, { fetchImpl: fetchRitentato });
  if (!res.ok) return { ok: false, motivo: `scrittura fallita (${res.status}): ${(await res.text()).slice(0, 200)}` };
  return { ok: true, a: p.valore, prima };
}

// Come li legge chi lancia la prova a vuoto: il valore che avrebbero, non solo il nome.
const CAMPI_SPIEGATI = Object.freeze({ priority: 'cifrata', priorityManual: 'true, decisa a mano', updatedAt: 'adesso' });
export function campiLeggibili(campi, priorita) {
  return (campi || []).map((c) => {
    if (c === 'priority' && Number.isInteger(priorita)) return `priority (${priorita}, cifrata)`;
    return CAMPI_SPIEGATI[c] ? `${c} (${CAMPI_SPIEGATI[c]})` : c;
  }).join(', ');
}

/** Cosa stampa `<n|id> --priorita N`, a vuoto o per davvero. PURA. */
export function messaggioPriorita(rif, r) {
  const era = r.prima === null || r.prima === undefined ? '' : r.prima === r.a ? `, era già ${r.prima}` : `, era ${r.prima}`;
  if (r.dryRun) return `(prova a vuoto) ${rif}: priorità ${r.a}${era}; stato invariato. Campi che scriverei: ${campiLeggibili(r.campi, r.a)}`;
  return `OK: ${rif} a priorità ${r.a}${era}. Decisa a mano: il giudice non la cambia. Stato invariato.`;
}

/** La versione in costruzione: è quella in cui un fix confluisce. */
function packageVersion() {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).version || '';
  } catch (_) { return ''; }
}

// `campi`: i soli campi che chi chiama guarda. Senza maschera qui arrivava la
// segnalazione INTERA — testo cifrato, note, allegati — per leggerne due (#680).
async function getDoc(id, bearer, campi = null) {
  const maschera = (Array.isArray(campi) && campi.length)
    ? `?${campi.map((f) => `mask.fieldPaths=${encodeURIComponent(f)}`).join('&')}` : '';
  const res = await fetchRitentato(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}${maschera}`, {
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
 * L'owner fa un passo solo: le sue righe sono le azioni delle pagine, e una catena
 * (archivia poi ripristina) inventerebbe un passaggio che nessuna pagina offre (#776).
 * Come routine vale la catena: chiudendo a mano si salta da todo a done.
 */
export function transizioneAmmessa(from, to, attore = 'owner') {
  if (!FS.isCanonical(from)) return { ok: false, motivo: `stato di partenza non riconosciuto ("${from}")` };
  if (from === to) return { ok: true };
  const ammessa = attore === 'owner' ? FS.canTransition(from, to, 'owner') : FS.canReach(from, to, attore);
  if (!ammessa) return { ok: false, motivo: `${from} → ${to} non è un passaggio permesso` };
  return { ok: true };
}

/**
 * Scrive la decisione. Ritorna { ok, from, to } oppure { ok:false, motivo }.
 */
/** Le note esistenti, in chiaro: la fusione non si fa mai sul cifrato. */
async function notePrecedentiInChiaro(doc) {
  const grezzo = doc.fields?.notes?.stringValue || '';
  if (!CRYPTO?.isEncrypted?.(grezzo)) return grezzo;
  try {
    const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');
    const dec = await decryptFeedbackFields({ _id: doc.name, notes: grezzo });
    const chiaro = String(dec.notes || '');
    // Se non si decifra, meglio ripartire dal solo testo nuovo che appiccicare
    // un blob illeggibile davanti: quello che c'era resta comunque perso, ma
    // almeno quello che scrivi adesso si legge.
    // Due forme di "non si legge", non una: il testo cifrato così com'è e il
    // SEGNAPOSTO che l'helper mette quando ha provato a decifrare e non ci è
    // riuscito. Riconoscerne una sola vuol dire fondere il segnaposto dentro la
    // conversazione e ricifrarcelo sopra.
    return THREAD?.reportUnreadable?.(chiaro) ? '' : chiaro;
  } catch (_) { return ''; }
}

export async function scrivi(id, to, nota, opts = {}) {
  if (!ALLOWED.includes(to)) return { ok: false, motivo: `stato non valido: "${to}"` };
  // Il segno «fondi senza chiedermelo» vale solo a pratica aperta: metterlo
  // nello stesso comando che la chiude lo scriverebbe senza che conti (e
  // tornerebbe a valere a una riapertura). Stesso rifiuto della forma senza
  // stato (segnaPreapprovazione), prima di toccare la rete.
  if (opts.preapprova === true && statusToPublic && statusToPublic(to) === 'closed') {
    return { ok: false, motivo: `lo stato «${to}» chiude la pratica: il segno «fondi senza chiedermelo» non conterebbe. Ometti --preapprova (o usa --chiedi-prima).` };
  }
  if (typeof opts.frase === 'string') {
    const lunga = fraseTroppoLunga(opts.frase.trim());
    if (lunga) return { ok: false, motivo: lunga };
  }
  let priorita = null;
  if (opts.priorita !== undefined) {
    const p = prioritaDaScrivere(opts.priorita);
    if (!p.ok) return p;
    const cifrata = await prioritaCifrata(p.valore);
    if (!cifrata.ok) return cifrata;
    priorita = cifrata.valore;
  }
  const bearer = opts.bearer || await acquireBearer();
  // La pratica coi campi di ogni altro passaggio (CAMPI_PRATICA: senza il sì dell'owner un approvato
  // sembra un utente, #913) più le note da fondere. La lettura va nel conto di chi ci ha mandato qui (#680).
  const doc = await getDoc(id, bearer, [...CAMPI_PRATICA, 'notes']);
  if (opts.letture) opts.letture.aggiungi(1, 'segnalazioni riscritte');
  if (!doc) return { ok: false, motivo: `feedback ${id} inesistente` };

  const { from, leggibile } = await statoAttuale(doc);
  if (!leggibile) {
    // In dubbio ci si ferma: applicare senza sapere da dove si parte è
    // esattamente ciò che il vecchio automatismo faceva "per prudenza".
    return { ok: false, motivo: 'stato attuale non decifrabile: non posso sapere se il passaggio è legale' };
  }
  const vietata = partenzaVietata(from);
  if (vietata) return { ok: false, motivo: vietata, from };
  const lavoro = from === to ? null : await lavoroVietato(doc, to);
  if (lavoro) return { ok: false, motivo: lavoro.motivo, utente: lavoro.utente, routine: lavoro.routine, senzaProva: lavoro.senzaProva, senzaSegno: lavoro.senzaSegno, from };
  if (opts.preapprova === true) {
    const segno = preapprovaVietata(await praticaInChiaro(doc));
    if (segno) return { ok: false, motivo: segno, from };
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

  // I DUE TESTI (spec ROUTINE-AUTH-SPEC.md §8): il report per te viaggia
  // cifrato, la frase per chi ha mandato il feedback resta in chiaro — la legge
  // sulla sua macchina, che la chiave non ce l'ha.
  if (typeof nota === 'string' && nota.trim()) {
    // Si fonde e si taglia sul testo IN CHIARO, poi si cifra.
    const esistenti = await notePrecedentiInChiaro(doc);
    const fuse = THREAD ? THREAD.mergeModelReport(esistenti, nota) : nota;
    const capped = THREAD?.capNotes ? THREAD.capNotes(fuse) : fuse;
    if (CRYPTO?.isEnabled?.()) {
      try { set('notes', await CRYPTO.encryptForOwner(capped)); }
      catch (e) { return { ok: false, motivo: `cifratura del report fallita: ${e?.message || e}` }; }
    } else {
      set('notes', capped);
    }
  }
  if (typeof opts.frase === 'string' && opts.frase.trim()) {
    set('userNote', opts.frase.trim());
  }
  if (typeof opts.branch === 'string') set('branch', opts.branch.slice(0, 200));
  if (typeof opts.reason === 'string') {
    set('statusReason', opts.reason.slice(0, 60));
    set('blockReason', opts.reason.slice(0, 60));
  }
  if (typeof opts.starred === 'boolean') set('starred', opts.starred);
  if (priorita) {
    set('priority', priorita);
    set('priorityManual', true);
  }
  // Il segno «fondi senza chiedermelo» insieme al cambio di stato: stessa
  // forma di segnaPreapprovazione. Toglierlo = cancellare il campo.
  if (typeof opts.preapprova === 'boolean') {
    if (opts.preapprova) set('mergePreapproved', { by: chiScrive(bearer), at: new Date().toISOString() });
    else mask.push('mergePreapproved');
  }
  if (to === 'done') set('resolvedInVersion', packageVersion());
  // Una consegna reale azzera il contatore delle interruzioni.
  if (to !== 'working' && to !== 'todo') set('workingResets', 0);

  mask.push('updatedAt');
  fields.updatedAt = firmaOra();

  if (opts.dryRun) return { ok: true, from, to, dryRun: true, campi: mask };

  const q = mask.map((m) => `updateMask.fieldPaths=${m}`).join('&');
  const res = await patchFirmato(`${FIRESTORE_BASE}/feedback/${encodeURIComponent(id)}?${q}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ fields }),
  }, { fetchImpl: fetchRitentato });
  if (!res.ok) return { ok: false, motivo: `scrittura fallita (${res.status}): ${(await res.text()).slice(0, 200)}` };
  return { ok: true, from, to };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

const isMain = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  let argv = process.argv.slice(2);
  const flag = (nome) => {
    const i = argv.indexOf(`--${nome}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  // Come nello strumento gemello (#565), con lo stesso controllo: un'opzione
  // scritta male non deve scalare sui posizionali e far partire lo stesso il
  // cambio di stato. `--help` è legittima: chiedere aiuto non è un errore.
  const uso = () => {
    console.error('Uso: node scripts/owner-feedback.mjs <numero|id> <status> "nota" [--branch <nome>] [--reason <slug>] [--frase "riga per chi ha segnalato"] [--priorita <0-3>] [--starred|--unstar] [--preapprova|--chiedi-prima] [--come-routine] [--dry-run]');
    console.error('     node scripts/owner-feedback.mjs <numero|id> --preapprova | --chiedi-prima   (solo il segno, stato invariato)');
    console.error('     node scripts/owner-feedback.mjs <numero|id> --frase "riga per chi ha segnalato"   (solo la frase, stato invariato)');
    console.error('     node scripts/owner-feedback.mjs <numero|id> --priorita <0-3>              (solo la priorità, decisa a mano: stato invariato, anche nei Ricevuti)');
    console.error('     node scripts/owner-feedback.mjs <numero|id> --solo-locale | --non-locale    (segno «solo in locale», stato invariato)');
    console.error('     node scripts/owner-feedback.mjs <numero|id> --serve-locale ["perché"]       (feedback di un utente → Ricevuti, «richiede lavoro locale»)');
    console.error('     node scripts/owner-feedback.mjs <numero|id> --aspetta 676,663.2 | --aspetta-niente   (attese, stato invariato)');
    console.error(`     status ∈ ${ALLOWED.join(' | ')}`);
  };
  if (argv.includes('--help') || argv.includes('-h')) { uso(); process.exit(0); }
  // Prima delle credenziali e del controllo sulle opzioni, che la direbbe solo «sconosciuta»; npm se la mangia nell'ambiente.
  for (const [tolta, dove] of [['approva-locale', SOLO_DA_GESTIONE], ['riconosci', SOLO_DA_GESTIONE_MIO]]) {
    if (argv.some((a) => new RegExp(`^--${tolta}(=|$)`).test(a)) || process.env[`npm_config_${tolta.replace(/-/g, '_')}`] !== undefined) {
      console.error(`RIFIUTATO: --${tolta} non c'è più. ${dove} Non ho toccato niente.`);
      process.exit(1);
    }
  }
  const { controllaArgomenti, argomentiDaNpm, espandiUguali, opzioneStorpiata } = await import('./lib/argomenti.mjs');
  const OPZ = {
    opzioni: ['--branch', '--reason', '--frase', '--priorita', '--dry-run', '--come-routine', '--starred', '--unstar', '--preapprova', '--chiedi-prima',
      '--solo-locale', '--non-locale', '--serve-locale', '--aspetta', '--aspetta-niente'],
    conValore: ['--branch', '--reason', '--frase', '--priorita', '--aspetta'],
  };
  argv = espandiUguali(argv, OPZ.conValore);
  const storpiata = opzioneStorpiata(process.env, OPZ.opzioni);
  if (storpiata) {
    console.error(`RIFIUTATO: ${storpiata}`);
    uso();
    process.exit(1);
  }
  const daNpm = argomentiDaNpm(process.env, OPZ);
  if (daNpm.errore) {
    console.error(`RIFIUTATO: ${daNpm.errore}`);
    uso();
    process.exit(1);
  }
  if (daNpm.nota) { console.error(daNpm.nota); argv = [...argv, ...daNpm.args]; }
  const male = controllaArgomenti(argv, OPZ);
  if (male) {
    console.error(`RIFIUTATO: ${male}`);
    process.exit(1);
  }
  const branch = flag('branch');
  const reason = flag('reason');
  const frase = flag('frase');
  const dryRun = argv.includes('--dry-run');
  const attore = argv.includes('--come-routine') ? 'routine' : 'owner';
  let starred;
  if (argv.includes('--starred')) starred = true;
  else if (argv.includes('--unstar')) starred = false;
  let preapprova;
  if (argv.includes('--preapprova')) preapprova = true;
  else if (argv.includes('--chiedi-prima')) preapprova = false;

  // Per POSTO, non per valore: come nello strumento gemello (#565). Prima si
  // toglievano le parole «uguali al valore di un'opzione», e una nota scritta
  // identica alla frase per chi ha segnalato spariva senza dire niente.
  const CON_VALORE = new Set(OPZ.conValore);
  const posizionali = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { if (CON_VALORE.has(a)) i += 1; continue; }
    posizionali.push(a);
  }
  const [riferimento, status, ...nota] = posizionali;

  // Prima delle credenziali: un valore sbagliato o un'accoppiata che lascerebbe cadere la priorità non tocca niente.
  let priorita;
  if (argv.includes('--priorita')) {
    const p = prioritaDaScrivere(flag('priorita'));
    if (!p.ok) { console.error(`RIFIUTATO: ${p.motivo} — non ho toccato niente.`); process.exit(1); }
    priorita = p.valore;
    const conStato = ['--frase', '--branch', '--reason', '--starred', '--unstar', '--preapprova', '--chiedi-prima', '--come-routine'];
    const altre = ['--solo-locale', '--non-locale', '--serve-locale', '--aspetta', '--aspetta-niente', ...(status ? [] : conStato)].filter((o) => argv.includes(o));
    if (altre.length) {
      console.error(`RIFIUTATO: --priorita ${status ? 'non va' : 'senza stato va da sola, non'} con ${altre.join(' ')}: lancia un comando per ciascuno — non ho toccato niente.`);
      process.exit(1);
    }
  }

  // Un comando senza stato fa una cosa sola: ogni altra opzione andrebbe persa in silenzio, quindi si rifiuta.
  // --serve-locale prende la posizione dello stato per il suo perché, e vale come comando senza stato.
  if (!status || argv.includes('--serve-locale')) {
    const soloConStato = ['--branch', '--reason', '--come-routine', '--starred', '--unstar'].filter((o) => argv.includes(o));
    if (soloConStato.length) {
      console.error(`RIFIUTATO: ${soloConStato.join(' ')} vale solo insieme a uno stato (<n> <stato> "nota"): senza, non lo scriverei — non ho toccato niente.`);
      process.exit(1);
    }
    const comandi = [['--frase'], ['--preapprova', '--chiedi-prima'], ['--solo-locale', '--non-locale', '--serve-locale'], ['--aspetta', '--aspetta-niente']]
      .map((g) => g.find((o) => argv.includes(o))).filter(Boolean);
    if (comandi.length > 1) {
      console.error(`RIFIUTATO: ${comandi.join(' e ')} sono due comandi: lancia un comando per ciascuno — non ho toccato niente.`);
      process.exit(1);
    }
  }

  // #914: le routine non aprono lavoro locale; quello che si fa solo in locale lo rimandano dal canale.
  if (argv.includes('--solo-locale') && isRoutineInstance(ROOT)) {
    console.error('RIFIUTATO: una routine non segna lavoro locale. Rimandalo nei Ricevuti: node scripts/routine-channel.mjs deliver status --status design --reason locale --notes "perché" — non ho toccato niente.');
    process.exit(3);
  }

  let id = riferimento;
  let bearer;
  if (riferimento && numeroDiFeedback(riferimento)) {
    bearer = await acquireBearer();
    const r = await idDelFeedback(riferimento, { bearer });
    if (!r.ok) { console.error(`RIFIUTATO: ${r.motivo} — non ho toccato niente.`); process.exit(3); }
    id = r.id;
  }

  // Le attese (#903): da sole, senza stato. Il valore di --aspetta è uno solo: «676,663.2» (o fra virgolette, con gli spazi).
  const attese = ['--aspetta', '--aspetta-niente'].filter((o) => argv.includes(o));
  if (attese.length) {
    if (!id) { uso(); process.exit(1); }
    if (attese.length > 1) { console.error('RIFIUTATO: --aspetta e --aspetta-niente insieme — non ho toccato niente.'); process.exit(1); }
    if (status) {
      console.error(`RIFIUTATO: ${attese[0]} va da solo, senza stato né nota — non ho toccato niente.`);
      process.exit(1);
    }
    const valore = attese[0] === '--aspetta' ? String(flag('aspetta') || '') : '';
    if (attese[0] === '--aspetta' && !valore.trim()) { console.error('RIFIUTATO: --aspetta vuole i numeri (--aspetta 676,663.2); per toglierle --aspetta-niente.'); process.exit(1); }
    const r = await segnaAttese(id, valore, { dryRun, bearer });
    if (!r.ok) { console.error(`RIFIUTATO: ${r.motivo} — non ho toccato niente.`); process.exit(3); }
    const elenco = globalThis.SN_FB_ATTESE.testoAttese(r.attese);
    console.log(r.dryRun
      ? `[dry-run] ${riferimento}: ${r.attese.length ? `scriverei «aspetta ${elenco}»` : 'toglierei le attese'}, stato invariato`
      : r.attese.length
        ? `${riferimento}: aspetta ${elenco}. Nessuna routine lo prende finché non sono tutti fusi; poi entra in coda da solo.`
        : `${riferimento}: non aspetta più niente.`);
    process.exit(0);
  }

  // Il segno «solo in locale» e il ritorno nei Ricevuti: da soli, senza stato.
  const locali = ['--solo-locale', '--non-locale', '--serve-locale'].filter((o) => argv.includes(o));
  if (locali.length > 1) { console.error(`RIFIUTATO: ${locali.join(' e ')} insieme — non ho toccato niente.`); process.exit(1); }
  if (locali.length === 1) {
    if (!id) { uso(); process.exit(1); }
    if (locali[0] === '--serve-locale') {
      const r = await serveLocale(id, [status, ...nota].filter(Boolean).join(' '), { dryRun, bearer });
      if (!r.ok) { console.error(`RIFIUTATO: ${r.motivo}`); process.exit(3); }
      console.log(r.dryRun
        ? `(prova a vuoto) ${r.from} → design, «richiede lavoro locale»; campi: ${r.campi.join(', ')}`
        : `OK: ${riferimento} torna nei Ricevuti (design, «richiede lavoro locale»): decide l'owner.`);
      process.exit(0);
    }
    if (status) { console.error(`RIFIUTATO: ${locali[0]} va da solo, senza stato né nota — non ho toccato niente.`); process.exit(1); }
    const valore = locali[0] === '--solo-locale';
    const r = await segnaLocale(id, valore, { dryRun, bearer });
    if (!r.ok) {
      console.error(rifiutoPratica(riferimento, r));
      process.exit(3);
    }
    if (valore && r.chiusa && !r.tieneScheda) {
      console.log(r.dryRun
        ? `[dry-run] ${riferimento}: è chiusa; la segnerei come lavoro locale e toglierei la sua scheda dalla bacheca pubblica`
        : `${riferimento}: segnata come lavoro locale${r.scheda ? `, ma ${r.scheda}` : ', fuori dalla bacheca pubblica'}.`);
      process.exit(r.scheda ? 3 : 0);
    }
    if (!valore && r.chiusa && !r.tieneScheda) {
      console.log(r.dryRun
        ? `[dry-run] ${riferimento}: è chiusa; toglierei il segno «solo in locale», e la sua scheda tornerebbe nella bacheca pubblica alla prossima sincronizzazione`
        : `${riferimento}: non è più un lavoro locale; la sua scheda torna nella bacheca pubblica alla prossima sincronizzazione.`);
      process.exit(0);
    }
    console.log(r.dryRun
      ? `[dry-run] ${riferimento}: ${valore ? 'metterei' : 'toglierei'} il segno «solo in locale»`
      : `${riferimento}: ${valore ? `da ora la lavora solo una sessione locale (segno di ${r.segno.by})` : 'da ora la possono prendere anche le routine'}`);
    process.exit(0);
  }

  // Solo la priorità, stato invariato: `<id> --priorita 3`.
  if (id && !status && priorita !== undefined) {
    const r = await scriviPriorita(id, priorita, { dryRun, bearer });
    if (!r.ok) { console.error(`RIFIUTATO: ${r.motivo} — non ho toccato niente.`); process.exit(3); }
    console.log(messaggioPriorita(riferimento, r));
    process.exit(0);
  }

  // Solo la frase per chi ha segnalato, stato invariato: `<id> --frase "…"`.
  if (id && !status && typeof frase === 'string') {
    const r = await scriviFrase(id, frase, { dryRun, bearer });
    if (!r.ok) { console.error(`RIFIUTATO: ${r.motivo} — non ho toccato niente.`); process.exit(3); }
    console.log(r.dryRun
      ? `[dry-run] ${riferimento}: scriverei la frase per chi ha segnalato, stato invariato`
      : `${riferimento}: frase per chi ha segnalato scritta; la bacheca la mostra alla prossima sincronizzazione.`);
    process.exit(0);
  }

  // Solo il segno, stato invariato: `<id> --preapprova` / `<id> --chiedi-prima`.
  if (id && !status && typeof preapprova === 'boolean') {
    const r = await segnaPreapprovazione(id, preapprova, { dryRun, bearer });
    if (!r.ok) { console.error(`RIFIUTATO: ${r.motivo}`); process.exit(3); }
    console.log(r.dryRun
      ? `[dry-run] ${riferimento}: ${preapprova ? 'metterei' : 'toglierei'} il segno «fondi senza chiedermelo» (${r.campi.join(', ')})`
      : `${riferimento}: ${preapprova ? `da ora si fonde senza chiedere (segno di ${r.segno.by})` : 'da ora ti chiede prima di fondere'}`);
    if (preapprova && !r.dryRun) console.log(FUSIONE_FERMA_DA_GESTIONE);
    process.exit(0);
  }

  if (!id || !status) {
    uso();
    process.exit(1);
  }

  const r = await scrivi(id, status, nota.join(' '), { branch, reason, frase, starred, preapprova, priorita, dryRun, attore, bearer });
  if (!r.ok) {
    console.error(r.utente || r.senzaSegno ? rifiutoPratica(riferimento, r) : `RIFIUTATO: ${r.motivo}`);
    if (attore === 'owner' && /non è un passaggio permesso/.test(r.motivo || '')) {
      console.error('Se stai chiudendo a mano una pratica dell\'iter di lavorazione, aggiungi --come-routine.');
    }
    if (priorita !== undefined && r.from && partenzaVietata(r.from)) {
      console.error(`La sola priorità si cambia anche da lì, senza spostarla: npm run feedback -- ${String(riferimento).replace(/^#+/, '')} --priorita ${priorita}`);
    }
    process.exit(3);
  }
  console.log(r.dryRun
    ? `(prova a vuoto) ${r.from} → ${r.to}; campi che scriverei: ${campiLeggibili(r.campi, priorita)}`
    : `OK: ${riferimento} da "${r.from}" a "${r.to}"${priorita !== undefined ? `, priorità ${priorita} decisa a mano` : ''}.`);
  if (preapprova === true && !r.dryRun) console.log(FUSIONE_FERMA_DA_GESTIONE);
  // Come la chiusura di finish e di server:fondi (#913): la chiusura a mano è quella di un lavoro senza fusione.
  if (!r.dryRun && r.to === 'done' && !(typeof frase === 'string' && frase.trim())) {
    const promemoria = await fraseDaScrivere(id, riferimento, { bearer });
    if (promemoria) console.log(`\n${promemoria}`);
  }
}
