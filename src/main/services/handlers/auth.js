// Handler di dominio: account "Accedi con Google", triage admin dei feedback
// e config condivisa "modelli predefiniti".

const path = require('node:path');
const auth = require('../../auth/google-auth');
const Defaults = require('../defaultsStore');
const SupportModels = require('../supportModelsStore');
const { permissionDeniedHelp, attachmentForbiddenHelp, attachmentNotForYouHelp } = require('../feedbackError');
const { daFilo, soloFilo } = require('./origine');

// Region e progetto delle callable di filo-security sono quelli del deploy; override per i test via env.
const FUNCTIONS_BASE = process.env.FILO_FUNCTIONS_BASE
  || 'https://europe-west1-filo-8b9cb.cloudfunctions.net';

// Callable gen2 (protocollo onCall) con l'ID token admin. Lancia su errore di auth, rete o HTTP. Speculare a handlers/redteam.js.
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

// La chiave privata dei feedback non deve MAI uscire dal main process né essere passata al renderer. Si legge da env FILO_FEEDBACK_PRIVKEY, dal file gitignorato tests/agent/.env o dal campo `feedbackPrivateKey` di storage.json, in quest'ordine.
// Nelle routine arriva come secret del runner, mai in chiaro nel prompt.
// Si rilegge a ogni chiamata, senza cache, così cambiarla a runtime ha effetto subito.
async function getPrivateKey() {
  if (process.env.FILO_FEEDBACK_PRIVKEY) return process.env.FILO_FEEDBACK_PRIVKEY.trim();

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

  try {
    if (globalThis.SN_STORAGE) {
      const v = await globalThis.SN_STORAGE.getRaw('feedbackPrivateKey', null);
      if (v && typeof v === 'string') return v.trim();
    }
  } catch (_) {}

  return null;
}

// «Questo indirizzo è un allegato di Filo?» si chiede a UNA funzione sola, SN_FEEDBACK.isAttachmentUrl, la stessa che usano le pagine: qui c'era una seconda copia a colpi di `startsWith`, e due strade per la stessa domanda sono la forma di difetto che questo confine ha già pagato più volte.

// Campi FENC1: decifrati con la chiave privata del main; i valori non cifrati passano invariati, e senza chiave diventano il placeholder leggibile.
// `statusPublic` resta sempre in chiaro, a differenza di `status`; `reviewDecision` e `reviewedAt` viaggiano cifrati come `reviewComment` (#476), perché la revisione dell'owner non dev'essere leggibile da chi ha mandato il feedback.
const TEXT_FIELDS_TO_DECRYPT = ['text', 'url', 'name', 'title', 'notes', 'reviewComment', 'reviewDecision', 'reviewedAt', 'status', 'clientId'];
const PLACEHOLDER_NO_KEY = '[cifrato — chiave privata non configurata]';
// Il pool di thread di Node ha 4 posti di default: oltre non si guadagna.
const DECRYPT_CONCURRENCY = 4;

// Il campo `pipeline` è cifrato come un'unica stringa che racchiude l'INTERO oggetto in JSON: va decifrato PRIMA del render, così i lettori trovano l'oggetto come sempre. Assente o già oggetto (vecchi feedback in chiaro): invariato; cifrato senza chiave: resta la stringa, niente crash.
async function decryptPipelineField(out, C, priv) {
  const p = out.pipeline;
  if (!C.isEncrypted(p)) return; // assente, già oggetto, o null: invariato
  if (!priv) return; // senza chiave: lascia la stringa cifrata (no crash)
  try {
    out.pipeline = JSON.parse(await C.decrypt(p, priv));
  } catch (e) {
    console.warn('[auth] decifratura/parse del pipeline fallita:', e?.message || e);
    // I lettori gestiscono un `pipeline` non-oggetto come "nessun blocco", senza crashare.
  }
}

// I testi dei livelli 3 e 4 viaggiano nella stessa busta delle note e con la stessa chiave dell'owner, quindi stesso helper. La mappa si copia prima di scriverci dentro, per non mutare il documento che il chiamante ha passato.
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

