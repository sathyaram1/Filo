// Selettore isolato del prossimo feedback da lavorare.
//
// PERCHÉ ESISTE
//   L'orchestratore deve consegnare a ogni worker LLM UN SOLO feedback (mai
//   la lista intera): un worker che vede tutti i feedback potrebbe essere
//   pilotato da un body malevolo verso la scelta "sbagliata" (prompt-injection
//   sull'ordinamento). Questo script è NON-LLM: riceve la chiave privata via
//   env, decifra le priorità in locale, ordina, e stampa SOLO il vincitore.
//
// ISOLAMENTO
//   - I perdenti NON vengono decifrati nel corpo: per loro si usa solo la
//     priorità (per ordinare) e lo status (per filtrare). Niente testo.
//   - La chiave privata non viene mai passata a un LLM.
//
// USO
//   node scripts/next-feedback.mjs
//
//   Stdout: JSON dell'oggetto feedback vincitore, con tutti i campi decifrati.
//   Stderr: messaggi di diagnostica.
//   Exit 0 → vincitore trovato (stdout è il JSON).
//   Exit 2 → coda vuota (nessun feedback da lavorare).
//   Exit 1 → errore di rete/sistema.

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// ─── Costanti Firestore (specchio di src/shared/feedback.js) ─────────────────

const PROJECT_ID = 'filo-8b9cb';
const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
const COLLECTION = 'feedback';
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// ─── Helpers REST (specchio di src/shared/feedback.js) ───────────────────────

function fromFsValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) return (val.arrayValue.values || []).map(fromFsValue);
  if ('mapValue' in val) {
    const out = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) out[k] = fromFsValue(v);
    return out;
  }
  return null;
}

function fsDocToObject(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFsValue(v);
  out._id = doc.name?.split('/').pop() || '';
  out._createTime = doc.createTime || null;
  return out;
}

// ─── Logica pura di ordinamento/selezione (esportata, testabile) ─────────────

/**
 * Regola di DIPENDENZA fra sub-feedback (#N.1, #N.2, …): quando una spec viene
 * spezzata in figli, l'ordine di creazione È l'ordine di lavorazione (x.1 prima
 * di x.2). Il vincolo è imposto QUI, non-LLM — non nel testo dei feedback:
 *
 *   - un figlio #N.k è eleggibile SOLO se nessun fratello precedente #N.j (j<k)
 *     è ancora aperto (todo/review/clarify/blocked/claimato: qualunque cosa non
 *     sia chiusa). "Chiuso" = non compare più fra i doc open di Firestore.
 *   - un top-level #N con figli ancora aperti NON è eleggibile (es. il feedback
 *     "ombrello" che traccia una spec: si lavora solo quando i figli sono done).
 *   - i feedback senza numero non hanno vincoli (nessuna famiglia).
 *
 * NB: un figlio NON è bloccato dal proprio padre aperto (il padre-tracker resta
 * open per tutta la durata della famiglia, per costruzione).
 *
 * @param {Array<{ _id: string, seq?: number, subSeq?: number }>} candidates
 *   I candidati lavorabili (todo, non claimati).
 * @param {Array<{ _id: string, seq?: number, subSeq?: number }>} openAll
 *   TUTTI i feedback ancora aperti (qualunque status, claimati compresi):
 *   sono i potenziali "blocchi" delle dipendenze.
 * @returns {Array} I candidati senza predecessori aperti.
 */
export function filterEligible(candidates, openAll) {
  const all = Array.isArray(openAll) ? openAll : [];
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  // subSeq "vero" solo se >= 1: l'applier scrive subSeq: 0 sui TOP-LEVEL
  // (non assente!), quindi 0 = "non è un figlio", mai un figlio ".0".
  const subOf = (v) => { const n = num(v); return n !== null && n >= 1 ? n : null; };
  return (Array.isArray(candidates) ? candidates : []).filter((c) => {
    const seq = num(c.seq);
    if (seq === null) return true;
    const sub = subOf(c.subSeq);
    for (const o of all) {
      if (!o || o._id === c._id) continue;
      if (num(o.seq) !== seq) continue;
      const oSub = subOf(o.subSeq);
      if (oSub === null) continue;                 // il padre aperto non blocca
      if (sub === null) return false;              // padre con figlio aperto
      if (oSub < sub) return false;                // fratello precedente aperto
    }
    return true;
  });
}

