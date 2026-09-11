// Handler di dominio: account "Accedi con Google", triage admin dei feedback
// e config condivisa "modelli predefiniti".

const path = require('node:path');
const auth = require('../../auth/google-auth');
const Defaults = require('../defaultsStore');
const SupportModels = require('../supportModelsStore');
const { permissionDeniedHelp } = require('../feedbackError');

// Base delle Cloud Function callable del backend di sicurezza (filo-security):
// stessa region/progetto del deploy. Override per i test via env.
const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

// Invoca una callable gen2 (protocollo onCall) con l'ID token admin. Lancia su
// errore (auth/rete/HTTP). Speculare a handlers/redteam.js → callable().
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
    try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
    throw new Error(`callable ${name} ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const body = await res.json();
  return body && body.result;
}

// ---- Slot chiave privata feedback (S1.3) ----------------------------------------
// La chiave privata non deve MAI uscire dal main process né essere passata al
// renderer. Il main la legge da env FILO_FEEDBACK_PRIVKEY oppure da
// storage.json (campo `feedbackPrivateKey`), in quest'ordine.
//
// DOVE L'OWNER LA METTE
//   - Locale: `FILO_FEEDBACK_PRIVKEY=<base64>` nel file `tests/agent/.env`
//     (gitignorato) oppure come variabile d'ambiente prima di lanciare Filo.
//   - Cloud/routine: passata come env `FILO_FEEDBACK_PRIVKEY` nella config
//     del runner (secrets della routine — NON in chiaro nel prompt).
//   - Alternativa: impostare il campo `feedbackPrivateKey` in storage.json
//     (il file di storage locale, mai nel repo) con il valore base64 della chiave.
//     Lo storage si trova in %APPDATA%/Filo/storage.json (produzione) o nel
//     percorso in $FILO_USER_DATA/storage.json (test).
//
// La chiave viene letta a ogni chiamata (non cachata) per restare aggiornata
// se l'utente la cambia a runtime.
async function getPrivateKey() {
  // 1. Variabile d'ambiente (priorità massima: setting esplicito del runner).
  if (process.env.FILO_FEEDBACK_PRIVKEY) return process.env.FILO_FEEDBACK_PRIVKEY.trim();

  // 2. File .env locale (per comodità in sviluppo; gitignorato).
  try {
    const fs = require('node:fs');
    // __dirname = src/main/services/handlers → root = ../../../../
    const envFile = path.join(__dirname, '..', '..', '..', '..', 'tests', 'agent', '.env');
    if (fs.existsSync(envFile)) {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^FILO_FEEDBACK_PRIVKEY\s*=\s*(.+)$/);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch (_) {}

  // 3. Storage.json locale (campo feedbackPrivateKey).
  try {
    if (globalThis.SN_STORAGE) {
      const v = await globalThis.SN_STORAGE.getRaw('feedbackPrivateKey', null);
      if (v && typeof v === 'string') return v.trim();
    }
  } catch (_) {}

  return null;
}

// Questo indirizzo è un allegato di Filo? Il deposito è uno solo, e il nome lo
// tiene il modulo condiviso dei feedback: qui si controlla che l'indirizzo
// appartenga a QUELLO, non a un deposito qualunque di Google. Senza, il canale
// che decifra un allegato diventa un modo per farsi scaricare altro.
function allegatoDiFilo(url) {
  const u = String(url || '');
  const cfg = (globalThis.SN_FEEDBACK && globalThis.SN_FEEDBACK.configPublic) || null;
  const bucket = cfg && cfg.bucket ? String(cfg.bucket) : '';
  const progetto = cfg && cfg.projectId ? String(cfg.projectId) : '';
  if (!bucket && !progetto) return false;
  // Lo stesso deposito ha più nomi ufficiali (quello attuale e quello storico
  // che finisce in appspot.com: gli allegati vecchi hanno ancora quello) e due
  // indirizzi (Firebase Storage e il deposito diretto). Valgono quelli, e
  // nessun altro.
  const depositi = new Set([bucket, progetto ? `${progetto}.firebasestorage.app` : '', progetto ? `${progetto}.appspot.com` : '']);
  depositi.delete('');
  for (const b of depositi) {
    if (u.startsWith(`https://firebasestorage.googleapis.com/v0/b/${b}/o/`)) return true;
    if (u.startsWith(`https://storage.googleapis.com/${b}/`)) return true;
  }
  return false;
}