// `privKey` opzionale: il batch della dashboard la legge una volta per tutti i documenti — rileggerla dal disco a ogni feedback (500 volte per una lista) era solo tempo perso.
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
      // Lo `status` è cifrato a lunghezza fissa perché il ciphertext non riveli lo stato con la sola lunghezza (#476): qui si toglie l'imbottitura, o la dashboard non riconoscerebbe più nessuno stato.
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

// La collezione `admins` è leggibile SOLO da un admin: 200 = admin, 403 = non admin. null se la risposta non è concludente (rete giù, token assente), così il chiamante mostra entrambe le ipotesi invece di affermare il falso.
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
  // L'avviso «l'accesso è cambiato» porta con sé il profilo, cioè l'email di chi sta usando Filo: va SOLO alle superfici di Filo. Mandarlo a tutte le schede vorrebbe dire consegnarlo anche ai content script dei siti visitati — se un sito non lo può chiedere, non glielo si manda da soli.
  const avvisaLeSuperficiDiFilo = (m) => {
    if (typeof ctx.broadcastToFiloPages === 'function') ctx.broadcastToFiloPages(m);
    else ctx.broadcastToTabs(m);
  };

  // I token restano nel main: qui torna solo il profilo pubblico e se l'utente è admin. `uid` è il claim Firebase REALE (request.auth.uid nelle regole), diverso dall'email, e la bacheca lo usa per riconoscere i propri voti.
  // Da un sito visitato questa porta risponde ma senza IDENTITÀ: un content script deve sapere di sé solo se c'è una sessione e se questa è l'installazione di chi gestisce i feedback (#583). Chi è, e con che indirizzo, lo chiede una superficie di Filo.
  on(MSG.AUTH_STATUS, async (msg, sender, origin) => {
    const signedIn = auth.isSignedIn();
    const isAdmin = auth.isAdmin();
    if (!daFilo(origin, sender)) return { ok: true, signedIn, isAdmin };
    const uid = signedIn ? await auth.getUid() : null;
    return { ok: true, signedIn, isAdmin, profile: auth.getProfile(), uid };
  });

  on(MSG.AUTH_SIGNIN, async () => {
    try {
      const profile = await auth.signIn();
      avvisaLeSuperficiDiFilo({ type: MSG.AUTH_CHANGED, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin(), profile });
      // Le chiavi ruotate dall'admin NON si leggono più qui (#581: config/secrets è admin-only e le chiavi arrivano col build); il rinfresco resta utile per config/models.
      Defaults.refresh().catch(() => {});
      // Appena l'owner è dentro, la vista pubblica dei feedback si rimette in pari da sola (#583): è il momento in cui il main ha di nuovo il token.
      if (auth.isAdmin()) scheduleViewSync({ delayMs: 4000, force: true });
      return { ok: true, profile, isAdmin: auth.isAdmin() };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Uscire dall'account lo chiede solo la finestra di Filo: da un sito visitato era un modo per buttare fuori chi sta usando Filo, e da lì in poi la posta delle segnalazioni non si apre e la bacheca smette di aggiornarsi.
  on(MSG.AUTH_SIGNOUT, soloFilo(async () => {
    try {
      auth.signOut();
      avvisaLeSuperficiDiFilo({ type: MSG.AUTH_CHANGED, signedIn: false, isAdmin: false, profile: null });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Triage admin di un feedback: gate applicativo qui, garanzia forte nelle Firestore rules, e il token non lascia mai il main.
  // `ownerOnly`: prima di chiedersi CHI è, si chiede DA DOVE arriva. Il triage scrive sul feedback e sulla frase che finisce in bacheca sotto gli occhi di tutti: è un gesto che si fa sulle superfici di Filo. Sul computer di chi i feedback li gestisce «sei l'amministratore?» è sempre sì.
  on(MSG.FEEDBACK_UPDATE, ownerOnly(async (msg) => {
    try {
      if (!globalThis.SN_FEEDBACK?.updateStatus) {
        throw new Error('SN_FEEDBACK non caricato nel main process');
      }
      const idToken = await auth.getIdToken();
      if (!idToken) return { ok: false, error: 'Sessione scaduta: rifai l\'accesso.' };
      // `userNote` è la frase in chiaro per chi ha mandato il feedback, l'altra metà dei due testi (il report cifrato è `notes`): va inoltrata, o la dashboard resta l'unica strada da cui quella metà si perde.
      const { id, status, notes, userNote, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride } = msg;
      // «Fondi senza chiedermelo» su questa pratica: la pagina manda solo sì/no, il CHI lo mette il main dalla sessione (l'email del token, la stessa che le regole vedono) — non è un dato che la pagina possa raccontare.
      let mergePreapproved;
      if (typeof msg.mergePreapproved === 'boolean') {
        if (msg.mergePreapproved) {
          let email = '';
          try { email = String(auth.getTokenClaims()?.email || ''); } catch (_) {}
          mergePreapproved = { by: email || 'owner', at: new Date().toISOString() };
        } else {
          mergePreapproved = null;
        }
      }
      await globalThis.SN_FEEDBACK.updateStatus(
        id,
        { status, notes, userNote, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride, mergePreapproved },
        { idToken },
      );
      // Il triage cambia quello che la bacheca deve mostrare: la vista pubblica si rifà subito, non al prossimo caricamento.
      // Prima la scheda di QUESTO feedback, poi il giro generale: quello guarda solo i 500 più recenti per data d'invio, quindi chiudere oggi una segnalazione vecchia non le scriveva nessuna scheda (niente bacheca, niente annuncio, niente crediti) e riaprirne una vecchia non le toglieva la sua. Qui l'id ce l'abbiamo e l'età non conta più.
      await syncOneCard(id, idToken);
      scheduleViewSync({ delayMs: 1500, force: true });
      // Chi ha messo il segno «fondi senza chiedermelo» lo sa solo il main: glielo diciamo, così la pagina lo mostra subito.
      return mergePreapproved ? { ok: true, by: mergePreapproved.by } : { ok: true };
    } catch (e) {
      const raw = e?.message || String(e);
      let claims = null;
      try { claims = auth.getTokenClaims(); } catch (_) {}
      // Un 403 può voler dire "non sei admin" oppure "sei admin ma il contenuto sfora i limiti": si chiede al server invece di indovinare, perché leggere `admins/<email>` è consentito SOLO agli admin e il suo esito distingue i due casi.
      const serverAdmin = await probeServerAdmin(claims);
      return { ok: false, error: permissionDeniedHelp(raw, claims, { serverAdmin }) };
    }
  }));

  // Decifratura dei campi feedback nel main (la privkey non esce mai da qui), owner-only.
  // Il path singolo esiste per retrocompat; il batch serve alle dashboard che caricano centinaia di feedback: una sola IPC invece di N.
  on(MSG.FEEDBACK_DECRYPT_FIELDS, ownerOnly(async (msg) => {
    try {
      // Nel batch la chiave si legge UNA volta e i documenti si decifrano a gruppi in parallelo: la crittografia gira nel pool di thread di Node, quindi in sequenza si usava un solo core e 500 feedback costavano secondi di attesa.
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

  // Decifratura di UN allegato. Le immagini dei feedback sono cifrate come byte opachi, quindi un <img src=URL> diretto mostra un allegato rotto: qui il main le scarica, le decifra con la chiave privata (che non esce mai dal main) e torna un data URL. Le immagini non cifrate storiche passano invariate; ogni errore → { ok:false }.
  // PROVENIENZA sì, `ownerOnly` no, e la differenza è voluta: questo canale lo chiamano DUE pagine di Filo, la dashboard di chi riceve le segnalazioni e il riquadro dove un tester qualunque riapre le proprie. Con `ownerOnly` un tester si sentiva rispondere «operazione riservata agli amministratori» davanti al proprio screenshot, mandato a cercare un permesso che non avrà mai (#582).
  on(MSG.FEEDBACK_DECRYPT_IMAGE, soloFilo(async (msg) => {
    try {
      const url = String((msg && msg.url) || '');
      const FB = globalThis.SN_FEEDBACK;
      if (!FB?.isAttachmentUrl) throw new Error('SN_FEEDBACK non caricato nel main process');
      // DOVE PUNTA, PRIMA DI CHI GUARDA (#582): solo URL https del deposito feedback, o questo canale diventa un fetch arbitrario pilotato dal renderer (SSRF).
      // L'ordine è il punto: l'indirizzo di un allegato non lo sceglie Filo, sta dentro la segnalazione, e una segnalazione la manda chiunque, anche senza account. Con l'identità davanti, a chi non riceve le segnalazioni si rispondeva «consegnato» senza aver mai guardato l'indirizzo — Filo dichiarava partito, e cifrato con la chiave di chi le riceve, un allegato mai entrato nel suo deposito.
      // Fuori dal deposito la risposta è UNA SOLA, uguale per tutti: quello non è un allegato di Filo. Niente `soloDestinatario`, così il segnaposto dice che non è disponibile invece di prometterlo consegnato.
      if (!FB.isAttachmentUrl(url)) {
        return { ok: false, error: 'url allegato non valido' };
      }
      // Chi non è amministratore l'immagine non la vedrà (è cifrata con la chiave di chi riceve le segnalazioni), ma `soloDestinatario` dice alla pagina che non è un guasto: l'allegato è partito, e il segnaposto lo scrive così invece di dire "non disponibile".
      if (!auth.isAdmin()) {
        return { ok: false, soloDestinatario: true, error: attachmentNotForYouHelp() };
      }
      // Ad aprire l'allegato è il download token dentro l'URL: dal #583 le regole del deposito non concedono la lettura a nessuno, owner compreso. L'identità si manda lo stesso, e solo verso il deposito di Filo: oggi non apre niente da sola, ma se le regole tornassero a riconoscerla la richiesta è già firmata nel modo giusto.
      let idToken = '';
      try { idToken = (await auth.getIdToken()) || ''; } catch (_) { idToken = ''; }
      const res = await fetch(url, { headers: FB.attachmentFetchHeaders(url, idToken) });
      if (!res.ok) {
        // Un 403 su un allegato ha una causa sola e una cura sola: dirla qui è la differenza fra un segnaposto muto e un problema che si risolve.
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
          // Byte che iniziano come un ciphertext valido ma non si decifrano (chiave sbagliata, dato corrotto): non si ripiega sui byte cifrati, sarebbero comunque illeggibili — si dichiara l'errore.
          return { ok: false, error: 'decifratura immagine fallita' };
        }
      }
      // Un DOCUMENTO (non immagine) torna col tipo dichiarato dal chiamante, così il link della dashboard lo scarica già decifrato e col nome originale: prima puntava ai byte cifrati e l'owner apriva un file rotto.
      const mime = String((msg && msg.mime) || '').trim();
      if (mime && !/^image\//i.test(mime) && /^[\w.+-]+\/[\w.+-]+$/.test(mime)) {
        return { ok: true, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` };
      }
      return { ok: true, dataUrl: IMG.bytesToDataUrl(bytes) };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // La lettura per l'editor admin NON espone le chiavi vere, solo se sono configurate. La scrittura è riservata agli admin e si propaga a tutte le installazioni.
  on(MSG.DEFAULTS_GET, ownerOnly(async () => {
    try {
      await Defaults.refresh().catch(() => {});
      return { ok: true, config: Defaults.getPublicForAdmin() };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Versione leggibile da TUTTI: solo i nomi, mai una chiave. La pagina Opzioni elenca così i modelli predefiniti VERI — prima elencava quelli scritti nel codice, che possono essere stati sostituiti o eliminati dalla configurazione condivisa.
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

  // Interruttore master dell'auto-miglioramento (config/automation), owner-only. Default OFF: finché è spento anche i feedback "sicuri" richiedono verifica umana.
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

  // Accetta `enabled` e/o `autoApprove` e tocca SOLO ciò che riceve: la vecchia pagina feedback manda ancora il solo `enabled` e non deve azzerare la mappa.
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
      // L'interruttore delle routine ferma il lavoro autonomo, mentre `enabled` qui sopra riguarda solo chi entra in coda da solo: due decisioni diverse, due interruttori.
      const routinesEnabled = (typeof msg.routinesEnabled === 'boolean')
        ? await Defaults.setRoutinesEnabled(msg.routinesEnabled, idToken)
        : await Defaults.getRoutinesEnabled(idToken);
      return { ok: true, enabled, autoApprove, proberWhenIdle, routinesEnabled };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // È la fonte di verità che il server applica quando registra la critica (#561): cambiare questi bilanci qui ha effetto sul prossimo giro.
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

  // Tocca SOLO i campi che riceve: salvare un bilancio non deve riscrivere gli altri.
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

  // SOLA LETTURA dal client: il log lo scrive chi spawna i worker (scripts/dispatch.mjs) con le proprie credenziali.
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

  // Le due collezioni le scrive il backend di sicurezza con l'Admin SDK e nessun client le può leggere: un registro dei rifiuti leggibile da chiunque direbbe a chi sta provando ad abusare del canale quanto è stato notato. Perciò si passa dalla callable, che chiede le credenziali dell'owner.
  on(MSG.ROUTINE_LOG_GET, ownerOnly(async (msg) => {
    try {
      const limit = Number(msg && msg.limit);
      const r = await callSecurityFunction('routineLog', Number.isFinite(limit) ? { limit } : {});
      return { ok: true, rejections: (r && r.rejections) || [], comparisons: (r && r.comparisons) || [] };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Fusioni bloccate in attesa dell'owner (SPEC-RIDISEGNO-MAX.md §10): i controlli del server fermano le fusioni che toccano le aree protette, e il lavoro locale ci cade dentro quasi sempre. Il blocco apre una richiesta, che l'owner decide da queste chiamate.
  // DUE CANCELLI, non uno: `isAdmin()` (che il server ricontrolla) e l'ORIGINE, solo pagine filo://. Senza il secondo un sito qualunque potrebbe chiedere se c'è una fusione in attesa — scoprendo su cosa sta lavorando l'owner — o provare a farla approvare mentre lui guarda altrove.
  // `ownerOnly` è la porta unica di OGNI canale con potere di proprietario di questo file: feedback, modelli predefiniti, automazione, bilanci dei giri, modelli dei giudici, registri, fusioni. tests/feedback-canali-origine.spec.mjs bussa a tutte da un sito visitato ed è lì che si aggiunge una porta nuova.
  function ownerOnly(handler) {
    return async (msg, sender, origin) => {
      // La provenienza la decide la porta unica del confine (handlers/origine.js) e porta con sé il motivo in una parola: senza, il rifiuto arriva alla pagina come un errore qualunque e finisce tradotto in "controlla la connessione".
      if (!daFilo(origin, sender)) return { ok: false, code: 'forbidden', error: 'forbidden' };
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
      // Le fusioni approvate e mai avvenute (conflitto) restano in vista finché non vengono sistemate: non sono decisioni passate.
      failed: (r && r.failed) || [],
      recent: (r && r.recent) || [],
      // Le fusioni avvenute SENZA chiedere, perché l'owner aveva pre-approvato la pratica: la traccia con cui controlla a posteriori.
      preapproved: (r && r.preapproved) || [],
      // Se il server ne ha lasciate fuori, la pagina lo dice invece di tacere. Un server vecchio non manda il totale: vale l'elenco.
      preapprovedTotal: Number(r && r.preapprovedTotal) || ((r && r.preapproved) || []).length,
      ttlMs: Number(r && r.ttlMs) || 0,
    };
  }

  on(MSG.MERGE_APPROVALS_GET, ownerOnly(listMergeApprovals));

  // #583 — la collezione `feedback` non si legge più senza credenziali, e in una pagina filo:// l'ID token non deve arrivare: la lettura si chiede qui e qui si fa col token. Stessi due cancelli delle approvazioni di fusione: sei l'admin, e lo stai chiedendo da una superficie di Filo.
  const PUBLIC_VIEW = () => globalThis.SN_FEEDBACK_PUBLIC_VIEW;
  const FEEDBACK = () => globalThis.SN_FEEDBACK;

  // Voti e riaperture si scrivono sulla SCHEDA pubblica (l'unico documento che chi vota può aprire), quindi chi legge il feedback dal main se li ritrova riuniti e continua a leggere `fb.votes` come sempre. I voti storici rimasti sul documento non si perdono: la scheda vince solo dove ha qualcosa da dire.
  let cardsCache = { at: 0, rows: [] };
  const CARDS_TTL_MS = 30_000;

  async function publicCards({ fresh = false } = {}) {
    const FB = FEEDBACK();
    if (!FB) return [];
    if (!fresh && Date.now() - cardsCache.at < CARDS_TTL_MS) return cardsCache.rows;
    // TUTTE le schede, paginate: una finestra sui più recenti per data d'invio vorrebbe dire che le schede più vecchie non le toglie più nessuno, e un fix vecchio tornato in lavorazione resterebbe in bacheca come risolto, votabile e riapribile a pagamento.
    const rows = FB.listAllPublic
      ? await FB.listAllPublic({ timeoutMs: 20000, fresh })
      : await FB.listPublic({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 20000 });
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
    // Una PROIEZIONE (il giro leggero che chiede solo cosa è cambiato) non porta campi da riunire e non deve pagare la lettura delle schede a ogni battito.
    if (fields) return { ok: true, rows };
    // Le righe appena lette sono le stesse che servirebbero alla sincronizzazione: gliele passiamo invece di far rileggere mezzo database un attimo dopo.
    scheduleViewSync({ rows });
    return { ok: true, rows: await mergeCardFields(rows) };
  }));

  // La scheda pubblica la può scrivere solo chi ha l'autorità (le regole ammettono owner e server) e la CHIAVE per leggere lo status vero, che viaggia cifrato: senza, "questo fix è chiuso e pulito" non è una frase che si possa dire. Le ha il main dell'owner, ed è per questo che il lavoro sta qui.
  // Gira dopo un caricamento della dashboard e dopo ogni triage, mai più di una volta al minuto, e non fa niente se la chiave privata non è configurata: ogni status sarebbe illeggibile e la sincronizzazione svuoterebbe la bacheca.
  let syncTimer = null;
  let syncing = false;
  let lastSyncAt = 0;
  const SYNC_MIN_GAP_MS = 60_000;

  /** La scheda pubblica di UN feedback, per id: la scrive, l'aggiorna o la toglie secondo quello che il feedback dice adesso. Esiste perché il giro generale lavora su una pagina dei più recenti per data d'invio, e per i feedback più vecchi la bacheca si congelava all'ultimo giro in cui erano dentro.
  * Best-effort: se fallisce non fa fallire il triage (la segnalazione è già cambiata sul server), ma lo scrive nei log. */
  async function syncOneCard(id, idToken) {
    const FB = FEEDBACK();
    const V = PUBLIC_VIEW();
    const key = String(id || '');
    if (!FB || !V || !key || !idToken) return;
    try {
      const priv = await getPrivateKey();
      // Senza chiave lo status è un blob: pubblicare sarebbe alla cieca e togliere cancellerebbe una scheda buona. Ci si ferma e lo si dice.
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
        // I voti e le riaperture stanno sulla scheda: la maschera di publishPublicCard non li tocca, ma quelli rimasti sul documento vanno portati dentro come fa il giro generale.
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

  /** Il caricamento generale guarda i feedback più recenti PER DATA D'INVIO e Filo quel tetto l'ha passato: quello che succede alle segnalazioni più vecchie non arriva in bacheca. Il triage fatto dentro l'app ha l'id e scrive la scheda da sé, ma una segnalazione la chiude anche il server quando fonde il lavoro, o un comando dal terminale.
  * Due aggiunte, limitate e a costo fisso: le segnalazioni CHIUSE più di recente (query per data di chiusura), e i feedback delle schede già in bacheca che non sono nella pagina — così un fix tornato in lavorazione perde la scheda invece di restare «risolto», votabile e riapribile a pagamento.
  * Best-effort: se una delle due domande non riesce il giro prosegue con quello che ha. Torna anche gli id aggiunti, perché su quelli chi pubblica è più prudente (vedi `statusLeggibile`). */
  async function conLeSegnalazioniFuoriPagina(base, idToken, schede) {
    const FB = FEEDBACK();
    const rows = Array.isArray(base) ? base.slice() : [];
    const aggiunti = new Set();
    if (!FB || !idToken) return { rows, aggiunti };
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
      try { aggiungi(await FB.listResolved({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 30000, idToken })); }
      catch (e) { console.warn('[feedback] chiusi di recente non letti:', e?.message || e); }
    }

    const mancanti = (Array.isArray(schede) ? schede : [])
      .map((c) => String((c && c._id) || ''))
      .filter((id) => id && !visti.has(id))
      .slice(0, FB.LIST_PAGE_SIZE);
    if (mancanti.length) {
      try { aggiungi(await FB.getMany(mancanti, { idToken, timeoutMs: 30000 })); }
      catch (e) { console.warn('[feedback] feedback delle schede fuori pagina non letti:', e?.message || e); }
    }
    return { rows, aggiunti };
  }

  /** Lo stato di questo feedback si è potuto leggere davvero? Un campo cifrato che non si apre torna come segnaposto, e uno stato illeggibile non è «questo feedback non merita una scheda»: pubblicare o togliere basandosi su quello farebbe sparire dalla bacheca un fix buono. Sulle segnalazioni pescate fuori pagina, in quel caso, si sta fermi. */
  function statusLeggibile(fb) {
    const MR = globalThis.SN_MANAGE_REVIEW;
    const v = fb && fb.status;
    if (!v) return true; // uno stato assente è il vecchio «da lavorare»: non è illeggibile
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
        // Senza chiave ogni status è un blob: pubblicare sarebbe alla cieca e TOGLIERE cancellerebbe la bacheca. Si sta fermi e lo si dice.
        console.warn('[feedback] vista pubblica: chiave privata non configurata, sincronizzazione saltata');
        return { ok: false, skipped: true };
      }
      const base = (Array.isArray(rows) && rows.length)
        ? rows
        : await FB.list({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 30000, idToken });
      // Le schede già in bacheca si leggono una volta sola e servono due volte: per pescare i feedback fuori pagina che ne hanno una, e per il piano.
      const published = await publicCards({ fresh: true });
      const { rows: raw, aggiunti } = await conLeSegnalazioniFuoriPagina(base, idToken, published);
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

      // `complete`: il caricamento per data d'invio non ha toccato il tetto, quindi questi sono TUTTI i feedback che esistono e solo allora una scheda senza feedback è un orfano da togliere. Si guarda la pagina di partenza, non il totale: le segnalazioni pescate per data di chiusura sono un'aggiunta, e contarle direbbe «pagina piena» anche quando non lo era.
      const complete = base.length < FB.LIST_PAGE_SIZE;
      const plan = V.planSync(published, feedbacks, { complete });
      for (const { id, card } of plan.upsert) await FB.publishPublicCard(id, card, { idToken });
      for (const id of plan.remove) await FB.unpublishPublicCard(id, { idToken });

      // Il contatore dei numeri lo crea e lo rimette in pari l'app dell'owner, l'unica che può scriverlo a piacere: senza, un feedback nuovo arriverebbe senza numero.
      // Il massimo si CHIEDE al server con una query sua, non si ricava dai feedback caricati: quelli sono i più recenti per data, e il numero più alto potrebbe stare fuori. Col massimo vero `allowLower` è sempre lecito, ed è l'unico modo perché la cura funzioni.
      let piuAlto = null;
      try { piuAlto = await FB.maxSeq({ idToken, timeoutMs: 15000 }); }
      catch (e) { console.warn('[feedback] numero più alto non letto:', e?.message || e); }
      if (piuAlto === null) {
        // Non lo sappiamo: al massimo si alza il contatore fino a quello che si è visto, mai abbassarlo alla cieca.
        const visto = feedbacks.reduce((m, f) => Math.max(m, Number(f && f.seq) || 0), 0);
        if (visto > 0) {
          try { await FB.ensureSeqCounter(visto, { idToken }); }
          catch (e) { console.warn('[feedback] contatore dei numeri non aggiornato:', e?.message || e); }
        }
      } else if (piuAlto > 0) {
        try { await FB.ensureSeqCounter(piuAlto, { idToken, allowLower: true }); }
        catch (e) { console.warn('[feedback] contatore dei numeri non aggiornato:', e?.message || e); }
      }

      lastSyncAt = Date.now();
      if (plan.upsert.length || plan.remove.length) {
        cardsCache = { at: 0, rows: [] }; // la prossima lettura rilegge davvero
        // E anche la memoria breve della lettura completa: le schede sono appena cambiate, quella di mezzo minuto fa non vale più.
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

  // Una pagina di gestione GIÀ APERTA deve accorgersi di una richiesta nuova: prima l'elenco si leggeva solo all'apertura, il terminale diceva "approvala da Filo" e sulla pagina aperta non compariva niente.
  // Ad avvisare è il main, non la pagina: la lettura è UNA sola anche con dieci schede aperte e il cancello del proprietario resta in un posto solo. Il campanello sta in services/mergeApprovalSignal.js.
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
    // Alla pagina arriva TUTTO quello che il server dice dell'esito, non solo esito e sha: senza il riallineamento e il motivo di un tentativo fallito, la pagina diceva «la richiesta decade, rilancia» a un riallineamento riuscito.
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

  // «Salta il controllo»: l'owner ha letto la bocciatura dell'audit di sicurezza e decide di andare avanti. Stesso cancello delle approvazioni di fusione, perché è lo stesso tipo di gesto: un'eccezione a un controllo automatico, fatta davanti allo schermo e non da un terminale che potrebbe non essere nelle sue mani.
  // Non è un via libera cieco: il server segna l'audit come saltato e fa partire il cancello di fusione, che può fermare tutto lo stesso. Quello che torna è l'esito VERO di quel cancello.
  const ESITI_SALTA = ['fuso', 'bloccato', 'conflitto', 'ramo_assente'];
  on(MSG.LIVELLO4_SALTA, ownerOnly(async (msg) => {
    const feedbackId = String(msg?.feedbackId || '').trim();
    if (!feedbackId) return { ok: false, error: 'Manca la segnalazione su cui saltare il controllo.' };
    const r = await callSecurityFunction('ownerSkipSecaudit', { feedbackId });
    if (!r || r.ok === false) {
      return { ok: false, error: (r && (r.detail || r.reason || r.error)) || 'Il server non ha saltato il controllo.' };
    }
    // Un esito che questo client non conosce non si traduce in «fatto»: passa com'è, e la pagina lo scrive invece di inventarsi un successo.
    const esito = String(r.esito || r.result || '').trim();
    const out = { ok: true, esito: ESITI_SALTA.includes(esito) ? esito : esito };
    if (r.requestId) out.requestId = String(r.requestId);
    if (r.sha) out.sha = String(r.sha);
    if (r.error) out.error = String(r.error);
    return out;
  }));

  on(MSG.MERGE_APPROVAL_DISCARD, ownerOnly(async (msg) => {
    const r = await callSecurityFunction('ownerMergeApprovals', { op: 'discard', id: String(msg?.id || '') });
    if (r && r.ok === false) return { ok: false, error: r.detail || r.reason || 'Non riuscita.' };
    return { ok: true, result: 'discarded' };
  }));

  // Config "modelli di supporto" (config/supportModels), owner-only: UPDATE scrive solo i campi passati (PATCH per-campo).
  on(MSG.SUPPORT_MODELS_GET, ownerOnly(async () => {
    try {
      const models = await SupportModels.get();
      return { ok: true, models };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // La dashboard decifra i pipeline, quindi sa quali feedback sono "non filtrati": passa la lista degli id e il backend ri-esegue SOLO i giudici mancanti di ciascuno.
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
      const models = await SupportModels.update(partial, idToken);
      return { ok: true, models };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));
};