/**
 * Seleziona il feedback vincitore da un array di candidati già filtrati
 * (status = todo, non claimati, dipendenze soddisfatte via filterEligible,
 * priority già decifrata a numero).
 *
 * Ordinamento:
 *   1. priority DESC (numero più alto prima; undefined/NaN → 0)
 *   2. FIFO a parità: createdAt ASC (ISO string, confronto lessicografico)
 *   3. seq ASC a parità di createdAt (feedback senza createdAt)
 *   4. subSeq ASC a parità di seq (i sub-feedback nell'ordine della famiglia)
 *   5. _id ASC come ultimo tie-break deterministico
 *
 * @param {Array<{ _id: string, priority?: number, createdAt?: string, seq?: number, subSeq?: number, claimed?: boolean }>} candidates
 *   Array di feedback con priority GIÀ decifrata (numero) e claimed già calcolato.
 *   I candidati con claimed=true vengono scartati.
 * @returns {string|null} L'_id del vincitore, oppure null se la coda è vuota.
 */
export function selectWinner(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;

  // Scarta i claimati.
  const free = candidates.filter((c) => !c.claimed);
  if (!free.length) return null;

  // Estrae il numero di priorità in modo sicuro (fallback a 0 su NaN/undefined).
  function priorityOf(c) {
    const n = Number(c.priority);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  }

  // Copia e ordina.
  const sorted = [...free].sort((a, b) => {
    // 1. priority DESC
    const pa = priorityOf(a);
    const pb = priorityOf(b);
    if (pb !== pa) return pb - pa;

    // 2. createdAt ASC (ISO string — confronto lessicografico corretto)
    const ca = typeof a.createdAt === 'string' ? a.createdAt : '';
    const cb = typeof b.createdAt === 'string' ? b.createdAt : '';
    if (ca && cb && ca !== cb) return ca < cb ? -1 : 1;
    // Un feedback con createdAt va prima di uno senza.
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;

    // 3. seq ASC (più vecchio = numero più basso)
    const sa = Number(a.seq);
    const sb = Number(b.seq);
    const hasSa = Number.isFinite(sa);
    const hasSb = Number.isFinite(sb);
    if (hasSa && hasSb && sa !== sb) return sa - sb;
    if (hasSa && !hasSb) return -1;
    if (!hasSa && hasSb) return 1;

    // 4. subSeq ASC (fratelli della stessa famiglia: #N.1 prima di #N.2 anche
    //    se creati nello stesso millisecondo — createdAt identico)
    const ba = Number(a.subSeq);
    const bb = Number(b.subSeq);
    const hasBa = Number.isFinite(ba);
    const hasBb = Number.isFinite(bb);
    if (hasBa && hasBb && ba !== bb) return ba - bb;
    if (hasBa && !hasBb) return 1;   // il padre (senza subSeq) prima dei figli
    if (!hasBa && hasBb) return -1;

    // 5. _id ASC come tie-break finale (deterministico)
    const ia = String(a._id || '');
    const ib = String(b._id || '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });

  return sorted[0]._id;
}

// ─── Parte di rete (thin) ─────────────────────────────────────────────────────

/**
 * Scarica da Firestore i candidati con statusPublic == 'open'.
 * NOTA: 'open' include todo, new, draft, clarify, review, blocked.
 * Filtriamo ulteriormente per status == 'todo' DOPO la decifratura.
 *
 * @returns {Promise<object[]>} Array di oggetti feedback (non decifrati).
 */
export async function fetchOpenCandidates() {
  const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: COLLECTION }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'statusPublic' },
          op: 'EQUAL',
          value: { stringValue: 'open' },
        },
      },
      // Non ordiniamo per priority server-side (è cifrata) né per createdAt
      // (vogliamo tutti i candidati e ordiniamo lato client). Usiamo un limit
      // generoso: in alpha il volume è basso; se cresce, ridurre via paginazione.
      limit: 500,
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Firestore runQuery fallito (${res.status}): ${errText.slice(0, 300)}`);
  }

  const arr = await res.json();
  const out = [];
  for (const row of arr) {
    if (!row.document) continue;
    out.push(fsDocToObject(row.document));
  }
  return out;
}

/**
 * Punto di ingresso principale.
 * Stampa su stdout il JSON del feedback vincitore (decifrato), oppure esce
 * con codice 2 se la coda è vuota.
 */
/**
 * Uscita "non ho lavoro da dare", con la distinzione che §E della spec
 * ROUTINE-BRANCH-INTEGRITY.md chiede: exit 2 = coda DAVVERO vuota (il ciclo si
 * ferma sereno); exit 3 = GUASTO, la coda è illeggibile e "vuota" è solo ciò
 * che sembra. Il chiamante (dispatch) non ripiega su un exit 3: lo propaga.
 *
 * Con status non decifrabili non possiamo AFFERMARE che la coda sia vuota — il
 * vincitore poteva essere fra quelli. Se invece del lavoro l'abbiamo trovato,
 * non passiamo di qui e il ciclo procede: un singolo documento corrotto non
 * deve fermare le routine. La firma della chiave assente è che siano
 * illeggibili TUTTI, e in quel caso di lavorabili non ne resta nessuno.
 */
function exitEmpty(reason, unreadable, total) {
  if (unreadable) {
    process.stderr.write(`[next-feedback] GUASTO: ${unreadable}/${total} status non decifrabili e ${reason}: non posso distinguere "coda vuota" da "coda illeggibile". Controlla la chiave privata (FILO_FEEDBACK_PRIVKEY).\n`);
    process.exit(3);
  }
  process.stderr.write(`[next-feedback] ${reason}\n`);
  process.exit(2);
}

export async function run() {
  // Carica feedbackCrypto (IIFE su globalThis) — necessario per decryptFeedbackFields.
  // Carichiamo qui (non al top-level) per non inquinare i test che iniettano mock.
  try {
    if (!globalThis.SN_FEEDBACK_PUBKEY) {
      require(resolve(ROOT, 'src', 'shared', 'feedbackPublicKey.js'));
    }
    if (!globalThis.SN_FEEDBACK_CRYPTO) {
      require(resolve(ROOT, 'src', 'shared', 'feedbackCrypto.js'));
    }
  } catch (e) {
    process.stderr.write(`[next-feedback] avviso: impossibile caricare crypto (${e?.message || e})\n`);
  }

  const { decryptFeedbackFields } = await import('./lib/decrypt-feedback-fields.mjs');

  // I semafori vivono sul server: questo strumento serve all'owner per vedere
  // cosa c'è in coda, non alle routine per prendersi il lavoro. Quello che il
  // server ha già assegnato lo sa il server.
  const claimed = new Set();

  // 2. Fetch candidati open da Firestore.
  let rawCandidates;
  try {
    rawCandidates = await fetchOpenCandidates();
  } catch (e) {
    process.stderr.write(`[next-feedback] errore Firestore: ${e.message}\n`);
    process.exit(1);
  }

  if (!rawCandidates.length) {
    // Qui la coda è vuota PRIMA di qualsiasi decifratura: non c'è proprio
    // nessun documento aperto, quindi non c'è illeggibilità possibile.
    exitEmpty('nessun feedback da lavorare (coda vuota)', 0, 0);
  }

  // 3. Per ogni candidato: decifra SOLO la priority (e lo status, per filtrare).
  //    NON decifriamo il corpo completo dei perdenti — isolamento massimo.
  //    Decifriamo i campi minimi: priority + status.
  const C = globalThis.SN_FEEDBACK_CRYPTO;

  /**
   * Decifra i soli campi necessari per l'ordinamento/filtro (priority, status).
   * Ritorna { _id, priority: number, status: string, createdAt, seq, claimed }.
   */
  async function decryptMinimal(fb) {
    let priority = fb.priority;
    let status = fb.status;

    // Decifra priority.
    if (C && C.isEncrypted && C.isEncrypted(priority)) {
      try {
        const { decryptFeedbackFields: dec } = await import('./lib/decrypt-feedback-fields.mjs');
        const mini = await dec({ _id: fb._id, priority });
        priority = mini.priority;
      } catch (e) {
        // Decifratura fallita → tratta come priorità minima (non crashare).
        process.stderr.write(`[next-feedback] avviso: priority di ${fb._id} non decifrabile (${e?.message || e}), trattata come 0\n`);
        priority = 0;
      }
    }
    // Normalizza a numero intero.
    const pNum = Number(priority);
    const priorityNum = Number.isFinite(pNum) ? Math.max(0, Math.round(pNum)) : 0;

    // Decifra status (per filtrare solo i 'todo').
    if (C && C.isEncrypted && C.isEncrypted(status)) {
      try {
        const { decryptFeedbackFields: dec } = await import('./lib/decrypt-feedback-fields.mjs');
        const mini = await dec({ _id: fb._id, status });
        status = mini.status;
      } catch (e) {
        process.stderr.write(`[next-feedback] avviso: status di ${fb._id} non decifrabile, escluso\n`);
        status = null;
      }
    }

    return {
      _id: fb._id,
      priority: priorityNum,
      status,
      createdAt: fb.createdAt || null,
      seq: fb.seq,
      subSeq: fb.subSeq,
      claimed: claimed.has(fb._id),
    };
  }

  // Decifra in parallelo i campi minimi di tutti i candidati.
  const minimal = await Promise.all(rawCandidates.map(decryptMinimal));

  // Diagnostica anti "coda fantasma": se gli status non si DECIFRANO (chiave
  // privata assente/rotta) i feedback spariscono dal filtro qui sotto e la coda
  // sembra vuota anche se è piena — e il giro delle routine finisce in audit.
  // Il segnale distingue "coda vuota" da "coda illeggibile" nei log.
  const { PLACEHOLDER } = await import('./lib/decrypt-feedback-fields.mjs');
  const unreadable = minimal.filter((fb) => fb.status === PLACEHOLDER || fb.status === null).length;
  if (unreadable) {
    // Non basta avvisare: con una parte della coda illeggibile, il "vincitore"
    // viene scelto fra i pochi leggibili, e quello vero può benissimo essere fra
    // gli altri. Uscire con successo e un vincitore qualsiasi è la forma
    // peggiore di guasto — quella che sembra un successo. Ci si ferma.
    process.stderr.write(`[next-feedback] GUASTO: ${unreadable}/${minimal.length} status non decifrabili (chiave privata assente o rotta?): non posso scegliere il prossimo feedback su una coda che leggo a metà.\n`);
    process.exit(3);
  }

  // 4. Filtra: solo status == 'todo', non claimati.
  const todoFree = minimal.filter((fb) => fb.status === 'todo' && !fb.claimed);

  if (!todoFree.length) {
    // "Coda vuota" e "coda ILLEGGIBILE" non sono la stessa cosa (spec
    // ROUTINE-BRANCH-INTEGRITY.md §E). Senza chiave privata gli status non si
    // decifrano, i feedback spariscono dal filtro qui sopra e questa funzione
    // rispondeva serenamente "niente da fare": nessun errore, nessun allarme,
    // il giro delle routine finiva in lavoro fantasma (incidente #310+).
    //
    // La soglia è "non posso AFFERMARE che sia vuota": guasto solo quando
    // staremmo per dire "niente da fare" AVENDO status illeggibili — il
    // vincitore poteva essere fra quelli. Con lavoro trovato si procede lo
    // stesso (un singolo documento corrotto non deve fermare il ciclo): la
    // firma della chiave assente è che sono illeggibili TUTTI, e in quel caso
    // di lavorabili non ne resta nessuno e cadiamo qui.
    exitEmpty('nessun feedback da lavorare (nessun todo non claimato)', unreadable, minimal.length);
  }

  // 4b. Dipendenze fra sub-feedback: #N.k è lavorabile solo se i fratelli
  //     precedenti (#N.1..#N.k-1) sono CHIUSI; un top-level con figli aperti
  //     aspetta i figli. I "blocchi" sono TUTTI i doc open (minimal), anche
  //     claimati o non-todo: un fratello in lavorazione o in review blocca
  //     comunque il successivo.
  const eligible = filterEligible(todoFree, minimal);

  if (!eligible.length) {
    // Anche qui l'illeggibilità falsa il risultato, e in modo più subdolo: un
    // fratello con status non decifrabile risulta "aperto" e BLOCCA i
    // successivi, quindi la coda sembra in attesa di predecessori che in realtà
    // sono chiusi.
    exitEmpty('nessun feedback lavorabile: i todo restanti aspettano i predecessori della loro famiglia', unreadable, minimal.length);
  }

  // 5. Seleziona il vincitore (logica pura).
  const winnerId = selectWinner(eligible);
  if (!winnerId) {
    exitEmpty('nessun feedback da lavorare (selectWinner ha tornato null)', unreadable, minimal.length);
  }

  // 6. Decifra SOLO il vincitore nel corpo completo.
  const winnerRaw = rawCandidates.find((fb) => fb._id === winnerId);
  if (!winnerRaw) {
    // Non dovrebbe accadere, ma per robustezza:
    process.stderr.write(`[next-feedback] errore interno: vincitore ${winnerId} non trovato nei candidati raw\n`);
    process.exit(1);
  }

  let winner;
  try {
    winner = await decryptFeedbackFields(winnerRaw);
  } catch (e) {
    process.stderr.write(`[next-feedback] errore decifratura vincitore: ${e.message}\n`);
    process.exit(1);
  }

  // 7. Stampa su stdout (solo il vincitore, niente altro).
  process.stdout.write(JSON.stringify(winner, null, 2) + '\n');
  process.exit(0);
}

// Esegui solo quando è il modulo principale (non quando importato dai test).
const isMainModule = resolve(process.argv[1] || '') === resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  run().catch((e) => {
    process.stderr.write(`[next-feedback] errore fatale: ${e.message}\n`);
    process.exit(1);
  });
}