// Decifra i campi FENC1: di un oggetto con la chiave privata del main.
// Retrocompatibile: i valori non cifrati passano invariati.
// Senza chiave privata i campi cifrati diventano il placeholder leggibile.
// S1.F2.1: aggiunto 'status' (cifrato quando gate on) — NON 'statusPublic' (sempre in chiaro).
// S1.F2.2: aggiunto 'clientId' (cifrato quando gate on; clientIdHash resta in chiaro).
// #476: 'reviewDecision'/'reviewedAt' viaggiano cifrati come 'reviewComment' —
// la revisione dell'owner non deve essere leggibile da chi ha mandato il feedback.
const TEXT_FIELDS_TO_DECRYPT = ['text', 'url', 'name', 'title', 'notes', 'reviewComment', 'reviewDecision', 'reviewedAt', 'status', 'clientId'];
const PLACEHOLDER_NO_KEY = '[cifrato — chiave privata non configurata]';
// Quanti feedback si decifrano insieme nel batch: il pool di thread di Node ha
// 4 posti di default, oltre non si guadagna.
const DECRYPT_CONCURRENCY = 4;

// S1.F2.4: il campo `pipeline` (scritto dal backend di sicurezza sul documento
// PUBBLICO) è cifrato come un'unica stringa FENC1: che racchiude l'INTERO oggetto
// pipeline serializzato in JSON. La dashboard owner deve decifrarlo PRIMA del
// render così classifyBlock/manageReview leggono `fb.pipeline.action` ecc. come
// sempre (ricevono già l'oggetto). Casi: assente → niente; già oggetto (vecchi
// feedback in chiaro, retrocompat) → lascia; FENC1: senza chiave privata →
// lascia la stringa com'è (placeholder, niente crash).
async function decryptPipelineField(out, C, priv) {
  const p = out.pipeline;
  if (!C.isEncrypted(p)) return; // assente, già oggetto, o null: invariato
  if (!priv) return; // senza chiave: lascia la stringa cifrata (no crash)
  try {
    out.pipeline = JSON.parse(await C.decrypt(p, priv));
  } catch (e) {
    console.warn('[auth] decifratura/parse del pipeline fallita:', e?.message || e);
    // lascia il valore com'è: i lettori (classifyBlock) gestiscono `pipeline`
    // non-oggetto come "nessun blocco" senza crashare.
  }
}

// `privKey` (opzionale): la chiave già letta dal chiamante. Il batch della
// dashboard la passa una volta per tutti i documenti — rileggerla dal disco a
// ogni feedback (500 volte per una lista) era solo tempo perso.
async function decryptFeedbackObject(fields, privKey) {
  const C = globalThis.SN_FEEDBACK_CRYPTO;
  if (!C) return fields; // modulo non caricato: passthrough

  const priv = privKey !== undefined ? privKey : await getPrivateKey();
  const out = { ...fields };
  for (const f of TEXT_FIELDS_TO_DECRYPT) {
    const v = out[f];
    if (!C.isEncrypted(v)) continue; // in chiaro o null: invariato
    if (!priv) { out[f] = PLACEHOLDER_NO_KEY; continue; }
    try {
      const plain = await C.decrypt(v, priv);
      // #476: lo `status` è cifrato a lunghezza fissa (imbottito) perché il
      // campo cifrato non riveli lo stato con la sola lunghezza — qui si toglie
      // l'imbottitura, o la dashboard non riconoscerebbe più nessuno stato.
      out[f] = f === 'status' ? plain.trim() : plain;
    } catch (e) {
      console.warn(`[auth] decifratura campo "${f}" fallita:`, e?.message || e);
      out[f] = PLACEHOLDER_NO_KEY;
    }
  }
  await decryptPipelineField(out, C, priv);

  // S1.priority: `priority` è un intero, non testo → logica dedicata (come in
  // decrypt-feedback-fields.mjs). Retrocompat: se è già un numero → invariato.
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
    // senza chiave: lascia il ciphertext invariato (stessa scelta di decryptPipelineField)
  }

  return out;
}

