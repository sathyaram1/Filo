// Handler di dominio: account "Accedi con Google", triage admin dei feedback
// e config condivisa "modelli predefiniti".

const auth = require('../../auth/google-auth');
const ProdottiGoogle = require('../../auth/prodottiGoogle');
const Defaults = require('../defaultsStore');
const SupportModels = require('../supportModelsStore');
const { permissionDeniedHelp, attachmentForbiddenHelp, attachmentNotForYouHelp } = require('../feedbackError');
const { daFilo, soloFilo } = require('./origine');
const { spiegaErroreAccesso } = require('../../auth/esitoAccesso');
const { avvisoNellaFinestra } = require('../avvisoFinestra');
const { consiglioPortachiavi } = require('../../portachiavi');
require('../../../shared/routineCrediti.js');

// Chi accede su un computer senza portachiavi di sistema scopriva solo alla
// riapertura di essere di nuovo fuori, e pensava a un guasto (#708.1).
const CHIAVE_AVVISO_NON_RICORDATO = 'accesso-non-ricordato';
function testoAccessoNonRicordato() {
  const base = 'Hai fatto l\'accesso, ma Filo non trova un portachiavi di sistema dove custodirlo: '
    + 'quando chiudi Filo dovrai accedere di nuovo.';
  let backend = '';
  try { backend = require('electron').safeStorage.getSelectedStorageBackend?.() || ''; } catch (_) {}
  const consiglio = consiglioPortachiavi({ platform: process.platform, backend });
  return consiglio ? `${base} ${consiglio}` : base;
}

// Region e progetto sono quelli del deploy; override per i test via env.
const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

