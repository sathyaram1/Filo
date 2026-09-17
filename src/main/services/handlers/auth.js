// Handler di dominio: account "Accedi con Google", triage admin dei feedback
// e config condivisa "modelli predefiniti".

const path = require('node:path');
const auth = require('../../auth/google-auth');
const Defaults = require('../defaultsStore');
const SupportModels = require('../supportModelsStore');
const { permissionDeniedHelp, attachmentForbiddenHelp, attachmentNotForYouHelp } = require('../feedbackError');
const { daFilo, soloFilo } = require('./origine');

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
    try { detail = (await res.json())?.error?.message || ''; } catch (_) {}
    throw new Error(`callable ${name} ${res.status}${detail ? ': ' + detail : ''}`);
  }
  const body = await res.json();
  return body && body.result;
}

// La chiave privata dei feedback non esce MAI dal main né va al renderer: env,
// tests/agent/.env o storage.json, in quest'ordine. Riletta a ogni chiamata, senza cache.
async function getPrivateKey() {
  if (process.env.FILO_FEEDBACK_PRIVKEY) return process.env.FILO_FEEDBACK_PRIVKEY.trim();

  try {
    const fs = require('node:fs');
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
  };

  // I token restano nel main: torna solo il profilo pubblico e se l'utente è admin; `uid` è il
  // claim Firebase. Da un sito visitato risponde senza identità (#583).
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
      // Il rinfresco serve a config/models: le chiavi arrivano col build, non da qui (#581).
      Defaults.refresh().catch(() => {});
      // Con l'owner dentro il main ha di nuovo il token: la vista pubblica si rimette in pari.
      if (auth.isAdmin()) scheduleViewSync({ delayMs: 4000, force: true });
      return { ok: true, profile, isAdmin: auth.isAdmin() };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
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

  // Triage admin: gate qui, garanzia forte nelle rules, il token non lascia il main.
  // `ownerOnly`: prima di CHI è conta DA DOVE arriva, è un gesto delle superfici di Filo.
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
      // «Fondi senza chiedermelo»: la pagina manda solo sì/no, il CHI lo mette il main dalla
      // sessione — non è un dato che la pagina possa raccontare.
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
      // Il triage cambia la bacheca: la vista si rifà subito, non al prossimo caricamento.
      // Prima la scheda di QUESTO id: il giro generale guarda solo i più recenti per data d'invio.
      await syncOneCard(id, idToken);
      scheduleViewSync({ delayMs: 1500, force: true });
      // Chi ha pre-approvato lo sa solo il main: glielo diciamo, così la pagina lo mostra.
      return mergePreapproved ? { ok: true, by: mergePreapproved.by } : { ok: true };
    } catch (e) {
      const raw = e?.message || String(e);
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

  // Interruttore master dell'auto-miglioramento (config/automation), owner-only.
  // Default OFF: da spento anche i feedback «sicuri» richiedono verifica umana.
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

  // Tocca SOLO i campi che riceve: chi manda il solo `enabled` non deve azzerare la mappa.
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
      // Le routine e l'ingresso in coda sono due decisioni diverse: due interruttori distinti.
      const routinesEnabled = (typeof msg.routinesEnabled === 'boolean')
        ? await Defaults.setRoutinesEnabled(msg.routinesEnabled, idToken)
        : await Defaults.getRoutinesEnabled(idToken);
      return { ok: true, enabled, autoApprove, proberWhenIdle, routinesEnabled };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

  // Fonte di verità dei bilanci che il server applica alla critica: valgono dal prossimo giro.
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

  // Sola lettura dal client: il log lo scrive chi spawna i worker, con le proprie credenziali.
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
      return { ok: true, rejections: (r && r.rejections) || [], comparisons: (r && r.comparisons) || [] };
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
    // Una proiezione non porta campi da riunire: non paga la lettura delle schede a ogni giro.
    if (fields) return { ok: true, rows };
    // Le righe appena lette servono anche alla sincronizzazione: si passano, non si rileggono.
    scheduleViewSync({ rows });
    return { ok: true, rows: await mergeCardFields(rows) };
  }));

  // La scheda pubblica la scrive chi ha l'autorità e la CHIAVE per leggere lo status cifrato:
  // solo il main dell'owner. Al massimo una volta al minuto, mai senza chiave privata.
  let syncTimer = null;
  let syncing = false;
  let lastSyncAt = 0;
  const SYNC_MIN_GAP_MS = 60_000;

  // La scheda pubblica di UN feedback per id: il giro generale lavora sui più recenti per data
  // d'invio, e i più vecchi restavano congelati. Best-effort: non fa fallire il triage.
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

  // Il giro generale guarda i più recenti PER DATA D'INVIO, e Filo quel tetto l'ha passato: si
  // aggiungono le chiuse di recente e le schede in bacheca fuori pagina. Best-effort.
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
        : await FB.list({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 30000, idToken });
      // Le schede già in bacheca si leggono una volta sola e servono due volte: per pescare i
      // feedback fuori pagina e per il piano.
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

      // `complete`: solo se la pagina per data d'invio non ha toccato il tetto una scheda senza
      // feedback è un orfano. Si guarda la pagina di partenza, non le aggiunte.
      const complete = base.length < FB.LIST_PAGE_SIZE;
      const plan = V.planSync(published, feedbacks, { complete });
      for (const { id, card } of plan.upsert) await FB.publishPublicCard(id, card, { idToken });
      for (const id of plan.remove) await FB.unpublishPublicCard(id, { idToken });

      // Il contatore lo tiene l'app dell'owner: senza, un feedback nuovo nasce senza numero.
      // Il massimo si CHIEDE al server: fra i feedback caricati il più alto può non esserci.
      let piuAlto = null;
      try { piuAlto = await FB.maxSeq({ idToken, timeoutMs: 15000 }); }
      catch (e) { console.warn('[feedback] numero più alto non letto:', e?.message || e); }
      if (piuAlto === null) {
        // Senza il massimo vero si alza fino a quanto si è visto, mai abbassare alla cieca.
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

  // «Salta il controllo» dell'audit: stesso cancello delle approvazioni di fusione, stesso
  // gesto. Non è un via libera cieco: parte il cancello di fusione, che può fermare tutto.
  const ESITI_SALTA = ['fuso', 'bloccato', 'conflitto', 'ramo_assente'];
  on(MSG.LIVELLO4_SALTA, ownerOnly(async (msg) => {
    const feedbackId = String(msg?.feedbackId || '').trim();
    if (!feedbackId) return { ok: false, error: 'Manca la segnalazione su cui saltare il controllo.' };
    const r = await callSecurityFunction('ownerSkipSecaudit', { feedbackId });
    if (!r || r.ok === false) {
      return { ok: false, error: (r && (r.detail || r.reason || r.error)) || 'Il server non ha saltato il controllo.' };
    }
    // Un esito che il client non conosce passa com'è: non si traduce in un successo inventato.
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

  // Config dei modelli di supporto, owner-only: l'update scrive solo i campi passati.
  on(MSG.SUPPORT_MODELS_GET, ownerOnly(async () => {
    try {
      const models = await SupportModels.get();
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
      const models = await SupportModels.update(partial, idToken);
      return { ok: true, models };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));
};