// Il server considera admin questo account? La collezione `admins` è leggibile
// SOLO da un admin (firestore.rules), quindi: 200 = admin, 403 = non admin.
// Ritorna null se la risposta non è concludente (rete giù, token assente…):
// il chiamante mostrerà entrambe le ipotesi invece di affermare il falso.
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
    // Senza il documento admins/<email> la regola nega la lettura stessa: chi
    // non è admin vede 403, mai 404.
    if (res.status === 403 || res.status === 404) return false;
    return null;
  } catch (_) {
    return null;
  }
}

module.exports = function register(on, ctx) {
  const { MSG, broadcastToTabs } = ctx;

  // I token restano nel main process: qui torniamo solo il profilo pubblico
  // + se l'utente è admin (può triagiare i feedback). `uid` è il claim
  // Firebase REALE (request.auth.uid nelle Firestore rules) — diverso
  // dall'email del profilo — usato dalla bacheca (DC2) per riconoscere i
  // propri voti nella mappa `votes` autorevole letta da Firestore.
  on(MSG.AUTH_STATUS, async () => {
    const signedIn = auth.isSignedIn();
    const uid = signedIn ? await auth.getUid() : null;
    return { ok: true, signedIn, isAdmin: auth.isAdmin(), profile: auth.getProfile(), uid };
  });

  on(MSG.AUTH_SIGNIN, async () => {
    try {
      const profile = await auth.signIn();
      broadcastToTabs({ type: MSG.AUTH_CHANGED, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin(), profile });
      // Rinfresca la config condivisa in background. Le chiavi ruotate
      // dall'admin NON si leggono più qui (#581: config/secrets è admin-only e
      // le chiavi arrivano col build); resta utile per config/models.
      Defaults.refresh().catch(() => {});
      // Appena l'owner è dentro, la vista pubblica dei feedback si rimette in
      // pari da sola (#583): è il momento in cui il main ha di nuovo il token.
      if (auth.isAdmin()) scheduleViewSync({ delayMs: 4000, force: true });
      return { ok: true, profile, isAdmin: auth.isAdmin() };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  on(MSG.AUTH_SIGNOUT, async () => {
    try {
      auth.signOut();
      broadcastToTabs({ type: MSG.AUTH_CHANGED, signedIn: false, isAdmin: false, profile: null });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

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
      // `userNote` è la frase in chiaro per chi ha mandato il feedback: l'altra
      // metà dei due testi (il report, cifrato, è `notes`). Va inoltrata, o la
      // dashboard resta l'unica strada da cui quella metà si perde.
      const { id, status, notes, userNote, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride } = msg;
      await globalThis.SN_FEEDBACK.updateStatus(
        id,
        { status, notes, userNote, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride },
        { idToken },
      );
      // Il triage cambia quello che la bacheca deve mostrare (un fix chiuso
      // entra, uno riaperto esce, la frase per chi ha segnalato cambia): la
      // vista pubblica si rifà subito, non al prossimo caricamento.
      scheduleViewSync({ delayMs: 1500, force: true });
      return { ok: true };
    } catch (e) {
      const raw = e?.message || String(e);
      let claims = null;
      try { claims = auth.getTokenClaims(); } catch (_) {}
      // Un 403 può voler dire "non sei admin" oppure "sei admin ma il contenuto
      // del feedback sfora i limiti". Chiediamolo al server invece di tirare a
      // indovinare: la lettura di `admins/<email>` è consentita SOLO agli admin,
      // quindi il suo esito distingue i due casi.
      const serverAdmin = await probeServerAdmin(claims);
      return { ok: false, error: permissionDeniedHelp(raw, claims, { serverAdmin }) };
    }
  }));

  // S1.3: decifratura dei campi feedback nel main (la privkey non esce mai da qui).
  // Il renderer manda i campi con valori potenzialmente cifrati; il main li
  // decifra e ritorna plaintext. Owner-only: se l'utente non è admin rifiuta.
  //
  // Modalità singola:  { fields: {text?,url?,…} } → { ok, fields: {…decifrati} }
  // Modalità batch:    { list: [{…}, …] }         → { ok, list: [{…decifrati}, …] }
  // (Il path singolo esiste per retrocompat; il batch serve alle dashboard che
  //  caricano centinaia di feedback — una sola IPC invece di N.)
  on(MSG.FEEDBACK_DECRYPT_FIELDS, ownerOnly(async (msg) => {
    try {
      // Batch: array di oggetti feedback. La chiave si legge UNA volta e i
      // documenti si decifrano a gruppi in parallelo: la crittografia gira nel
      // pool di thread di Node, quindi in sequenza si usava un solo core e
      // 500 feedback costavano diversi secondi di attesa alla dashboard.
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
      // Singolo (retrocompat).
      const fields = msg.fields || {};
      const decrypted = await decryptFeedbackObject(fields);
      return { ok: true, fields: decrypted };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // S1.2: decifratura di UN allegato immagine. Le immagini dei feedback sono
  // cifrate come byte opachi su Storage (octet-stream): un <img src=URL> diretto
  // mostra un allegato rotto. Qui il main le scarica, le decifra con la chiave
  // privata (che NON esce mai dal main), ne indovina il MIME e torna un data URL
  // mostrabile. Owner-only. Retrocompat: immagini NON cifrate (storiche) passano
  // invariate (data URL dei byte grezzi). Fail-safe: ogni errore → { ok:false }.
  on(MSG.FEEDBACK_DECRYPT_IMAGE, ownerOnly(async (msg) => {
    try {
      const url = String((msg && msg.url) || '');
      // Solo gli allegati DI FILO: il deposito è uno solo, e il suo nome lo
      // tiene il modulo condiviso che carica le immagini. Accettare qualunque
      // indirizzo dei depositi di Google faceva di questo canale un modo per
      // farsi scaricare altro, che non è quello che dice di fare.
      if (!allegatoDiFilo(url)) {
        return { ok: false, error: 'url allegato non valido' };
      }
      const res = await fetch(url);
      if (!res.ok) return { ok: false, error: `download allegato fallito (${res.status})` };
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
          // I byte iniziano come un ciphertext valido ma la decifratura fallisce
          // (chiave sbagliata, dato corrotto): non ripiegare sui byte cifrati
          // (sarebbero comunque illeggibili) — dichiara l'errore.
          return { ok: false, error: 'decifratura immagine fallita' };
        }
      }
      // Un DOCUMENTO (non immagine) torna con il tipo dichiarato dal chiamante:
      // il link della dashboard lo scarica già decifrato, col nome originale.
      // Prima il link puntava ai byte cifrati e l'owner apriva un file rotto.
      const mime = String((msg && msg.mime) || '').trim();
      if (mime && !/^image\//i.test(mime) && /^[\w.+-]+\/[\w.+-]+$/.test(mime)) {
        return { ok: true, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` };
      }
      return { ok: true, dataUrl: IMG.bytesToDataUrl(bytes) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Config "modelli predefiniti" condivisa. La lettura (per l'editor admin)
  // NON espone le chiavi vere, solo se sono configurate. La scrittura è
  // riservata agli admin (Firebase ID token come Bearer): le regole Firestore
  // rifiutano i non-admin. La modifica si propaga a tutti gli utenti.
  on(MSG.DEFAULTS_GET, ownerOnly(async () => {
    try {
      await Defaults.refresh().catch(() => {});
      return { ok: true, config: Defaults.getPublicForAdmin() };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Versione LEGGIBILE DA TUTTI della config modelli: solo i nomi (registry e
  // modello per funzione), mai una chiave. La pagina Opzioni la usa per elencare
  // i modelli predefiniti VERI — prima elencava quelli scritti nel codice, che
  // possono essere stati sostituiti o eliminati dalla configurazione condivisa.
  on(MSG.DEFAULT_MODELS_PUBLIC, async () => {
    try {
      await Defaults.refreshIfStale().catch(() => {});
      const d = Defaults.get();
      return { ok: true, modelRegistry: d.modelRegistry || {}, models: d.models || {} };
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

  // Interruttore master dell'auto-miglioramento (config/automation). Owner-only.
  // Default OFF (autonomia spenta): mentre è OFF anche i feedback "sicuri"
  // richiedono verifica umana. Vedi filo-security DESIGN §2. La scrittura passa
  // dal main con l'ID token admin; le regole Firestore sono la garanzia forte.
  on(MSG.AUTOMATION_GET, ownerOnly(async () => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      const enabled = await Defaults.getAutomationGate(idToken);
      const autoApprove = await Defaults.getAutomationAutoApprove(idToken);
      const proberWhenIdle = await Defaults.getAutomationProberIdle(idToken);
      const routinesEnabled = await Defaults.getRoutinesEnabled(idToken);
      return { ok: true, enabled, autoApprove, proberWhenIdle, routinesEnabled };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Accetta `enabled` (interruttore master) e/o `autoApprove` (mappa dei mittenti
  // ammessi all'auto-approvazione, #446), e tocca SOLO ciò che riceve: la vecchia
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
      const proberWhenIdle = (typeof msg.proberWhenIdle === 'boolean')
        ? await Defaults.setAutomationProberIdle(msg.proberWhenIdle, idToken)
        : await Defaults.getAutomationProberIdle(idToken);
      // Interruttore master delle routine (config/routines): è ciò che ferma il
      // lavoro autonomo, mentre `enabled` qui sopra riguarda solo chi entra in
      // coda da solo. Due decisioni diverse, due interruttori.
      const routinesEnabled = (typeof msg.routinesEnabled === 'boolean')
        ? await Defaults.setRoutinesEnabled(msg.routinesEnabled, idToken)
        : await Defaults.getRoutinesEnabled(idToken);
      return { ok: true, enabled, autoApprove, proberWhenIdle, routinesEnabled };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // I tre bilanci dei giri di correzione e il testo della fase 2
  // (config/routines, campi `cap2`, `cap1`, `cap0`, `fixInstructions` —
  // feedback #561). Owner-only. È la fonte di verità che il server applica
  // quando registra la critica: cambiarli qui ha effetto sul prossimo giro.
  const capsReply = (caps) => ({ ok: true, cap2: caps.cap2, cap1: caps.cap1, cap0: caps.cap0, fixInstructions: caps.fixInstructions });
  on(MSG.AUTOMATION_CAPS_GET, ownerOnly(async () => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      return capsReply(await Defaults.getRoutineCaps(idToken));
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Tocca SOLO i campi che riceve (come AUTOMATION_SET): salvare un bilancio
  // non deve riscrivere gli altri.
  on(MSG.AUTOMATION_CAPS_SET, ownerOnly(async (msg) => {
    try {
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      return capsReply(await Defaults.setRoutineCaps({
        cap2: msg.cap2, cap1: msg.cap1, cap0: msg.cap0, fixInstructions: msg.fixInstructions,
      }, idToken));
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

  // Registri del canale autenticato delle routine. Owner-only, sola lettura.
  //
  // Le due collezioni sono scritte dal backend di sicurezza con l'Admin SDK e
  // nessun client le può leggere: un registro dei rifiuti leggibile da chiunque
  // direbbe a chi sta provando ad abusare del canale quanto è stato notato.
  // Perciò si passa dalla callable, che chiede le credenziali dell'owner.
  on(MSG.ROUTINE_LOG_GET, ownerOnly(async (msg) => {
    try {
      const limit = Number(msg && msg.limit);
      const r = await callSecurityFunction('routineLog', Number.isFinite(limit) ? { limit } : {});
      return { ok: true, rejections: (r && r.rejections) || [], comparisons: (r && r.comparisons) || [] };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // ── Fusioni bloccate, in attesa dell'owner (SPEC-RIDISEGNO-MAX.md §10) ─────
  //
  // I controlli deterministici del server fermano le fusioni che toccano le
  // aree protette. Il lavoro LOCALE dell'owner ci cade dentro quasi sempre —
  // in locale si lavora proprio su quelle cose — e senza una via d'uscita non
  // avrebbe nessuna strada verso il ramo principale (nemmeno a mano: là scrive
  // solo l'identità del server). Il blocco apre quindi una richiesta in attesa,
  // e l'owner la decide da queste tre chiamate.
  //
  // DUE CANCELLI, non uno:
  //   · `isAdmin()` — è il potere dell'owner, e il server lo ricontrolla;
  //   · l'ORIGINE — solo pagine `filo://`. Il canale dei messaggi è uno solo e
  //     ci arrivano anche i content script dei siti visitati: senza questo, un
  //     sito qualunque potrebbe chiedere se c'è una fusione in attesa (e
  //     scoprire su cosa sta lavorando l'owner) o provare a farla approvare
  //     mentre lui guarda altrove. Il gesto che vale è quello fatto sulla
  //     superficie di Filo: è tutto il senso di questa superficie.
  const isFiloOrigin = (origin, sender) => String(origin || '').startsWith('filo://') || !!(sender && sender.isShell);

  function ownerOnly(handler) {
    return async (msg, sender, origin) => {
      // `code`: il motivo in una parola, per chi deve DIRE all'utente cosa
      // succede. Senza, il rifiuto arriva a una pagina come un errore
      // qualunque e finisce tradotto in "controlla la connessione", che non è
      // vero e manda a controllare la cosa sbagliata.
      if (!isFiloOrigin(origin, sender)) return { ok: false, code: 'forbidden', error: 'forbidden' };
      if (!auth.isAdmin()) {
        return {
          ok: false,
          code: 'not_admin',
          error: 'Operazione riservata agli amministratori: accedi con un account autorizzato.',
        };
      }
      try {
        return await handler(msg);
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
      // Le fusioni approvate e mai avvenute (conflitto): restano in vista
      // finché non vengono sistemate, non sono decisioni passate.
      failed: (r && r.failed) || [],
      recent: (r && r.recent) || [],
      ttlMs: Number(r && r.ttlMs) || 0,
    };
  }

  on(MSG.MERGE_APPROVALS_GET, ownerOnly(listMergeApprovals));

  // ── #583: leggere i feedback, e tenere aggiornata la vista pubblica ───────
  //
  // La collezione `feedback` non si legge più senza credenziali. Le due
  // superfici dell'owner (Gestione e la pagina dei feedback) girano in una
  // pagina filo://, dove l'ID token non deve arrivare: chiedono la lettura
  // qui, e qui la si fa col token. Stessi due cancelli delle approvazioni di
  // fusione (`ownerOnly`): sei l'admin, e lo stai chiedendo da una superficie
  // di Filo — un sito visitato non deve poter domandare al main cosa c'è nella
  // posta dell'owner.
  const PUBLIC_VIEW = () => globalThis.SN_FEEDBACK_PUBLIC_VIEW;
  const FEEDBACK = () => globalThis.SN_FEEDBACK;

  // I voti e le riaperture si scrivono sulla SCHEDA pubblica (è l'unico
  // documento che chi vota può aprire), quindi chi legge il feedback dal main
  // se li ritrova riuniti: la dashboard e l'archiviazione a punteggio
  // continuano a leggere `fb.votes` come hanno sempre fatto. I voti storici,
  // rimasti sul documento, non si perdono: la scheda vince solo dove ha
  // qualcosa da dire.
  let cardsCache = { at: 0, rows: [] };
  const CARDS_TTL_MS = 30_000;

  async function publicCards({ fresh = false } = {}) {
    const FB = FEEDBACK();
    if (!FB) return [];
    if (!fresh && Date.now() - cardsCache.at < CARDS_TTL_MS) return cardsCache.rows;
    const rows = await FB.listPublic({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 20000 });
    cardsCache = { at: Date.now(), rows };
    return rows;
  }

  async function mergeCardFields(rows) {
    const V = PUBLIC_VIEW();
    if (!V || !Array.isArray(rows) || rows.length === 0) return rows;
    let cards;
    try { cards = await publicCards(); }
    catch (e) {
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
      const rows = await FB.getMany(ids, { timeoutMs, idToken });
      return { ok: true, rows: await mergeCardFields(rows) };
    }
    if (op !== 'list') return { ok: false, error: `lettura non prevista: ${op}` };

    const fields = (Array.isArray(msg.fields) && msg.fields.length) ? msg.fields : null;
    const pageSize = Math.max(1, Math.min(FB.LIST_PAGE_SIZE, Number(msg.pageSize) || FB.LIST_PAGE_SIZE));
    const rows = await FB.list({ pageSize, timeoutMs, fields, idToken });
    // Una PROIEZIONE (il giro leggero che chiede solo "cosa è cambiato") non
    // porta campi da riunire, e non deve pagare la lettura delle schede a ogni
    // battito. La lista intera invece sì — ed è anche il momento buono per
    // rimettere in pari la vista pubblica.
    if (fields) return { ok: true, rows };
    // Le righe appena lette sono le stesse che servirebbero alla
    // sincronizzazione: gliele passiamo invece di far rileggere mezzo database
    // un attimo dopo.
    scheduleViewSync({ rows });
    return { ok: true, rows: await mergeCardFields(rows) };
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
        // Senza chiave ogni status è un blob: pubblicare sarebbe alla cieca e
        // TOGLIERE cancellerebbe la bacheca. Si sta fermi e lo si dice.
        console.warn('[feedback] vista pubblica: chiave privata non configurata, sincronizzazione saltata');
        return { ok: false, skipped: true };
      }
      const raw = (Array.isArray(rows) && rows.length)
        ? rows
        : await FB.list({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 30000, idToken });
      const feedbacks = new Array(raw.length);
      let next = 0;
      const worker = async () => {
        while (next < raw.length) {
          const i = next++;
          feedbacks[i] = await decryptFeedbackObject(raw[i] || {}, priv);
        }
      };
      await Promise.all(Array.from({ length: DECRYPT_CONCURRENCY }, worker));

      const published = await publicCards({ fresh: true });
      // `complete`: il caricamento non ha toccato il tetto, quindi questi sono
      // TUTTI i feedback che esistono — solo allora una scheda senza feedback
      // è un orfano (feedback cancellato) e si può togliere.
      const complete = raw.length < FB.LIST_PAGE_SIZE;
      const plan = V.planSync(published, feedbacks, { complete });
      for (const { id, card } of plan.upsert) await FB.publishPublicCard(id, card, { idToken });
      for (const id of plan.remove) await FB.unpublishPublicCard(id, { idToken });

      // Il contatore dei numeri: lo crea e lo rimette in pari l'app
      // dell'owner, che è l'unica a poterlo scrivere a piacere. Senza, un
      // feedback nuovo arriverebbe senza numero.
      const maxSeq = feedbacks.reduce((m, f) => Math.max(m, Number(f && f.seq) || 0), 0);
      if (maxSeq > 0) {
        // `allowLower` solo con `complete`: sono TUTTI i feedback che esistono,
        // quindi un contatore più alto del massimo `seq` è stato gonfiato da
        // qualcuno e va riportato giù (chiunque lo può far avanzare di uno).
        try { await FB.ensureSeqCounter(maxSeq, { idToken, allowLower: complete }); }
        catch (e) { console.warn('[feedback] contatore dei numeri non aggiornato:', e?.message || e); }
      }

      lastSyncAt = Date.now();
      if (plan.upsert.length || plan.remove.length) {
        cardsCache = { at: 0, rows: [] }; // la prossima lettura rilegge davvero
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

  // Una pagina di gestione GIÀ APERTA deve accorgersi di una richiesta nuova.
  // Prima l'elenco si leggeva solo all'apertura di una pagina: il terminale
  // diceva "approvala da Filo" e sulla pagina aperta non compariva niente.
  //
  // Chi avvisa è il main, non la pagina, e per due motivi: la lettura è UNA
  // sola anche con dieci schede aperte, e il cancello del proprietario resta in
  // un posto solo. Il campanello e il perché di questa forma stanno in
  // services/mergeApprovalSignal.js.
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
    return { ok: true, result: (r && r.result) || '', sha: (r && r.sha) || '', headSha: (r && r.headSha) || '' };
  }));

  on(MSG.MERGE_APPROVAL_DISCARD, ownerOnly(async (msg) => {
    const r = await callSecurityFunction('ownerMergeApprovals', { op: 'discard', id: String(msg?.id || '') });
    if (r && r.ok === false) return { ok: false, error: r.detail || r.reason || 'Non riuscita.' };
    return { ok: true, result: 'discarded' };
  }));

  // Config "modelli di supporto" (doc config/supportModels). Owner-only.
  // GET legge i 4 slot; UPDATE scrive solo i campi passati (per-campo PATCH).
  on(MSG.SUPPORT_MODELS_GET, ownerOnly(async () => {
    try {
      const models = await SupportModels.get();
      return { ok: true, models };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Ri-valutazione dei feedback "non filtrati": la dashboard (che decifra i
  // pipeline e quindi sa quali sono bianchi) passa la lista degli id; il backend
  // ri-esegue SOLO i giudici mancanti di ciascuno. Owner-only.
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
      // Slot + registro giudici + (eventuale) chiave OpenRouter dei giudici.
      const partial = Object.assign({}, msg.models || {});
      if (msg.judgeRegistry && typeof msg.judgeRegistry === 'object') partial.judgeRegistry = msg.judgeRegistry;
      if (typeof msg.openrouterKey === 'string') partial.openrouterKey = msg.openrouterKey;
      // Timeout per giudice (ms): solo se passato (PATCH per-campo, non tocca il resto).
      if (msg.judgeTimeoutMs != null) partial.judgeTimeoutMs = msg.judgeTimeoutMs;
      const models = await SupportModels.update(partial, idToken);
      return { ok: true, models };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));
};