// Protocollo onCall con l'ID token admin: lancia su errore di auth, rete o HTTP.
async function callSecurityFunction(name, data = {}) {
  const idToken = await auth.getIdToken();
  if (!idToken) throw new Error('Sessione scaduta: rifai l\'accesso.');
  const res = await fetch(`${FUNCTIONS_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    let detail = '';
    let code = '';
    let reason = '';
    try {
      const err = (await res.json())?.error || {};
      detail = err.message || '';
      code = err.status || '';
      reason = (err.details && typeof err.details.reason === 'string') ? err.details.reason : '';
    } catch (_) {}
    // Codice e spiegazione del server restano attaccati all'errore: chi chiama sceglie la frase per l'owner.
    throw Object.assign(new Error(`callable ${name} ${res.status}${detail ? ': ' + detail : ''}`),
      { httpStatus: res.status, code: String(code), detail: String(detail), reason });
  }
  const body = await res.json();
  return body && body.result;
}

// Un errore di ownerSenderFlag detto all'owner. Su frase o stato sbagliati la spiegazione è del server.
const ERRORI_SEGNO = {
  PERMISSION_DENIED: 'Il server dice che questo account non può toccare il segno: serve quello del proprietario.',
  NOT_FOUND: 'Il server non trova questo feedback o il suo mittente.',
  UNAUTHENTICATED: 'Sessione scaduta: rifai l\'accesso.',
};
function erroreSegno(e) {
  const code = String(e?.code || '').toUpperCase();
  const detail = String(e?.detail || '').trim();
  if (code === 'INVALID_ARGUMENT' || code === 'FAILED_PRECONDITION') return detail || 'Il server ha rifiutato la richiesta.';
  if (ERRORI_SEGNO[code]) return detail ? `${ERRORI_SEGNO[code]} (${detail})` : ERRORI_SEGNO[code];
  if (e?.httpStatus) return `Il server ha risposto con un errore ${e.httpStatus}${detail ? `: ${detail}` : ''}.`;
  // `fetch` fallisce con un TypeError quando il server non si raggiunge; il resto ha già la sua frase.
  if (e?.name === 'TypeError') return 'Il server non risponde: controlla la connessione e riprova.';
  return e?.message || 'Non riuscito.';
}

// Un errore di ownerDomande detto all'owner. Prima del deploy la callable non esiste (404 senza codice del
// protocollo): lo si dice, non «riprova». Un 404 col codice è una domanda che non c'è, e la frase è del server.
function erroreDomande(e) {
  const code = String(e?.code || '').toUpperCase();
  const detail = String(e?.detail || '').trim();
  if (e?.httpStatus === 404 && !code) return 'Le domande non sono ancora pubblicate sul server: arrivano col prossimo aggiornamento del server.';
  if (code === 'PERMISSION_DENIED') return 'Il server dice che questo account non può vedere le domande: serve quello del proprietario.';
  if (code === 'UNAUTHENTICATED') return 'Sessione scaduta: rifai l\'accesso.';
  if (detail) return detail;
  if (e?.httpStatus) return `Il server ha risposto con un errore ${e.httpStatus}.`;
  if (e?.name === 'TypeError') return 'Il server non risponde: controlla la connessione e riprova.';
  return e?.message || 'Non riuscito.';
}

// Un errore di ownerCrediti detto all'owner. Su un numero fuori misura la spiegazione è del server.
function erroreCrediti(e) {
  const code = String(e?.code || '').toUpperCase();
  const detail = String(e?.detail || '').trim();
  if (e?.httpStatus === 404 && !code) return 'I crediti delle routine non sono ancora pubblicati sul server.';
  if (code === 'PERMISSION_DENIED') return 'Il server dice che questo account non può toccare i crediti: serve quello del proprietario.';
  if (code === 'UNAUTHENTICATED') return 'Sessione scaduta: rifai l\'accesso.';
  if (detail) return detail;
  if (e?.httpStatus) return `Il server ha risposto con un errore ${e.httpStatus}.`;
  if (e?.name === 'TypeError') return 'Il server non risponde: controlla la connessione e riprova.';
  return e?.message || 'Non riuscito.';
}

// Un errore di ownerCompiti detto all'owner. Prima del deploy la callable non esiste (404 senza codice), e un server
// più vecchio dell'app non conosce l'op (`op_sconosciuta`): lo si dice, con `nonAncora` per le op nuove.
function erroreCompiti(e, nonAncora) {
  const code = String(e?.code || '').toUpperCase();
  const detail = String(e?.detail || '').trim();
  if (e?.httpStatus === 404 && !code) return 'I compiti non sono ancora pubblicati sul server: arrivano col prossimo aggiornamento del server.';
  if (nonAncora && e?.reason === 'op_sconosciuta') return nonAncora;
  if (code === 'PERMISSION_DENIED') return 'Il server dice che questo account non può vedere i compiti: serve quello del proprietario.';
  if (code === 'UNAUTHENTICATED') return 'Sessione scaduta: rifai l\'accesso.';
  if (detail) return detail;
  if (e?.httpStatus) return `Il server ha risposto con un errore ${e.httpStatus}.`;
  if (e?.name === 'TypeError') return 'Il server non risponde: controlla la connessione e riprova.';
  return e?.message || 'Non riuscito.';
}

// Dallo stato dei crediti la scheda usa questi campi per account; le sessioni restano sul server.
const CREDITI_CAMPI_ACCOUNT = Object.freeze(['pct', 'lettura', 'stima', 'fonte', 'limite', 'taratura', 'taraturaDa',
  'letturaAtMs', 'usdSettimana', 'settimanaDaMs', 'rinnovoAtMs', 'passo', 'fermo', 'basseAperte']);
function accountsCrediti(r) {
  const out = {};
  for (const a of ['A', 'B']) {
    const v = r && r.accounts && r.accounts[a];
    if (!v || typeof v !== 'object') continue;
    out[a] = {};
    for (const k of CREDITI_CAMPI_ACCOUNT) if (v[k] !== undefined) out[a][k] = v[k];
  }
  return out;
}

// Un istante del server (ISO, millisecondi, secondi o Timestamp serializzato) come ISO; '' se non c'è.
function aIso(v) {
  if (v == null || v === '') return '';
  let ms = NaN;
  if (typeof v === 'object') {
    const s = v._seconds ?? v.seconds;
    if (typeof s === 'number') ms = s * 1000;
  } else if (typeof v === 'number' || /^\d+$/.test(String(v).trim())) {
    const n = Number(v);
    ms = n < 1e11 ? n * 1000 : n;
  } else {
    ms = Date.parse(String(v));
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

// La privata non esce mai dal main process: il renderer non la vede.
const { getPrivateKey } = require('../chiaveFeedback');

// «È un allegato di Filo?» lo decide solo SN_FEEDBACK.isAttachmentUrl, come nelle pagine:
// due strade per la stessa domanda è il difetto che questo confine ha già pagato.

// Campi FENC1: i valori in chiaro passano invariati, senza chiave restano un placeholder.
// `statusPublic` resta in chiaro; la revisione dell'owner viaggia cifrata (#476).
const TEXT_FIELDS_TO_DECRYPT = ['text', 'url', 'name', 'title', 'notes', 'reviewComment', 'reviewDecision', 'reviewedAt', 'status', 'clientId'];
const PLACEHOLDER_NO_KEY = '[cifrato — chiave privata non configurata]';
// Il pool di thread di Node ha 4 posti di default: oltre non si guadagna.
const DECRYPT_CONCURRENCY = 4;

// `pipeline` è cifrato come UNA stringa con dentro tutto l'oggetto: va decifrato prima del
// render. Senza chiave resta la stringa cifrata: nessun crash.
async function decryptPipelineField(out, C, priv) {
  const p = out.pipeline;
  if (!C.isEncrypted(p)) return;
  if (!priv) return; // senza chiave: lascia la stringa cifrata (no crash)
  try {
    out.pipeline = JSON.parse(await C.decrypt(p, priv));
  } catch (e) {
    console.warn('[auth] decifratura/parse del pipeline fallita:', e?.message || e);
    // I lettori gestiscono un `pipeline` non-oggetto come "nessun blocco", senza crashare.
  }
}

// I testi dei livelli 3 e 4 stanno nella stessa busta delle note, con la chiave dell'owner.
// La mappa si copia prima di scriverci: il documento del chiamante non si muta.
const LIVELLI_CON_TESTO = ['l3', 'l4'];
async function decryptLivelliFields(out, C, priv) {
  const l = out.livelli;
  if (!l || typeof l !== 'object') return;
  const copia = { ...l };
  let toccato = false;
  for (const k of LIVELLI_CON_TESTO) {
    const voce = copia[k];
    if (!voce || typeof voce !== 'object') continue;
    if (!C.isEncrypted(voce.testo)) continue;
    if (!priv) { copia[k] = { ...voce, testo: PLACEHOLDER_NO_KEY }; toccato = true; continue; }
    try {
      copia[k] = { ...voce, testo: await C.decrypt(voce.testo, priv) };
    } catch (e) {
      console.warn(`[auth] decifratura di livelli.${k}.testo fallita:`, e?.message || e);
      copia[k] = { ...voce, testo: PLACEHOLDER_NO_KEY };
    }
    toccato = true;
  }
  if (toccato) out.livelli = copia;
}

// `privKey` opzionale: il batch della dashboard la legge una volta per tutti i documenti,
// invece di rileggerla dal disco 500 volte per una lista.
async function decryptFeedbackObject(fields, privKey) {
  const C = globalThis.SN_FEEDBACK_CRYPTO;
  if (!C) return fields; // modulo non caricato: passthrough

  const priv = privKey !== undefined ? privKey : await getPrivateKey();
  const out = { ...fields };
  for (const f of TEXT_FIELDS_TO_DECRYPT) {
    const v = out[f];
    if (!C.isEncrypted(v)) continue;
    if (!priv) { out[f] = PLACEHOLDER_NO_KEY; continue; }
    try {
      const plain = await C.decrypt(v, priv);
      // Qui si toglie l'imbottitura dello status, o la dashboard non riconosce più nessuno stato.
      // Regola dell'imbottitura: vedi shared/feedbackTransitions.js.
      out[f] = f === 'status' ? plain.trim() : plain;
    } catch (e) {
      console.warn(`[auth] decifratura campo "${f}" fallita:`, e?.message || e);
      out[f] = PLACEHOLDER_NO_KEY;
    }
  }
  await decryptPipelineField(out, C, priv);
  await decryptLivelliFields(out, C, priv);

  // `priority` è un intero, non testo: logica dedicata. Se è già un numero resta invariato.
  if (C.isEncrypted(out.priority)) {
    if (priv) {
      try {
        const plain = await C.decrypt(out.priority, priv);
        const num = parseInt(plain, 10);
        out.priority = Number.isInteger(num) ? num : 0;
      } catch (e) {
        console.warn('[auth] decifratura campo "priority" fallita:', e?.message || e);
        // lascia il ciphertext: priorityOf() fa Number() → NaN → 0 (safe)
      }
    }
  }

  return out;
}

// `admins` è leggibile solo da un admin: 200 = admin, 403 = no. null se la risposta non è
// concludente, così il chiamante mostra il dubbio invece di affermare il falso.
async function probeServerAdmin(claims) {
  try {
    const email = claims && claims.email;
    const rest = globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.rest;
    if (!email || !rest) return null;
    const idToken = await auth.getIdToken();
    if (!idToken) return null;
    const url = `${rest.FIRESTORE_BASE}/admins/${encodeURIComponent(email)}?key=${rest.API_KEY}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (res.status === 200) return true;
    if (res.status === 403 || res.status === 404) return false;
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  // L'avviso porta l'email di chi usa Filo: va alle superfici di Filo, mai a tutte le schede,
  // dove arrivano anche i content script dei siti visitati.
  const avvisaLeSuperficiDiFilo = (m) => {
    if (typeof ctx.broadcastToFiloPages === 'function') ctx.broadcastToFiloPages(m);
    else ctx.broadcastToTabs(m);
    // L'owner entrato o uscito cambia chi vede Bacheca e Mazzi senza che l'interruttore si muova (#1592).
    try { require('../inPausa').accessoCambiato(); } catch (_) {}
  };
  // La copia della foto del profilo arriva dopo l'accesso (#1273): barra, shell e home la ridisegnano da qui.
  if (typeof auth.suFoto === 'function') {
    auth.suFoto((profile) => avvisaLeSuperficiDiFilo({
      type: MSG.AUTH_CHANGED, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin(), profile, remembered: auth.isRemembered(),
    }));
  }

  // I token restano nel main process: qui torniamo solo il profilo pubblico
  // + se l'utente è admin (può triagiare i feedback). `uid` è il claim
  // Firebase REALE (request.auth.uid nelle Firestore rules) — diverso
  // dall'email del profilo — usato dalla bacheca (DC2) per riconoscere i
  // propri voti nella mappa `votes` autorevole letta da Firestore.
  // `remembered` serve solo alla finestra (avviso «accesso non ricordato»): ai siti non va.
  // Da un sito visitato questa porta risponde, ma senza IDENTITÀ: niente
  // indirizzo email, niente nome, niente identificativo dell'account. Un
  // content script gira anche dentro le pagine dei siti, e di sé deve sapere
  // solo due cose: se c'è una sessione (il pannello del red-team invita ad
  // accedere) e se questa è l'installazione di chi gestisce i feedback (la
  // griglia del tasto destro mostra l'icona Feedback solo a lui, #583 giro 2).
  // Chi è, e con che indirizzo, lo chiede una superficie di Filo.
  on(MSG.AUTH_STATUS, async (msg, sender, origin) => {
    const signedIn = auth.isSignedIn();
    const isAdmin = auth.isAdmin();
    if (!daFilo(origin, sender)) return { ok: true, signedIn, isAdmin };
    // `senzaRete`: chi apre un menu non aspetta il rinnovo del token che serve all'uid.
    const conUid = !(msg && msg.senzaRete);
    const uid = signedIn && conUid ? await auth.getUid() : null;
    // Se una scheda nuova su Google troverebbe un account: il menu dell'account ne fa le sue voci (#1123).
    let googleNelleSchede = false;
    try { googleNelleSchede = await require('../accessoGoogle').collegatoNelleSchede(); } catch (_) {}
    const out = { ok: true, signedIn, isAdmin, profile: auth.getProfile(), remembered: auth.isRemembered(), googleNelleSchede };
    return conUid ? { ...out, uid } : out;
  });

  // YouTube, Gmail e Drive nelle schede per chi è dentro Filo (#1123). Solo da Filo: un sito non apre pagine d'accesso.
  on(MSG.AUTH_COLLEGA_GOOGLE, soloFilo(async (msg, sender) => {
    const win = sender && sender.win;
    let daUrl = '';
    try {
      const tabs = win && win._filoTabs;
      const attiva = tabs && tabs.tabs.find((t) => t.id === tabs.activeId);
      daUrl = (attiva && attiva.url) || '';
    } catch (_) {}
    try { return ProdottiGoogle.collega({ daUrl, finestra: win }); }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  }));

  // Un sito può chiedere l'accesso (il pannello del red-team gira nelle sue
  // pagine), ma come per lo stato gli torna solo l'esito, mai chi è entrato.
  on(MSG.AUTH_SIGNIN, async (msg, sender, origin) => {
    try {
      const profile = await auth.signIn();
      const remembered = auth.isRemembered();
      avvisaLeSuperficiDiFilo({ type: MSG.AUTH_CHANGED, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin(), profile, remembered });
      // Nel main e non nelle pagine: all'accesso si arriva da molte porte
      // (menu account, bacheca, posta, red-team, siti), e l'avviso vale per tutte.
      if (auth.isSignedIn() && !remembered) {
        avvisoNellaFinestra(testoAccessoNonRicordato(), { chiave: CHIAVE_AVVISO_NON_RICORDATO, tipo: 'accesso_non_ricordato' });
      }
      // Rinfresca la config condivisa in background. Le chiavi ruotate
      // dall'admin NON si leggono più qui (#581: config/secrets è admin-only e
      // le chiavi arrivano col build); resta utile per config/models.
      Defaults.refresh().catch(() => {});
      // Con l'owner dentro il main ha di nuovo il token: la vista pubblica si rimette in pari.
      if (auth.isAdmin()) scheduleViewSync({ delayMs: 4000, force: true });
      // I feedback dell'owner fermi ad aspettare la sua firma (#912) partono adesso, non al prossimo giro della coda.
      if (auth.isAdmin()) { try { globalThis.SN_FEEDBACK_OUTBOX?.accessoCambiato?.(); } catch (_) {} }
      if (!daFilo(origin, sender)) return { ok: true, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin() };
      return { ok: true, profile, isAdmin: auth.isAdmin(), remembered };
    } catch (e) {
      return { ok: false, ...spiegaErroreAccesso(e) };
    }
  });

  // L'uscita dall'account la chiede solo Filo: da un sito era un modo per buttare fuori
  // chi lo sta usando, e da lì posta delle segnalazioni e bacheca si fermano.
  on(MSG.AUTH_SIGNOUT, soloFilo(async () => {
    try {
      auth.signOut();
      avvisaLeSuperficiDiFilo({ type: MSG.AUTH_CHANGED, signedIn: false, isAdmin: false, profile: null });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // «Aspetta #N» (#903): la pagina manda i numeri come li ha scritti l'owner; li risolve e li controlla il main, che
  // legge i documenti col token (la pagina ne vede una finestra). Vuoto = togliere. Regole: SN_FB_ATTESE.valida.
  // `tieni`: id delle attese già scritte che la pagina non sa rinumerare (aspettato cancellato o non letto): restano come sono.
  async function prepareAttese(id, valore, idToken, tieni) {
    const A = globalThis.SN_FB_ATTESE;
    const FB = globalThis.SN_FEEDBACK;
    const letti = A.leggiNumeri(valore === null || valore === false ? '' : valore);
    if (!letti.ok) return letti;
    if (tieni !== undefined && (!Array.isArray(tieni) || tieni.length > A.MAX || tieni.some((x) => typeof x !== 'string'))) {
      return { ok: false, motivo: 'elenco delle attese da tenere non valido' };
    }
    if (!letti.numeri.length && !(tieni || []).length) return { ok: true, attese: [] };
    const [proprio] = await FB.getMany([id], { idToken, fields: ['seq', 'subSeq', A.CAMPO], timeoutMs: 20000 });
    if (!proprio) return { ok: false, motivo: 'il feedback non esiste più' };
    // Un numero di più feedback (#1517) non si lega al primo che capita: lo si dice all'owner, con gli id.
    const v = A.valida({
      id, num: FB.formatNum(proprio.seq, proprio.subSeq), numeri: letti.numeri, gia: A.atteseDi(proprio), tieni: tieni || [],
      risolvi: (n) => FB.idDelNumero(n, { idToken, timeoutMs: 20000 }),
      leggiAttese: async (ids) => {
        const out = new Map();
        for (let i = 0; i < ids.length; i += 100) {
          // eslint-disable-next-line no-await-in-loop
          const righe = await FB.getMany(ids.slice(i, i + 100), { idToken, fields: [A.CAMPO], timeoutMs: 20000 });
          for (const r of righe) out.set(r._id, A.atteseDi(r));
        }
        return out;
      },
    });
    return v.catch((e) => {
      if (e && Array.isArray(e.numeroDoppio)) return { ok: false, motivo: e.message };
      throw e;
    });
  }

  // Triage admin di un feedback: solo admin loggati, con Firebase ID token
  // come Bearer (il token non lascia mai il main). La garanzia forte è nelle
  // Firestore rules; questo è il gate applicativo + il trasporto autenticato.
  // `ownerOnly`: prima di chiedersi CHI è, si chiede DA DOVE arriva. Il triage
  // scrive sul feedback e sulla frase che finisce in bacheca sotto gli occhi di
  // tutti: è un gesto che si fa sulle superfici di Filo, non una cosa che una
  // pagina di un sito visitato possa chiedere. Sul computer di chiunque altro
  // «sei l'amministratore?» basta, perché la risposta è no; su quello di chi i
  // feedback li gestisce è sempre sì, ed è l'unico dove c'è qualcosa da fare.
  on(MSG.FEEDBACK_UPDATE, ownerOnly(async (msg) => {
    try {
      if (!globalThis.SN_FEEDBACK?.updateStatus) {
        throw new Error('SN_FEEDBACK non caricato nel main process');
      }
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      // `userNote` è la frase in chiaro per chi ha segnalato: va inoltrata, o quella metà dei due
      // testi si perde fuori dalla dashboard.
      const { id, status, notes, userNote, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride } = msg;
      // «Solo in locale» (#908): la pagina manda solo sì/no, il CHI lo mette il main dalla sessione (l'email del
      // token, la stessa che le regole vedono). La fiducia non passa di qui: la scrive il server (FIDUCIA_SEGNA).
      let localOnly;
      if (typeof msg.localOnly === 'boolean') {
        let email = '';
        if (msg.localOnly) { try { email = String(auth.getTokenClaims()?.email || ''); } catch (_) {} }
        localOnly = msg.localOnly ? { by: email || 'owner', at: Date.now() } : null;
      }
      // #913: «approvalo come lavoro locale» su un feedback non tuo. Resta anche se il segno si toglie: senza, il
      // segno non si rimetterebbe più, perché il sì si dà solo dai Ricevuti.
      let localApproval;
      if (msg.localApproval === true) {
        let email = '';
        try { email = String(auth.getTokenClaims()?.email || ''); } catch (_) {}
        localApproval = { by: email || 'owner', at: Date.now() };
      }
      let waitsFor;
      if (msg.waitsFor !== undefined) {
        const r = await prepareAttese(id, msg.waitsFor, idToken, msg.waitsTieni);
        if (!r.ok) return { ok: false, error: r.motivo, rifiutato: true };
        waitsFor = r.attese;
      }
      // Una riapertura (Riapri, Ripristina, da qualunque pagina) svuota il registro delle parti (#938): lo stato di
      // partenza si chiede al documento, non alla copia della pagina.
      const FB = globalThis.SN_FEEDBACK;
      let localMerges;
      if (status !== undefined && FB.statusToPublic(status) === 'open') {
        const [ora] = await FB.getMany([id], { idToken, fields: ['statusPublic', 'localMerges'] });
        if (ora && ora.localMerges && FB.riapre(ora.statusPublic, status)) localMerges = null;
      }
      await globalThis.SN_FEEDBACK.updateStatus(
        id,
        { status, notes, userNote, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride, localOnly, localApproval, localMerges, waitsFor },
        { idToken },
      );
      // Il triage cambia la bacheca: la vista si rifà subito, non al prossimo caricamento.
      // Prima la scheda di QUESTO id: il giro generale guarda solo i più recenti per data d'invio.
      await syncOneCard(id, idToken);
      scheduleViewSync({ delayMs: 1500, force: true });
      if (waitsFor) return { ok: true, waitsFor };
      // La pagina mostra subito chi ha messo il segno «solo in locale»: glielo dice il main, l'unico a saperlo.
      return localOnly ? { ok: true, by: localOnly.by, at: localOnly.at } : { ok: true };
    } catch (e) {
      const raw = e?.message || String(e);
      // Nel registro, non solo nella risposta: la pagina può aver cambiato
      // pratica nel frattempo, e un 403 muto è un segno che non c'è e nessuno sa perché.
      const campi = Object.keys(msg || {}).filter((k) => k !== 'type' && k !== 'id').join(',');
      console.warn('[Filo] feedback_update respinto', id, campi, raw.slice(0, 300));
      let claims = null;
      try { claims = auth.getTokenClaims(); } catch (_) {}
      // Un 403 può dire «non sei admin» o «il contenuto sfora i limiti»: leggere `admins/<email>`
      // riesce solo agli admin, e il suo esito distingue i due casi invece di indovinare.
      const serverAdmin = await probeServerAdmin(claims);
      return { ok: false, error: permissionDeniedHelp(raw, claims, { serverAdmin }) };
    }
  }));

  // Decifratura dei campi feedback nel main (la privkey non esce da qui), owner-only.
  // Il batch serve alle dashboard che caricano centinaia di feedback: una IPC invece di N.
  on(MSG.FEEDBACK_DECRYPT_FIELDS, ownerOnly(async (msg) => {
    try {
      // Nel batch la chiave si legge UNA volta e i documenti vanno a gruppi in parallelo: la
      // crittografia gira nel pool di thread, in sequenza 500 feedback costavano secondi.
      if (Array.isArray(msg.list)) {
        const priv = await getPrivateKey();
        const list = new Array(msg.list.length);
        let next = 0;
        const worker = async () => {
          while (next < msg.list.length) {
            const i = next++;
            list[i] = await decryptFeedbackObject(msg.list[i] || {}, priv);
          }
        };
        await Promise.all(Array.from({ length: DECRYPT_CONCURRENCY }, worker));
        return { ok: true, list };
      }
      const fields = msg.fields || {};
      const decrypted = await decryptFeedbackObject(fields);
      return { ok: true, fields: decrypted };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Le immagini sono byte cifrati: il main le scarica, le decifra e torna un data URL.
  // Provenienza sì, `ownerOnly` no: qui entra anche il tester che riapre le proprie (#582).
  on(MSG.FEEDBACK_DECRYPT_IMAGE, soloFilo(async (msg) => {
    try {
      const url = String((msg && msg.url) || '');
      const FB = globalThis.SN_FEEDBACK;
      if (!FB?.isAttachmentUrl) throw new Error('SN_FEEDBACK non caricato nel main process');
      // DOVE PUNTA, PRIMA DI CHI GUARDA (#582): solo URL https del deposito feedback, o il canale
      // diventa un fetch arbitrario pilotato dal renderer (SSRF). Fuori, la risposta è una sola.
      if (!FB.isAttachmentUrl(url)) {
        return { ok: false, error: 'url allegato non valido' };
      }
      // Chi non è admin l'immagine non la vede (cifrata con la chiave di chi riceve), ma
      // `soloDestinatario` dice alla pagina che non è un guasto: il segnaposto lo scrive.
      if (!auth.isAdmin()) {
        return { ok: false, soloDestinatario: true, error: attachmentNotForYouHelp() };
      }
      // Ad aprire l'allegato è il download token nell'URL; l'identità si manda comunque, e solo
      // verso il deposito di Filo, così se le regole tornassero a leggerla è già firmata giusta.
      let idToken = '';
      try { idToken = (await auth.getIdToken()) || ''; } catch (_) { idToken = ''; }
      const res = await fetch(url, { headers: FB.attachmentFetchHeaders(url, idToken) });
      if (!res.ok) {
        // Un 403 qui ha una causa sola e una cura sola: dirla evita un segnaposto muto.
        if (res.status === 403) {
          return { ok: false, error: attachmentForbiddenHelp() };
        }
        return { ok: false, error: `download allegato fallito (${res.status})` };
      }
      const raw = new Uint8Array(await res.arrayBuffer());

      const C = globalThis.SN_FEEDBACK_CRYPTO;
      const IMG = globalThis.SN_FEEDBACK_IMAGE;
      if (!IMG) throw new Error('SN_FEEDBACK_IMAGE non caricato nel main process');

      let bytes = raw;
      if (C && C.isEncryptedBytes && C.isEncryptedBytes(raw)) {
        const priv = await getPrivateKey();
        if (!priv) {
          return { ok: false, error: 'Immagine cifrata ma chiave privata non configurata.' };
        }
        try {
          bytes = await C.decryptBytes(raw, priv);
        } catch (e) {
          // Byte che sembrano un ciphertext ma non si decifrano: niente ripiego sui byte cifrati
          // (illeggibili comunque), si dichiara l'errore.
          return { ok: false, error: 'decifratura immagine fallita' };
        }
      }
      // Un documento torna col tipo dichiarato dal chiamante, così il link lo scarica decifrato e
      // col nome originale invece dei byte cifrati.
      const mime = String((msg && msg.mime) || '').trim();
      if (mime && !/^image\//i.test(mime) && /^[\w.+-]+\/[\w.+-]+$/.test(mime)) {
        return { ok: true, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` };
      }
      return { ok: true, dataUrl: IMG.bytesToDataUrl(bytes) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // La lettura non espone le chiavi vere, solo se sono configurate.
  // La scrittura è riservata agli admin e si propaga a tutte le installazioni.
  on(MSG.DEFAULTS_GET, ownerOnly(async () => {
    try {
      await Defaults.refresh().catch(() => {});
      return { ok: true, config: Defaults.getPublicForAdmin() };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Versione leggibile da TUTTI: solo i nomi, mai una chiave. Sono i modelli predefiniti VERI,
  // quelli della configurazione condivisa, non quelli scritti nel codice.
  on(MSG.DEFAULT_MODELS_PUBLIC, async () => {
    try {
      await Defaults.refreshIfStale().catch(() => {});
      const d = Defaults.get();
      const FC = globalThis.SN_FILO_CONTESTO;
      // Anche la scelta generale degli host: senza, una pagina non sa a cosa rimanda «Automatico».
      return {
        ok: true, modelRegistry: d.modelRegistry || {}, models: d.models || {},
        providerSort: d.providerSort || '',
        contestoFilo: d.contestoFilo || {}, contestoFiloDiSerie: FC ? { ...FC.TETTI_DI_SERIE } : {},
        lunghezzaRisposte: d.lunghezzaRisposte || {},
        lunghezzaRisposteDiSerie: globalThis.SN_LUNGHEZZA_RISPOSTE ? { ...globalThis.SN_LUNGHEZZA_RISPOSTE.DI_SERIE } : {},
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  on(MSG.DEFAULTS_UPDATE, ownerOnly(async (msg) => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const config = await Defaults.update(msg.config || {}, idToken);
      return { ok: true, config };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Interruttore master dell'auto-miglioramento (config/automation), owner-only.
  // Default OFF: da spento anche i feedback «sicuri» richiedono verifica umana.
  on(MSG.AUTOMATION_GET, ownerOnly(async () => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const enabled = await Defaults.getAutomationGate(idToken);
      const autoApprove = await Defaults.getAutomationAutoApprove(idToken);
      const routinesEnabled = await Defaults.getRoutinesEnabled(idToken);
      const lavoriServer = await Defaults.getLavoriServer(idToken);
      return { ok: true, enabled, autoApprove, routinesEnabled, lavoriServer };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Accetta `enabled` (interruttore master) e/o `autoApprove` (mappa per fiducia
  // dell'auto-approvazione, #446 e §10), e tocca SOLO ciò che riceve: la vecchia
  // pagina feedback manda ancora il solo `enabled` e non deve azzerare la mappa.
  on(MSG.AUTOMATION_SET, ownerOnly(async (msg) => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      let enabled;
      if (typeof msg.enabled === 'boolean') {
        enabled = await Defaults.setAutomationGate(msg.enabled, idToken);
      } else {
        enabled = await Defaults.getAutomationGate(idToken);
      }
      const autoApprove = (msg.autoApprove && typeof msg.autoApprove === 'object')
        ? await Defaults.setAutomationAutoApprove(msg.autoApprove, idToken)
        : await Defaults.getAutomationAutoApprove(idToken);
      // Interruttore master delle routine (config/routines): è ciò che ferma il
      // lavoro autonomo, mentre `enabled` qui sopra riguarda solo chi entra in
      // coda da solo. Due decisioni diverse, due interruttori.
      const routinesEnabled = (typeof msg.routinesEnabled === 'boolean')
        ? await Defaults.setRoutinesEnabled(msg.routinesEnabled, idToken)
        : await Defaults.getRoutinesEnabled(idToken);
      // I lavori server alle routine (#1159): spento, restano alle sessioni locali.
      const lavoriServer = (typeof msg.lavoriServer === 'boolean')
        ? await Defaults.setLavoriServer(msg.lavoriServer, idToken)
        : await Defaults.getLavoriServer(idToken);
      return { ok: true, enabled, autoApprove, routinesEnabled, lavoriServer };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // I bilanci dei giri di correzione, uno per livello, e il testo della fase 2
  // (config/routines, campi in VERIFIER_CAP_KEYS più `fixInstructions` —
  // feedback #561). Owner-only. È la fonte di verità che il server applica
  // quando registra la critica: cambiarli qui ha effetto sul prossimo giro.
  const CAP_KEYS = (globalThis.SN_FB_TRANSITIONS && globalThis.SN_FB_TRANSITIONS.VERIFIER_CAP_KEYS) || ['cap3', 'cap2', 'cap1', 'cap0'];
  const capsReply = (caps) => {
    const out = { ok: true, fixInstructions: caps.fixInstructions, giroStretto: caps.giroStretto === true };
    for (const k of CAP_KEYS) out[k] = caps[k];
    return out;
  };
  on(MSG.AUTOMATION_CAPS_GET, ownerOnly(async () => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      return capsReply(await Defaults.getRoutineCaps(idToken));
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Tocca SOLO i campi che riceve: salvare un bilancio non deve riscrivere gli altri.
  on(MSG.AUTOMATION_CAPS_SET, ownerOnly(async (msg) => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const patch = { fixInstructions: msg.fixInstructions, giroStretto: msg.giroStretto };
      for (const k of CAP_KEYS) patch[k] = msg[k];
      return capsReply(await Defaults.setRoutineCaps(patch, idToken));
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Come partono le sessioni delle routine (config/routines): quante insieme,
  // da quale account per prima, quali esclusi. Owner-only. Le legge il server
  // quando accende le sessioni: cambiarle qui vale dalla prossima.
  // `letto: false` = ho scritto ma non ho potuto rileggere, e allora tornano
  // solo i campi scritti: gli altri restano ignoti invece di valere il default.
  const sessionsReply = (s) => {
    const r = { ok: true, letto: s.letto !== false };
    for (const k of ['maxSessions', 'priorityAccount', 'accountAOff', 'accountBOff']) {
      if (s[k] !== undefined) r[k] = s[k];
    }
    return r;
  };
  on(MSG.AUTOMATION_SESSIONS_GET, ownerOnly(async () => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      return sessionsReply(await Defaults.getRoutineSessions(idToken));
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Tocca SOLO i campi che riceve (come AUTOMATION_CAPS_SET).
  on(MSG.AUTOMATION_SESSIONS_SET, ownerOnly(async (msg) => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      return sessionsReply(await Defaults.setRoutineSessions({
        maxSessions: msg.maxSessions,
        priorityAccount: msg.priorityAccount,
        accountAOff: msg.accountAOff,
        accountBOff: msg.accountBOff,
      }, idToken));
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // I numeri dell'owner sui crediti delle routine (#1356): il main fa da tramite verso ownerCrediti e rifà i
  // controlli della pagina (SN_ROUTINE_CREDITI). Si scrive solo il campo toccato; `numeri` torna sempre intero
  // dalla scrittura, lo stato per account solo se la rilettura riesce.
  async function statoCreditiRoutine() {
    const r = await callSecurityFunction('ownerCrediti', { op: 'stato' });
    const freni = r && (r.riserva === 'attivi' || r.riserva === 'numeri_assenti') ? r.riserva : '';
    return { numeri: globalThis.SN_ROUTINE_CREDITI.leggiNumeri(r && r.numeri), accounts: accountsCrediti(r), freni };
  }
  on(MSG.ROUTINE_CREDITI_GET, ownerOnly(async () => {
    try {
      return Object.assign({ ok: true }, await statoCreditiRoutine());
    } catch (e) {
      return { ok: false, error: erroreCrediti(e) };
    }
  }));
  on(MSG.ROUTINE_CREDITI_SET, ownerOnly(async (msg) => {
    const RC = globalThis.SN_ROUTINE_CREDITI;
    const patch = {};
    for (const k of RC.CHIAVI) if (msg && Object.prototype.hasOwnProperty.call(msg, k)) patch[k] = msg[k];
    const v = RC.valida(patch);
    if (!v.ok) return { ok: false, error: v.testo };
    let scritto;
    try {
      scritto = await callSecurityFunction('ownerCrediti', Object.assign({ op: 'imposta' }, v.valori));
    } catch (e) {
      return { ok: false, error: erroreCrediti(e) };
    }
    const out = { ok: true, numeri: RC.leggiNumeri(scritto && scritto.numeri) };
    try {
      const st = await statoCreditiRoutine();
      Object.assign(out, { accounts: st.accounts, freni: st.freni });
    } catch (_) { /* scritto sì: lo stato si rilegge alla prossima apertura */ }
    return out;
  }));

  // Le pause in corso degli account e della routine server, col motivo (#996). Lo stato del pacemaker non lo legge
  // nessun client: passa dal registro delle routine, con le credenziali dell'owner (mai dalla callable dello storico).
  on(MSG.AUTOMATION_PAUSE_GET, ownerOnly(async () => {
    try {
      const r = await callSecurityFunction('routineLog', { op: 'pause' });
      const pause = r && r.pause && typeof r.pause === 'object' ? r.pause : {};
      return { ok: true, pause, oraMs: Number(r && r.oraMs) || Date.now() };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Modello e sforzo del worker per fase (config/routines.roleModels). Owner-only. Le legge il server
  // quando consegna un biglietto: cambiarle qui vale dal prossimo.
  on(MSG.AUTOMATION_ROLE_MODELS_GET, ownerOnly(async () => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      return { ok: true, roleModels: await Defaults.getRoutineRoleModels(idToken) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  on(MSG.AUTOMATION_ROLE_MODELS_SET, ownerOnly(async (msg) => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const r = await Defaults.setRoutineRoleModel({ ruolo: msg.ruolo, campo: msg.campo, valore: msg.valore }, idToken);
      return Object.assign({ ok: true }, r);
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Il tetto di spesa dei giudici per i non fidati (#1515): tocca SOLO i campi che riceve.
  on(MSG.AUTOMATION_JUDGE_BUDGET_GET, ownerOnly(async () => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      return Object.assign({ ok: true }, await Defaults.getJudgeBudget(idToken));
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));
  on(MSG.AUTOMATION_JUDGE_BUDGET_SET, ownerOnly(async (msg) => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const patch = {};
      for (const k of ['tettoUsd', 'maxCaratteri']) if (msg && msg[k] !== undefined) patch[k] = msg[k];
      return Object.assign({ ok: true }, await Defaults.setJudgeBudget(patch, idToken));
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Log dei worker delle routine (config/automation, campo `workerLog`). Owner-
  // only, SOLA LETTURA dal client: chi spawna i worker (scripts/dispatch.mjs) lo
  // scrive lato routine con le proprie credenziali. Qui lo esponiamo alla tab
  // "Log" della dashboard.
  on(MSG.WORKER_LOG_GET, ownerOnly(async () => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const entries = await Defaults.getWorkerLog(idToken);
      return { ok: true, entries };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Le due collezioni le scrive il backend e nessun client le legge: un registro dei rifiuti
  // aperto direbbe a chi abusa quanto è stato notato. Perciò si passa dalla callable.
  on(MSG.ROUTINE_LOG_GET, ownerOnly(async (msg) => {
    try {
      const limit = Number(msg && msg.limit);
      const r = await callSecurityFunction('routineLog', Number.isFinite(limit) ? { limit } : {});
      return { ok: true, rejections: (r && r.rejections) || [], comparisons: (r && r.comparisons) || [], proveFusione: (r && r.proveFusione) || null, postiLasciati: (r && r.postiLasciati) || [] };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // DUE CANCELLI: `isAdmin()`, che il server ricontrolla, e l'origine (solo pagine filo://).
  // Porta unica di ogni canale con potere di questo file: una nuova si aggiunge qui.
  function ownerOnly(handler) {
    return async (msg, sender, origin) => {
      // Il motivo in una parola: senza, il rifiuto arriva come errore qualunque e diventa
      // «controlla la connessione». Confine d'origine: vedi handlers/origine.js.
      if (!daFilo(origin, sender)) return { ok: false, code: 'forbidden', error: 'forbidden' };
      if (!auth.isAdmin()) {
        return {
          ok: false,
          code: 'not_admin',
          error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.',
        };
      }
      try {
        return await handler(msg, sender, origin);
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    };
  }

  async function listMergeApprovals() {
    const r = await callSecurityFunction('ownerMergeApprovals', { op: 'list' });
    return {
      ok: true,
      pending: (r && r.pending) || [],
      // Le fusioni approvate e mai avvenute restano in vista: non sono decisioni passate.
      failed: (r && r.failed) || [],
      recent: (r && r.recent) || [],
      // Fusioni fatte senza chiedere, su pratica pre-approvata: la traccia per controllare dopo.
      preapproved: (r && r.preapproved) || [],
      // Se il server ne lascia fuori la pagina lo dice; senza totale vale l'elenco.
      preapprovedTotal: Number(r && r.preapprovedTotal) || ((r && r.preapproved) || []).length,
      ttlMs: Number(r && r.ttlMs) || 0,
    };
  }

  on(MSG.MERGE_APPROVALS_GET, ownerOnly(listMergeApprovals));

  // La collezione `feedback` non si legge senza credenziali e in una pagina filo:// l'ID token
  // non deve arrivare: si legge qui, col token e con gli stessi due cancelli (#583).
  const PUBLIC_VIEW = () => globalThis.SN_FEEDBACK_PUBLIC_VIEW;
  const FEEDBACK = () => globalThis.SN_FEEDBACK;

  // Voti e riaperture stanno sulla SCHEDA pubblica, l'unico documento che chi vota può aprire:
  // si riuniscono qui, e la scheda vince solo dove ha qualcosa da dire.
  let cardsCache = { at: 0, rows: [] };
  const CARDS_TTL_MS = 30_000;

  async function publicCards({ fresh = false } = {}) {
    const FB = FEEDBACK();
    if (!FB) return [];
    if (!fresh && Date.now() - cardsCache.at < CARDS_TTL_MS) return cardsCache.rows;
    // TUTTE le schede, paginate: una finestra sui più recenti lascerebbe in bacheca come risolti
    // i fix vecchi tornati in lavorazione, votabili e riapribili a pagamento.
    const rows = FB.listAllPublic
      ? await FB.listAllPublic({ timeoutMs: 20000, fresh })
      : await FB.listPublic({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 20000 });
    cardsCache = { at: Date.now(), rows };
    return rows;
  }

  // Per pochi feedback si chiedono le loro sole schede: il giro della Gestione
  // rileggeva tutte le schede (centinaia di letture) per riunirne due o tre.
  const SCHEDE_MIRATE_MAX = 100;

  async function mergeCardFields(rows, { mirate = false } = {}) {
    const V = PUBLIC_VIEW();
    if (!V || !Array.isArray(rows) || rows.length === 0) return rows;
    let cards;
    const FB = FEEDBACK();
    const ids = rows.map((r) => r && r._id).filter(Boolean);
    try {
      cards = (mirate && FB && FB.getManyPublic && ids.length <= SCHEDE_MIRATE_MAX)
        ? await FB.getManyPublic(ids, { timeoutMs: 20000 })
        : await publicCards();
    } catch (e) {
      console.warn('[feedback] schede pubbliche non lette:', e?.message || e);
      return rows; // meglio i voti storici che nessun feedback
    }
    return V.mergeUserFields(rows, cards);
  }

  on(MSG.FEEDBACK_FETCH, ownerOnly(async (msg) => {
    const FB = FEEDBACK();
    if (!FB) throw new Error('SN_FEEDBACK non caricato nel main process');
    const idToken = await auth.getIdToken();
    if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
    const op = String((msg && msg.op) || 'list');
    const timeoutMs = Number(msg && msg.timeoutMs) || 0;

    if (op === 'getMany') {
      const ids = Array.isArray(msg.ids) ? msg.ids : [];
      const soloCampi = (Array.isArray(msg.fields) && msg.fields.length) ? msg.fields : null;
      const rows = await FB.getMany(ids, { timeoutMs, idToken, fields: soloCampi });
      return { ok: true, rows: await mergeCardFields(rows, { mirate: true }) };
    }
    // La lettura COMPLETA (#496): la chiede la scheda delle statistiche, che
    // fa domande sull'INSIEME («quanti ne sono arrivati in tutto»), e a una
    // domanda sull'insieme una finestra sui più recenti risponde sbagliato in
    // silenzio (patterns/una-pagina-dei-piu-recenti-non-e-tutto.md). Qui non
    // si riuniscono i campi delle schede pubbliche (voti e simili: non
    // servono a un conteggio, e costerebbero una seconda lettura di tutto) e
    // non si fa partire la sincronizzazione della vista, che è mestiere del
    // caricamento della dashboard. `complete` viaggia con le righe: se il
    // freno sulle pagine è scattato, chi guarda deve poterlo dire.
    if (op === 'listAll') {
      const fields = (Array.isArray(msg.fields) && msg.fields.length) ? msg.fields : null;
      const startedAt = Date.now();
      const { rows, complete, readTime } = await FB.listAllPaged({ timeoutMs, idToken, fields });
      // `lista`: è il caricamento della Gestione (#676), che ora legge tutto: le
      // schede si riuniscono, la vista si rimette in pari e il giro riparte da qui.
      if (msg.lista !== true) return { ok: true, rows, complete, readTime };
      scheduleViewSync({ rows });
      const w = liveWatcherDi();
      if (w && complete) w.allineato(startedAt, rows, readTime);
      return { ok: true, rows: await mergeCardFields(rows), complete, readTime };
    }
    if (op !== 'list' && op !== 'versions') return { ok: false, error: `lettura non prevista: ${op}` };

    const fields = (Array.isArray(msg.fields) && msg.fields.length) ? msg.fields : null;
    const pageSize = Math.max(1, Math.min(FB.LIST_PAGE_SIZE, Number(msg.pageSize) || FB.LIST_PAGE_SIZE));
    const rows = await FB.list({ pageSize, timeoutMs, fields, idToken });
    // Il giro leggero del battito ("cosa è cambiato?") non porta campi da
    // riunire e non deve pagare la lettura delle schede a ogni minuto. Una
    // lista vera invece sì, anche quando è una proiezione — ed è anche il
    // momento buono per rimettere in pari la vista pubblica. La differenza la
    // dichiara chi chiede (`op`): dedurla dai campi era indovinare, e da
    // quando anche le liste sono proiezioni sbagliava sempre.
    if (op === 'versions') return { ok: true, rows };
    // Le righe appena lette sono le stesse che servirebbero alla
    // sincronizzazione: gliele passiamo invece di far rileggere mezzo database
    // un attimo dopo.
    scheduleViewSync({ rows });
    return { ok: true, rows: await mergeCardFields(rows) };
  }));

  // ── #676: il giro dei cambiati della Gestione, uno solo, qui nel main ────
  // Non ha un orologio suo: gira quando una Gestione IN VISTA lo chiede, e
  // l'esito arriva a chi l'ha chiesto e alle altre iscritte. La logica sta in
  // SN_FEEDBACK_LIVE.makeWatcher; la regola in
  // patterns/chi-guarda-in-continuo-chiede-cosa-e-cambiato.md.
  const liveSubs = new Map();   // wc → Set degli id che quella pagina segue da vicino
  let liveWatcher = null;

  function liveToken() {
    return auth.getIdToken().then((t) => {
      if (!t) throw new Error('sessione scaduta');
      return t;
    });
  }

  function liveWatcherDi() {
    if (liveWatcher) return liveWatcher;
    const LIVE = globalThis.SN_FEEDBACK_LIVE;
    const FB = FEEDBACK();
    if (!LIVE || !LIVE.makeWatcher || !FB) return null;
    const campi = Array.isArray(FB.CAMPI_LISTA) ? FB.CAMPI_LISTA : null;
    liveWatcher = LIVE.makeWatcher({
      // Letti dal modulo, non dalle sue costanti: gli spec accorciano i tempi.
      pollMs: LIVE.POLL_MS,
      reconcileMs: LIVE.RECONCILE_MS,
      onWarn: (m) => console.warn('[feedback] giro:', m),
      seguiti: () => {
        const out = new Set();
        for (const ids of liveSubs.values()) for (const id of ids) out.add(id);
        return Array.from(out);
      },
      versionsOf: async (ids) => FB.versionsOf(ids, { timeoutMs: 20000, idToken: await liveToken() }),
      readRows: async (ids) => {
        const rows = await FB.getMany(ids, { timeoutMs: 20000, idToken: await liveToken(), fields: campi });
        return mergeCardFields(rows, { mirate: true });
      },
      submissionCount: async () => FB.submissionCount({ timeoutMs: 20000, idToken: await liveToken() }),
      avviiRoutine: async () => Defaults.getWorkerLog(await liveToken(), { severo: true }),
      idDelNumero: async (num) => FB.idDelNumero(num, { timeoutMs: 20000, idToken: await liveToken() }),
      listVersions: async () => {
        // La data d'invio costa pochi byte e serve a chi tiene solo i più recenti (nellaFinestra).
        const { rows, complete, readTime } = await FB.listAllPaged({ timeoutMs: 20000, idToken: await liveToken(), fields: ['createdAt'] });
        return { versions: rows.map((r) => ({ _id: r._id, _updateTime: r._updateTime, createdAt: r.createdAt })), complete, readTime };
      },
      listChangedSince: async ({ since }) => {
        const out = await FB.listChangedSince({ since, timeoutMs: 20000, idToken: await liveToken(), fields: campi });
        const rows = await mergeCardFields(out.rows, { mirate: true });
        return { rows, complete: out.complete, readTime: out.readTime };
      },
    });
    return liveWatcher;
  }

  // La posta dell'owner non esce da filo://: una scheda andata su un sito si toglie.
  function liveIscritteValide() {
    for (const wc of Array.from(liveSubs.keys())) {
      try {
        if (!wc || (wc.isDestroyed && wc.isDestroyed()) || !String(wc.getURL() || '').startsWith('filo://')) liveSubs.delete(wc);
      } catch (_) { liveSubs.delete(wc); }
    }
  }

  function liveAvvisaAltre(payload, mittente) {
    liveIscritteValide();
    const msg = { type: MSG.FEEDBACK_LIVE_CHANGED, ...payload };
    for (const wc of liveSubs.keys()) {
      if (wc === mittente) continue;
      try { wc.send('filo:broadcast', msg); } catch (_) { liveSubs.delete(wc); }
    }
  }

  // Una pagina che non è in vista non tiene vivo il giro (#676, punto 6): la
  // pagina lo sa già, ma la porta lo ricontrolla.
  function inVistaDi(sender) {
    try {
      const win = typeof ctx.winOf === 'function' ? ctx.winOf(sender) : null;
      const tabs = win && win._filoTabs;
      if (!tabs || !sender || !sender.tab || !sender.tab.id || typeof tabs.inVista !== 'function') return true;
      return tabs.inVista(sender.tab.id);
    } catch (_) { return true; }
  }

  //   { off:true }                  → smette di ricevere
  //   { watch:[id…] }               → gli id da seguire da vicino
  //   { giro:true, force? }         → un giro adesso; torna il suo esito
  on(MSG.FEEDBACK_LIVE_SUBSCRIBE, ownerOnly(async (msg, sender) => {
    const LIVE = globalThis.SN_FEEDBACK_LIVE;
    const wc = sender && sender.wc;
    if (!wc) return { ok: false, error: 'mittente sconosciuto' };
    if (msg && msg.off === true) {
      liveSubs.delete(wc);
      return { ok: true, subscribed: false };
    }
    let scartati = 0;
    if (Array.isArray(msg && msg.watch)) {
      // Solo nomi di documento: un id con una barra uscirebbe dalla collezione.
      const puliti = Array.from(new Set(msg.watch.map((s) => String(s || '')).filter((s) => /^[A-Za-z0-9_-]{1,120}$/.test(s))));
      const tetto = (LIVE && LIVE.SEGUITI_TETTO) || 500;
      scartati = Math.max(0, puliti.length - tetto);
      liveSubs.set(wc, new Set(puliti.slice(0, tetto)));
    } else if (!liveSubs.has(wc)) {
      liveSubs.set(wc, new Set());
    }
    if (!wc.__filoLiveBound) {
      wc.__filoLiveBound = true;
      try { wc.once('destroyed', () => liveSubs.delete(wc)); } catch (_) {}
    }
    const base = { ok: true, subscribed: true, ...(scartati ? { scartati } : {}) };
    if (!(msg && msg.giro === true)) return base;
    if (!inVistaDi(sender)) return { ...base, giro: { kind: 'fuori-vista' } };
    const w = liveWatcherDi();
    if (!w) return { ok: false, error: 'giro non disponibile' };
    const esito = await w.tick({ force: msg.force === true });
    if (esito && esito.kind !== 'skipped') liveAvvisaAltre(esito, wc);
    return { ...base, giro: esito };
  }));

  // ── Chi pubblica la vista, e quando ──────────────────────────────────────
  //
  // La scheda pubblica di un feedback la può scrivere solo chi ha due cose che
  // un utente non ha: l'autorità (le regole ammettono owner e server) e la
  // CHIAVE per leggere lo status vero, che viaggia cifrato — senza la quale
  // "questo fix è chiuso e pulito" non è una frase che si possa dire. Le ha il
  // main dell'owner, ed è per questo che il lavoro sta qui.
  //
  // Gira dopo un caricamento della dashboard e dopo ogni triage, mai più di
  // una volta al minuto (a meno che non sia appena cambiato qualcosa), e non
  // fa niente se la chiave privata non è configurata: senza, ogni status
  // sarebbe illeggibile e la sincronizzazione svuoterebbe la bacheca.
  let syncTimer = null;
  let syncing = false;
  let lastSyncAt = 0;
  const SYNC_MIN_GAP_MS = 60_000;

  // ── Da quando ricontrollare le chiusure ──────────────────────────────────
  //
  // La data dell'ultimo giro RIUSCITO, tenuta anche su disco: un riavvio non
  // deve ricomprare la finestra dei cinquecento chiusi più di recente. Il
  // margine toglie un'ora alla data scritta, perché la data di chiusura la
  // mette chi chiude (un'altra macchina, il server) e due orologi non
  // combaciano: senza, una chiusura arrivata con l'orologio indietro cadrebbe
  // fuori dal filtro e non entrerebbe mai in bacheca.
  const MARGINE_SINCRO_MS = 60 * 60 * 1000;
  // Quante schede fuori pagina si chiedono per richiesta (batchGet).
  const SCHEDE_PER_VOLTA = 200;
  let sincroIso = null;   // null = non ancora letta da disco
  function chiaveSincro() {
    return (globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS
      && globalThis.SN_CONST.STORAGE_KEYS.FEEDBACK_SYNC_AT) || 'feedbackSyncAt';
  }
  async function caricaUltimaSincro() {
    if (sincroIso !== null) return sincroIso;
    sincroIso = '';
    try {
      const raw = await globalThis.SN_STORAGE?.getRaw(chiaveSincro(), '');
      if (typeof raw === 'string' && raw) sincroIso = raw;
    } catch (_) { /* senza memoria si riparte dalla finestra intera: costa, non sbaglia */ }
    return sincroIso;
  }
  function ultimaSincroIso() {
    if (!sincroIso) return '';
    const t = Date.parse(sincroIso);
    if (!Number.isFinite(t)) return '';
    return new Date(t - MARGINE_SINCRO_MS).toISOString();
  }
  async function segnaSincroRiuscita() {
    sincroIso = new Date().toISOString();
    try { await globalThis.SN_STORAGE?.setRaw(chiaveSincro(), sincroIso); }
    catch (_) { /* resta in memoria per questa sessione */ }
  }

  /**
   * La scheda pubblica di UN feedback, per id: la scrive, l'aggiorna o la
   * toglie secondo quello che dice il feedback adesso.
   *
   * Esiste perché il giro generale lavora su una pagina di caricamento (i 500
   * più recenti per data d'invio) e i feedback più vecchi ne restano fuori: per
   * loro la bacheca si congelava all'ultimo giro in cui erano dentro. Qui
   * l'id lo sappiamo, quindi non serve cercarli.
   *
   * Best-effort: se fallisce non fa fallire il triage (la segnalazione è già
   * cambiata sul server), ma lo scrive nei log. Il giro generale resta la rete
   * di sicurezza per i feedback recenti.
   */
  async function syncOneCard(id, idToken) {
    const FB = FEEDBACK();
    const V = PUBLIC_VIEW();
    const key = String(id || '');
    if (!FB || !V || !key || !idToken) return;
    try {
      const priv = await getPrivateKey();
      // Senza chiave lo status è un blob: pubblicare sarebbe alla cieca e togliere cancellerebbe
      // una scheda buona. Ci si ferma e lo si dice.
      if (!priv) {
        console.warn('[feedback] scheda singola saltata: chiave privata non configurata');
        return;
      }
      const rows = await FB.getMany([key], { idToken });
      const row = rows && rows[0];
      if (!row) return; // cancellato nel frattempo: se ne occupa il giro generale
      const fb = await decryptFeedbackObject(row, priv);
      const card = V.cardFor(fb);
      if (!card) {
        await FB.unpublishPublicCard(key, { idToken });
      } else {
        // Voti e riaperture stanno sulla scheda: la maschera non li tocca, ma quelli rimasti sul
        // documento vanno portati dentro come fa il giro generale.
        let before = null;
        try { before = await FB.getPublic(key, { idToken }); } catch (_) {}
        const carry = V.carryUserFields(fb, before);
        await FB.publishPublicCard(key, Object.keys(carry).length ? { ...card, ...carry } : card, { idToken });
      }
      cardsCache = { at: 0, rows: [] }; // la prossima lettura rilegge davvero
      if (typeof FB.forgetAllPublic === 'function') FB.forgetAllPublic();
    } catch (e) {
      console.warn('[feedback] scheda singola non aggiornata:', e?.message || e);
    }
  }

  /**
   * Il caricamento generale guarda i feedback più recenti PER DATA D'INVIO, e
   * Filo quel tetto l'ha passato: le segnalazioni più vecchie restano fuori, e
   * quello che succede a loro non arriva in bacheca. Il triage fatto dentro
   * l'app ha l'id in mano e scrive la scheda da sé, ma non è l'unico modo in
   * cui una segnalazione si chiude: nel giro delle routine la chiude il server
   * quando il lavoro viene fuso, e dal terminale la chiude un comando. In quei
   * casi l'unico a poter scrivere la scheda è questo giro, che però non le
   * vedeva.
   *
   * Due aggiunte, tutte e due limitate e a costo fisso:
   *   · le segnalazioni CHIUSE più di recente (una query ordinata per data di
   *     chiusura): è lì che sta una segnalazione vecchia chiusa oggi;
   *   · i feedback delle schede già in bacheca che non sono nella pagina: così
   *     un fix vecchio che torna in lavorazione perde la scheda, invece di
   *     restare «risolto», votabile e riapribile a pagamento.
   *
   * Best-effort: se una delle due domande non riesce, il giro prosegue con
   * quello che ha invece di fermarsi. Torna anche gli id aggiunti, perché su
   * quelli chi pubblica è più prudente (vedi `statusLeggibile`), e
   * `schedeCoperte`: se ogni scheda in bacheca ha il suo feedback sotto gli
   * occhi, una scheda rimasta sola è un orfano vero e si può togliere.
   */
  async function conLeSegnalazioniFuoriPagina(base, idToken, schede, sinceIso) {
    const FB = FEEDBACK();
    const rows = Array.isArray(base) ? base.slice() : [];
    const aggiunti = new Set();
    let chiusiLetti = false;
    if (!FB || !idToken) return { rows, aggiunti, schedeCoperte: false, chiusiLetti };
    const visti = new Set(rows.map((r) => String((r && r._id) || '')).filter(Boolean));
    const aggiungi = (arr) => {
      for (const r of Array.isArray(arr) ? arr : []) {
        const id = String((r && r._id) || '');
        if (!id || visti.has(id)) continue;
        visti.add(id);
        aggiunti.add(id);
        rows.push(r);
      }
    };

    if (typeof FB.listResolved === 'function') {
      // Solo le chiusure arrivate DOPO l'ultimo giro riuscito: quelle di prima
      // hanno già la loro scheda, e rileggerle ogni minuto era il grosso del
      // conto. Alla prima sincronizzazione dopo l'avvio la data non c'è e si
      // riparte dalla finestra intera, una volta.
      const campi = Array.isArray(FB.CAMPI_LISTA) ? FB.CAMPI_LISTA : null;
      try {
        aggiungi(await FB.listResolved({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 30000, idToken, sinceIso, fields: campi }));
        chiusiLetti = true;
      } catch (e) { console.warn('[feedback] chiusi di recente non letti:', e?.message || e); }
    }

    // Le schede fuori pagina si chiedono TUTTE, a blocchi: fermarsi al tetto
    // lasciava indietro proprio le schede più vecchie, che sono quelle che
    // nessun'altra strada guarda.
    const mancanti = (Array.isArray(schede) ? schede : [])
      .map((c) => String((c && c._id) || ''))
      .filter((id) => id && !visti.has(id));
    let schedeCoperte = true;
    for (let i = 0; i < mancanti.length; i += SCHEDE_PER_VOLTA) {
      const pezzo = mancanti.slice(i, i + SCHEDE_PER_VOLTA);
      try {
        // eslint-disable-next-line no-await-in-loop
        aggiungi(await FB.getMany(pezzo, { idToken, timeoutMs: 30000, fields: Array.isArray(FB.CAMPI_LISTA) ? FB.CAMPI_LISTA : null }));
      } catch (e) {
        schedeCoperte = false;
        console.warn('[feedback] feedback delle schede fuori pagina non letti:', e?.message || e);
      }
    }
    return { rows, aggiunti, schedeCoperte, chiusiLetti };
  }

  // Uno stato illeggibile non è «niente scheda»: pubblicare o togliere su quello farebbe
  // sparire dalla bacheca un fix buono, quindi sulle segnalazioni fuori pagina si sta fermi.
  function statusLeggibile(fb) {
    const MR = globalThis.SN_MANAGE_REVIEW;
    const v = fb && fb.status;
    if (!v) return true; // stato assente = «da lavorare»: non è illeggibile
    if (MR && typeof MR.valueUnreadable === 'function') return !MR.valueUnreadable(v);
    return !String(v).startsWith('FENC');
  }

  function scheduleViewSync({ delayMs = 2000, force = false, rows = null } = {}) {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncPublicView({ force, rows }).catch(() => {});
    }, delayMs);
    if (typeof syncTimer.unref === 'function') syncTimer.unref();
  }

  async function syncPublicView({ force = false, rows = null } = {}) {
    const FB = FEEDBACK();
    const V = PUBLIC_VIEW();
    if (!FB || !V || syncing || !auth.isAdmin()) return { ok: false, skipped: true };
    if (!force && Date.now() - lastSyncAt < SYNC_MIN_GAP_MS) return { ok: false, skipped: true };
    syncing = true;
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, skipped: true };
      const priv = await getPrivateKey();
      if (!priv) {
        console.warn('[feedback] vista pubblica: chiave privata non configurata, sincronizzazione saltata');
        return { ok: false, skipped: true };
      }
      const base = (Array.isArray(rows) && rows.length)
        ? rows
        : await FB.list({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 30000, idToken, fields: FB.CAMPI_LISTA });
      // Le schede già in bacheca si leggono una volta sola e servono due volte:
      // per pescare i feedback fuori pagina che ne hanno una, e per il piano.
      // Una volta sola DAVVERO: il giro parte due secondi dopo il caricamento
      // che le ha appena lette, e ripeterlo con `fresh` era la seconda delle
      // due passate che questo caricamento pagava. Le scritture sotto buttano
      // la memoria breve da sé, quindi il giro dopo rilegge comunque.
      const published = await publicCards();
      await caricaUltimaSincro();
      const { rows: raw, aggiunti, schedeCoperte, chiusiLetti } = await conLeSegnalazioniFuoriPagina(base, idToken, published, ultimaSincroIso());
      const decifrati = new Array(raw.length);
      let next = 0;
      const worker = async () => {
        while (next < raw.length) {
          const i = next++;
          decifrati[i] = await decryptFeedbackObject(raw[i] || {}, priv);
        }
      };
      await Promise.all(Array.from({ length: DECRYPT_CONCURRENCY }, worker));
      const feedbacks = decifrati.filter(
        (f) => !aggiunti.has(String((f && f._id) || '')) || statusLeggibile(f),
      );

      // `complete` decide una cosa sola: se una scheda rimasta senza feedback
      // è un orfano da togliere. Guardava se la pagina per data d'invio aveva
      // toccato il tetto — e passati i cinquecento feedback la risposta è
      // sempre «sì», cioè da allora nessuna scheda orfana è più uscita dalla
      // bacheca, in silenzio. La domanda giusta è un'altra e non costa niente
      // in più: il feedback di OGNI scheda in bacheca l'abbiamo appena
      // chiesto (`schedeCoperte`), quindi quello che non è tornato non esiste.
      //
      // E vale solo se non abbiamo SCARTATO niente: una segnalazione pescata
      // fuori pagina con lo stato illeggibile non entra in `feedbacks`, e per
      // chi fa il piano è indistinguibile da una cancellata. Toglierle la
      // scheda vorrebbe dire far sparire dalla bacheca un fix buono perché
      // una decifratura non è riuscita.
      const scartate = decifrati.length !== feedbacks.length;
      const complete = !scartate && (schedeCoperte || base.length < FB.LIST_PAGE_SIZE);
      const plan = V.planSync(published, feedbacks, { complete });
      for (const { id, card } of plan.upsert) await FB.publishPublicCard(id, card, { idToken });
      for (const id of plan.remove) await FB.unpublishPublicCard(id, { idToken });

      // Il contatore dei numeri si alza solo fino a un numero provato (#923); il massimo di tutti si
      // chiede al server (i caricati sono solo i più recenti) e fa da pavimento per riportarlo giù.
      const provato = FB.maxSeqProvato(raw);
      let piuAlto = null;
      try { piuAlto = await FB.maxSeq({ idToken, timeoutMs: 15000 }); }
      catch (e) { console.warn('[feedback] numero più alto non letto:', e?.message || e); }
      if (provato > 0 || piuAlto > 0) {
        try { await FB.ensureSeqCounter(provato, { idToken, pavimento: piuAlto }); }
        catch (e) { console.warn('[feedback] contatore dei numeri non aggiornato:', e?.message || e); }
      }

      lastSyncAt = Date.now();
      // La data si sposta solo se la domanda sulle chiusure è andata a buon
      // fine: spostarla dopo un giro che non le ha lette lascerebbe indietro
      // per sempre proprio quelle che non ha guardato.
      if (chiusiLetti) await segnaSincroRiuscita();
      if (plan.upsert.length || plan.remove.length) {
        cardsCache = { at: 0, rows: [] };
        // Le schede sono appena cambiate: anche la cache della lettura completa non vale più.
        if (typeof FB.forgetAllPublic === 'function') FB.forgetAllPublic();
        console.log('[feedback] vista pubblica aggiornata:',
          `${plan.upsert.length} schede scritte, ${plan.remove.length} tolte`);
      }
      return { ok: true, published: plan.upsert.length, removed: plan.remove.length };
    } catch (e) {
      console.warn('[feedback] sincronizzazione della vista pubblica non riuscita:', e?.message || e);
      return { ok: false, error: e?.message || String(e) };
    } finally {
      syncing = false;
    }
  }

  // Una pagina di gestione già aperta deve accorgersi di una richiesta nuova; ad avvisare è il
  // main: una lettura sola con dieci schede. Vedi services/mergeApprovalSignal.js.
  try {
    require('../mergeApprovalSignal').start({
      isAdmin: () => auth.isAdmin(),
      read: listMergeApprovals,
      broadcast: (m) => ctx.broadcastToFiloPages(m),
      type: MSG.MERGE_APPROVALS_CHANGED,
    });
  } catch (e) {
    console.warn('[Filo] campanello fusioni non agganciato:', e?.message || e);
  }

  on(MSG.MERGE_APPROVAL_APPROVE, ownerOnly(async (msg) => {
    const r = await callSecurityFunction('ownerMergeApprovals', { op: 'approve', id: String(msg?.id || '') });
    if (r && r.ok === false) return { ok: false, error: r.detail || r.reason || 'Fusione non riuscita.' };
    // Alla pagina arriva tutto l'esito, non solo esito e sha: senza riallineamento e motivo
    // diceva «la richiesta decade» a un riallineamento riuscito.
    const out = { ok: true, result: (r && r.result) || '', sha: (r && r.sha) || '', headSha: (r && r.headSha) || '' };
    if (r && r.realigned && typeof r.realigned === 'object') {
      out.realigned = {
        from: String(r.realigned.from || ''),
        to: String(r.realigned.to || ''),
        mainSha: String(r.realigned.mainSha || ''),
      };
    }
    if (r && r.newRequest) out.newRequest = String(r.newRequest);
    if (r && Array.isArray(r.newBlocks)) out.newBlocks = r.newBlocks;
    if (r && r.realignReason) out.realignReason = String(r.realignReason);
    if (r && r.reason) out.reason = String(r.reason);
    return out;
  }));

  // «Salta il controllo»: l'owner ha letto la bocciatura dell'audit di
  // sicurezza e decide di andare avanti. Stesso cancello delle approvazioni di
  // fusione — solo pagine filo://, solo il proprietario — perché è lo stesso
  // tipo di gesto: un'eccezione a un controllo automatico, fatta davanti allo
  // schermo e non da un terminale che potrebbe non essere nelle sue mani.
  //
  // Non è un via libera cieco: il server segna l'audit come saltato e poi fa
  // partire il cancello di fusione, che può fermare tutto lo stesso. Quello che
  // torna è l'esito VERO di quel cancello, non un "fatto" generico.
  const ESITI_SALTA = ['fuso', 'bloccato', 'conflitto', 'ramo_assente', 'attesa_server', 'server_al_pc', 'rimandato', 'all_owner', 'mosso', 'senza_controllo'];
  on(MSG.LIVELLO4_SALTA, ownerOnly(async (msg) => {
    const feedbackId = String(msg?.feedbackId || '').trim();
    if (!feedbackId) return { ok: false, error: 'Manca la segnalazione su cui saltare il controllo.' };
    const r = await callSecurityFunction('ownerSkipSecaudit', { feedbackId });
    if (!r || r.ok === false) {
      // `error` è la frase del server per l'owner; `reason` il codice, solo se la frase manca.
      return { ok: false, error: (r && (r.error || r.detail || r.reason)) || 'Il server non ha saltato il controllo.' };
    }
    // Un esito che il client non conosce passa com'è: non si traduce in un successo inventato.
    const esito = String(r.esito || r.result || '').trim();
    const out = { ok: true, esito: ESITI_SALTA.includes(esito) ? esito : esito };
    if (r.requestId) out.requestId = String(r.requestId);
    if (r.sha) out.sha = String(r.sha);
    if (r.error) out.error = String(r.error);
    return out;
  }));

  // Il segno di mittente pericoloso (#922). La frase di `clear` arriva dalla pagina, che la manda solo dopo
  // il sì dell'owner: qui non si inventa, e il server rifiuta qualunque altra.
  on(MSG.FEEDBACK_SENDER_FLAG, ownerOnly(async (msg) => {
    const feedbackId = String(msg?.feedbackId || '').trim();
    const action = String(msg?.action || '');
    if (!feedbackId) return { ok: false, error: 'Manca il feedback di cui leggere il mittente.' };
    if (action !== 'read' && action !== 'clear') return { ok: false, error: 'Sul segno si può solo leggere o togliere.' };
    const data = { feedbackId, action };
    if (action === 'clear') data.conferma = String(msg?.conferma ?? '');
    let r;
    try {
      r = await callSecurityFunction('ownerSenderFlag', data);
    } catch (e) {
      return { ok: false, error: erroreSegno(e) };
    }
    if (!r || r.ok === false) {
      return { ok: false, error: (r && (r.detail || r.reason || r.error)) || 'Il server non ha risposto sul segno.' };
    }
    const out = {
      ok: true,
      flagged: r.flagged === true,
      reason: typeof r.reason === 'string' ? r.reason : '',
      flaggedAt: aIso(r.flaggedAt),
      clearedAt: aIso(r.clearedAt),
    };
    // Una risposta di `clear` che non riporta l'ora la conosce comunque chi l'ha chiesta.
    if (action === 'clear' && !out.flagged && !out.clearedAt) out.clearedAt = new Date().toISOString();
    return out;
  }));

  // Le domande all'owner (#1149): il main fa solo da tramite verso ownerDomande. Le azioni le applica il server,
  // che decide anche chi ha scritto ogni turno: la pagina non può dichiararlo.
  async function chiamaDomande(data) {
    let r;
    try {
      r = await callSecurityFunction('ownerDomande', data);
    } catch (e) {
      return { ok: false, error: erroreDomande(e) };
    }
    if (!r || r.ok === false) return { ok: false, error: (r && (r.detail || r.reason || r.error)) || 'Il server non ha risposto sulle domande.' };
    return r;
  }

  on(MSG.DOMANDE_ELENCO, ownerOnly(async (msg) => {
    const data = { op: 'elenco' };
    if (Number.isFinite(msg?.dopo) && msg.dopo > 0) data.dopo = msg.dopo;
    if (msg?.tutte === true) data.tutte = true;
    const r = await chiamaDomande(data);
    if (!r.ok) return r;
    return {
      ok: true,
      domande: Array.isArray(r.domande) ? r.domande : [],
      riferimenti: r.riferimenti && typeof r.riferimenti === 'object' ? r.riferimenti : {},
      adesso: Number(r.adesso) || 0,
      // Oltre il tetto dell'elenco il server lo dice: la pagina non deve credere di vederle tutte.
      altre: r.altre === true,
    };
  }));

  on(MSG.DOMANDA_MOSTRA, ownerOnly(async (msg) => {
    const id = String(msg?.id || '').trim();
    if (!id) return { ok: false, error: 'Manca la domanda da mostrare.' };
    const r = await chiamaDomande({ op: 'mostra', id });
    if (!r.ok) return r;
    return { ok: true, domanda: r.domanda || null, riferimenti: r.riferimenti || {} };
  }));

  on(MSG.DOMANDA_RISPONDI, ownerOnly(async (msg) => {
    const id = String(msg?.id || '').trim();
    if (!id) return { ok: false, error: 'Manca la domanda a cui rispondere.' };
    const data = { op: 'rispondi', id };
    if (Number.isInteger(msg?.scelta)) data.scelta = msg.scelta;
    if (typeof msg?.testo === 'string' && msg.testo.trim()) data.testo = msg.testo;
    if (data.scelta === undefined && data.testo === undefined) return { ok: false, error: 'Scegli un’opzione o scrivi una risposta.' };
    const r = await chiamaDomande(data);
    if (!r.ok) return r;
    return { ok: true, domanda: r.domanda || null, esito: r.esito || null };
  }));

  on(MSG.DOMANDE_CONSIGLIO, ownerOnly(async (msg) => {
    const ids = Array.isArray(msg?.ids) ? msg.ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
    if (!ids.length) return { ok: false, error: 'Nessuna domanda selezionata.' };
    const r = await chiamaDomande({ op: 'consiglio', ids });
    if (!r.ok) return r;
    return { ok: true, esiti: Array.isArray(r.esiti) ? r.esiti : [] };
  }));

  for (const [tipo, op] of [[MSG.DOMANDA_ARCHIVIA, 'archivia'], [MSG.DOMANDA_RIAPRI, 'riapri']]) {
    on(tipo, ownerOnly(async (msg) => {
      const id = String(msg?.id || '').trim();
      if (!id) return { ok: false, error: 'Manca la domanda.' };
      const r = await chiamaDomande({ op, id });
      if (!r.ok) return r;
      return { ok: true, domanda: r.domanda || null };
    }));
  }

  // «Segna fidato» (#1148), e `fidato: false` per toglierla: la fiducia la scrive solo il server, mai la pagina né il main col token.
  on(MSG.FIDUCIA_SEGNA, ownerOnly(async (msg) => {
    const feedbackId = String(msg?.feedbackId || '').trim();
    const togli = msg?.fidato === false;
    if (!feedbackId) return { ok: false, error: 'Manca il feedback da segnare fidato.' };
    let r;
    try {
      r = await callSecurityFunction('ownerFiducia', { op: togli ? 'togli' : 'segna', feedbackId });
    } catch (e) {
      if (e?.httpStatus === 404) return { ok: false, error: 'La funzione «segna fidato» non è ancora pubblicata sul server.' };
      if (String(e?.code || '').toUpperCase() === 'PERMISSION_DENIED') return { ok: false, error: 'Il server dice che questo account non può segnare fidato: serve quello del proprietario.' };
      if (e?.name === 'TypeError') return { ok: false, error: 'Il server non risponde: controlla la connessione e riprova.' };
      return { ok: false, error: e?.detail || e?.message || 'Non riuscito.' };
    }
    if (!r || r.ok === false) return { ok: false, error: (r && (r.detail || r.reason)) || (togli ? 'Il server non ha tolto la fiducia.' : 'Il server non l’ha segnato fidato.') };
    return Object.assign({ ok: true, fiducia: togli ? 'non_fidato' : 'fidato' }, r.rimessoInCoda === true ? { rimessoInCoda: true } : {});
  }));

  // I compiti delle routine (SPEC-DOMANDE.md §6): il main fa da tramite verso ownerCompiti e rifà il controllo della
  // pagina (SN_COMPITI); fiducia e numeri li decide il server. Dalla finestra scrive l'owner, mai una sessione.
  async function chiamaCompiti(data, nonAncora) {
    let r;
    try {
      r = await callSecurityFunction('ownerCompiti', data);
    } catch (e) {
      return { ok: false, error: erroreCompiti(e, nonAncora) };
    }
    if (nonAncora && r && r.ok === false && r.errore === 'op_sconosciuta') return { ok: false, error: nonAncora };
    if (!r || r.ok === false) return { ok: false, error: (r && (r.dettaglio || r.errore || r.detail)) || 'Il server non ha risposto sui compiti.' };
    return r;
  }
  on(MSG.COMPITI_ELENCO, ownerOnly(async (msg) => {
    const data = { op: 'elenco' };
    if (Number.isInteger(msg?.storico) && msg.storico > 0) data.storico = msg.storico;
    if (Number.isFinite(msg?.prima) && msg.prima > 0) data.prima = msg.prima;
    // Gli ultimi già visti allo stesso istante del cursore: senza, una pagina che si chiude lì ne salterebbe.
    if (data.prima && Array.isArray(msg?.visti)) data.visti = msg.visti.filter((x) => /^C-\d{1,9}$/.test(String(x))).slice(0, 500);
    const r = await chiamaCompiti(data);
    if (!r.ok) return r;
    return {
      ok: true,
      aperti: Array.isArray(r.aperti) ? r.aperti : [],
      storico: Array.isArray(r.storico) ? r.storico : [],
      // Oltre la pagina dello storico il server lo dice: la scheda non deve credere di vederli tutti.
      altri: r.altri === true,
      adesso: Number(r.adesso) || 0,
      ambiti: Array.isArray(r.ambiti) ? r.ambiti : [],
    };
  }));
  on(MSG.COMPITO_CREA, ownerOnly(async (msg) => {
    const v = globalThis.SN_COMPITI.validaNuovo(msg?.compito);
    if (!v.ok) return { ok: false, error: v.testo };
    const r = await chiamaCompiti({ op: 'crea', compito: v.compito });
    if (!r.ok) return r;
    return { ok: true, id: String(r.id || '') };
  }));
  on(MSG.COMPITO_ANNULLA, ownerOnly(async (msg) => {
    const id = String(msg?.id || '').trim();
    if (!/^C-\d{1,9}$/.test(id)) return { ok: false, error: 'Manca il compito da annullare.' };
    const r = await chiamaCompiti({ op: 'annulla', id });
    if (!r.ok) return r;
    return { ok: true, id };
  }));

  // I compiti ricorrenti (SPEC-DOMANDE.md §4.1): li scrive solo l'owner. Il main rifà i controlli della scheda
  // (ricorrenti.js per i campi suoi, SN_COMPITI per le scelte); un ambito non ancora attivo vale: il ricorrente lo aspetta.
  const NON_ANCORA_RICORRENTI = 'I compiti ricorrenti non sono ancora sul server: arrivano col prossimo aggiornamento del server.';
  const idRicorrente = (v) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return /^[A-Za-z0-9_.:-]{1,200}$/.test(s) ? s : '';
  };
  on(MSG.RICORRENTI_ELENCO, ownerOnly(async () => {
    const r = await chiamaCompiti({ op: 'ricorrenti' }, NON_ANCORA_RICORRENTI);
    if (!r.ok) return r;
    return {
      ok: true,
      adesso: Number(r.adesso) || 0,
      ricorrenti: Array.isArray(r.ricorrenti) ? r.ricorrenti : [],
      ambiti: Array.isArray(r.ambiti) ? r.ambiti : [],
    };
  }));
  on(MSG.RICORRENTE_SALVA, ownerOnly(async (msg) => {
    const raw = msg?.ricorrente;
    const K = globalThis.SN_COMPITI;
    const c = globalThis.SN_RICORRENTI.validaCampi(raw);
    if (!c.ok) return { ok: false, error: K.frase(c.dettaglio) };
    const s = K.validaScelte(raw, undefined, { spenti: true });
    if (!s.ok) return { ok: false, error: s.testo };
    const ricorrente = Object.assign({}, c.campi, s.scelte);
    if (raw.id !== undefined && raw.id !== null && raw.id !== '') {
      ricorrente.id = idRicorrente(raw.id);
      if (!ricorrente.id) return { ok: false, error: 'Il ricorrente da salvare non ha un identificativo valido.' };
    }
    const r = await chiamaCompiti({ op: 'ricorrente_salva', ricorrente }, NON_ANCORA_RICORRENTI);
    if (!r.ok) return r;
    return { ok: true, id: String(r.id || ricorrente.id || '') };
  }));
  on(MSG.RICORRENTE_TOGLI, ownerOnly(async (msg) => {
    const id = idRicorrente(msg?.id);
    if (!id) return { ok: false, error: 'Manca il ricorrente da togliere.' };
    const r = await chiamaCompiti({ op: 'ricorrente_togli', id }, NON_ANCORA_RICORRENTI);
    if (!r.ok) return r;
    return { ok: true, id };
  }));
  on(MSG.RICORRENTE_AVVIA, ownerOnly(async (msg) => {
    const id = idRicorrente(msg?.id);
    if (!id) return { ok: false, error: 'Manca il ricorrente da avviare.' };
    const r = await chiamaCompiti({ op: 'ricorrente_avvia', id }, NON_ANCORA_RICORRENTI);
    if (!r.ok) return r;
    return { ok: true, id, compitoId: String(r.compitoId || '') };
  }));
  // Chi può aggiungere un ambito (sì a una domanda) deve poterlo togliere: gli iniziali e quelli in uso li rifiuta il server.
  on(MSG.AMBITO_TOGLI, ownerOnly(async (msg) => {
    const nome = typeof msg?.nome === 'string' ? msg.nome.trim() : '';
    if (!/^[a-z][a-z_]{2,30}$/.test(nome)) return { ok: false, error: 'Manca l’ambito da togliere.' };
    const r = await chiamaCompiti({ op: 'ambito_togli', nome }, 'Togliere un ambito non è ancora sul server: arriva col prossimo aggiornamento del server.');
    if (!r.ok) return r;
    return { ok: true, nome };
  }));

  on(MSG.MERGE_APPROVAL_DISCARD, ownerOnly(async (msg) => {
    const r = await callSecurityFunction('ownerMergeApprovals', { op: 'discard', id: String(msg?.id || '') });
    if (r && r.ok === false) return { ok: false, error: r.detail || r.reason || 'Non riuscita.' };
    return { ok: true, result: 'discarded' };
  }));

  // All'editor servono anche la catena in uso negli slot spostati mai salvati e
  // i nickname del registro condiviso, che il server dei giudici unisce al loro.
  async function perEditor(models) {
    let settings = null;
    try { settings = await ctx.getEffectiveSettings(); } catch (_) {}
    if (typeof ctx.fillMovedSlots === 'function') ctx.fillMovedSlots(models, settings);
    const shared = (Defaults.get() || {}).modelRegistry || {};
    models.sharedNicknames = Object.keys(shared).map((nick) => ({ nick, label: String((shared[nick] || {}).label || '') }));
    // Gli slot spostati girano nell'app: i loro nickname si risolvono sul registro in uso qui (#465).
    models.appRegistry = (settings && settings.modelRegistry && typeof settings.modelRegistry === 'object') ? settings.modelRegistry : {};
    return models;
  }

  // Config "modelli di supporto" (doc config/supportModels). Owner-only.
  // GET legge gli slot; UPDATE scrive solo i campi passati (per-campo PATCH).
  on(MSG.SUPPORT_MODELS_GET, ownerOnly(async () => {
    try {
      const models = await perEditor(await SupportModels.get());
      return { ok: true, models };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // La dashboard sa quali feedback sono «non filtrati»: manda gli id e il backend ri-esegue
  // solo i giudici mancanti.
  on(MSG.FEEDBACK_REEVALUATE, ownerOnly(async (msg) => {
    try {
      const feedbackIds = Array.isArray(msg.feedbackIds)
        ? msg.feedbackIds.map(String).filter(Boolean)
        : [];
      if (!feedbackIds.length) return { ok: true, reevaluated: 0, results: [] };
      const r = await callSecurityFunction('reevaluateUnfiltered', { feedbackIds });
      return Object.assign({ ok: true }, r);
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  on(MSG.SUPPORT_MODELS_UPDATE, ownerOnly(async (msg) => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const partial = Object.assign({}, msg.models || {});
      if (msg.judgeRegistry && typeof msg.judgeRegistry === 'object') partial.judgeRegistry = msg.judgeRegistry;
      if (typeof msg.openrouterKey === 'string') partial.openrouterKey = msg.openrouterKey;
      // Timeout per giudice: si scrive solo se passato, PATCH per-campo che non tocca il resto.
      if (msg.judgeTimeoutMs != null) partial.judgeTimeoutMs = msg.judgeTimeoutMs;
      const models = await perEditor(await SupportModels.update(partial, idToken));
      return { ok: true, models };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));
};
