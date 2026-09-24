// Handler di dominio: account "Accedi con Google", triage admin dei feedback
// e config condivisa "modelli predefiniti".

const path = require('node:path');
const auth = require('../../auth/google-auth');
const Defaults = require('../defaultsStore');
const SupportModels = require('../supportModelsStore');
const { permissionDeniedHelp, attachmentForbiddenHelp, attachmentNotForYouHelp } = require('../feedbackError');
const { daFilo, soloFilo } = require('./origine');

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

// «Questo indirizzo è un allegato di Filo?» si chiede a UNA funzione sola,
// `SN_FEEDBACK.isAttachmentUrl`, che è anche quella usata dalle pagine. Qui
// c'era una seconda copia, scritta a colpi di `startsWith`: due strade per la
// stessa domanda sono esattamente la forma di difetto che questo confine ha
// già pagato più volte (una delle due prima o poi non guarda quello che guarda
// l'altra). I nomi storici del deposito che quella copia conosceva sono
// passati nel modulo condiviso, insieme al resto.

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

// I testi dei livelli 3 e 4 (`livelli.l3.testo`, `livelli.l4.testo`): quello
// che Claude ha segnalato lavorando e il resoconto dell'audit di sicurezza.
// Viaggiano nella stessa busta delle note, con la stessa chiave dell'owner,
// quindi si decifrano con lo stesso helper — e la mappa si copia prima di
// scriverci dentro, per non mutare il documento che il chiamante ha passato.
// Senza chiave: il placeholder, come per gli altri testi (la dashboard lo
// riconosce e lo dichiara invece di mostrare un blob).
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
  await decryptLivelliFields(out, C, priv);

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
  const { MSG } = ctx;
  // L'avviso «l'accesso è cambiato» porta con sé il profilo, cioè l'indirizzo
  // email di chi sta usando Filo: va SOLO alle superfici di Filo. Mandarlo a
  // tutte le schede vorrebbe dire consegnarlo anche ai content script dei siti
  // visitati, ed è la stessa porta chiusa un attimo fa vista dal verso opposto:
  // se un sito non lo può chiedere, non glielo si manda da soli.
  const avvisaLeSuperficiDiFilo = (m) => {
    if (typeof ctx.broadcastToFiloPages === 'function') ctx.broadcastToFiloPages(m);
    else ctx.broadcastToTabs(m);
  };

  // I token restano nel main process: qui torniamo solo il profilo pubblico
  // + se l'utente è admin (può triagiare i feedback). `uid` è il claim
  // Firebase REALE (request.auth.uid nelle Firestore rules) — diverso
  // dall'email del profilo — usato dalla bacheca (DC2) per riconoscere i
  // propri voti nella mappa `votes` autorevole letta da Firestore.
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
    const uid = signedIn ? await auth.getUid() : null;
    return { ok: true, signedIn, isAdmin, profile: auth.getProfile(), uid };
  });

  on(MSG.AUTH_SIGNIN, async () => {
    try {
      const profile = await auth.signIn();
      avvisaLeSuperficiDiFilo({ type: MSG.AUTH_CHANGED, signedIn: auth.isSignedIn(), isAdmin: auth.isAdmin(), profile });
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

  // Uscire dall'account lo chiede solo la finestra di Filo. Da un sito
  // visitato era un modo per buttare fuori chi sta usando Filo: da lì in poi
  // la posta delle segnalazioni non si apre e la bacheca di tutti smette di
  // aggiornarsi, finché non rientra.
  on(MSG.AUTH_SIGNOUT, soloFilo(async () => {
    try {
      auth.signOut();
      avvisaLeSuperficiDiFilo({ type: MSG.AUTH_CHANGED, signedIn: false, isAdmin: false, profile: null });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }));

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
      // «Fondi senza chiedermelo» su questa pratica: la pagina manda solo
      // sì/no, il CHI lo mette il main dalla sessione (l'email del token, la
      // stessa che le regole vedono) — non è un dato che la pagina possa
      // raccontare. `true` → { by, at }; `false` → il campo si toglie.
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
      // Il triage cambia quello che la bacheca deve mostrare (un fix chiuso
      // entra, uno riaperto esce, la frase per chi ha segnalato cambia): la
      // vista pubblica si rifà subito, non al prossimo caricamento.
      //
      // Prima la scheda di QUESTO feedback, poi il giro generale. Non è un
      // doppione: il giro generale guarda solo i 500 feedback più recenti per
      // data d'invio, e Filo quel numero l'ha passato. Chiudere oggi una
      // segnalazione vecchia non le scriveva nessuna scheda (niente bacheca,
      // niente annuncio e niente crediti per chi l'aveva mandata) e riaprirne
      // una vecchia non le toglieva la sua (restava in bacheca come risolta,
      // votabile e riapribile a pagamento). Qui l'id ce l'abbiamo: si va
      // dritti su quello, e l'età non conta più.
      await syncOneCard(id, idToken);
      scheduleViewSync({ delayMs: 1500, force: true });
      // La pagina mostra subito chi ha messo il segno «fondi senza chiedermelo»:
      // glielo dice il main, che è l'unico a saperlo.
      return mergePreapproved ? { ok: true, by: mergePreapproved.by } : { ok: true };
    } catch (e) {
      const raw = e?.message || String(e);
      // Nel registro, non solo nella risposta: la pagina può aver cambiato
      // pratica nel frattempo, e un 403 muto è un segno che non c'è e nessuno sa perché.
      const campi = Object.keys(msg || {}).filter((k) => k !== 'type' && k !== 'id').join(',');
      console.warn('[Filo] feedback_update respinto', id, campi, raw.slice(0, 300));
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
  // mostrabile. Retrocompat: immagini NON cifrate (storiche) passano invariate
  // (data URL dei byte grezzi). Fail-safe: ogni errore → { ok:false }.
  // PROVENIENZA sì, `ownerOnly` no, e la differenza è voluta. Il confine
  // d'origine (#583) vale anche qui: da un sito visitato questa porta risponde
  // «rifiutato per provenienza», come ogni altra del corridoio. Quello che NON
  // può fare è fermarsi a «sei l'amministratore?», perché questo canale lo
  // chiamano DUE pagine di Filo: la dashboard di chi riceve le segnalazioni e
  // il riquadro dei feedback, dove un tester qualunque riapre le proprie. Con
  // `ownerOnly` un tester si sentiva rispondere «operazione riservata agli
  // amministratori» davanti al proprio screenshot — mandato a cercare un
  // permesso che non avrà mai (#582). La risposta giusta gliela dà il corpo,
  // dopo aver guardato PRIMA dove punta l'indirizzo.
  on(MSG.FEEDBACK_DECRYPT_IMAGE, soloFilo(async (msg) => {
    try {
      const url = String((msg && msg.url) || '');
      const FB = globalThis.SN_FEEDBACK;
      if (!FB?.isAttachmentUrl) throw new Error('SN_FEEDBACK non caricato nel main process');
      // DOVE PUNTA, PRIMA DI CHI GUARDA (#582, giro 4). Solo URL https del
      // bucket feedback: evita che questo canale diventi un fetch arbitrario
      // (SSRF) pilotato dal renderer.
      //
      // Questo controllo sta PRIMA di quello sull'identità, e l'ordine è il
      // punto. L'indirizzo di un allegato non lo sceglie Filo: sta scritto
      // dentro la segnalazione, e una segnalazione la manda chiunque, anche
      // senza account e senza avere Filo installato. Con l'identità davanti, a
      // chi non riceve le segnalazioni si rispondeva «consegnato» senza aver
      // mai guardato l'indirizzo: Filo dichiarava partito — e cifrato con la
      // chiave di chi le riceve — un «allegato» che nel suo deposito non era
      // mai entrato, e la pillola finta di chi aveva messo l'esca diventava
      // indistinguibile da una vera, avvalorata da Filo. A chi le riceve
      // l'indirizzo veniva invece controllato: due strade per la stessa cosa e
      // una non guardava niente (la stessa forma del rilievo del giro 2).
      //
      // Fuori dal deposito di Filo la risposta è UNA SOLA, uguale per tutti:
      // quello non è un allegato di Filo. Niente `soloDestinatario`, così il
      // segnaposto torna a dire che non è disponibile invece di prometterlo
      // consegnato.
      if (!FB.isAttachmentUrl(url)) {
        return { ok: false, error: 'url allegato non valido' };
      }
      // Questo canale lo chiamano DUE pagine: la dashboard dell'owner e il
      // riquadro dei feedback, dove un utente qualunque riapre le proprie
      // segnalazioni. Chi non è amministratore l'immagine non la vedrà (è
      // cifrata con la chiave di chi riceve le segnalazioni), ma `soloDestinatario`
      // dice alla pagina che non è un guasto: l'allegato è partito, e il
      // segnaposto lo scrive così invece di dire "non disponibile".
      if (!auth.isAdmin()) {
        return { ok: false, soloDestinatario: true, error: attachmentNotForYouHelp() };
      }
      // Quello che apre l'allegato è il download token dentro l'URL salvato nel
      // feedback: dal #583 le regole del deposito non concedono la lettura a
      // nessuno, owner compreso. L'identità si manda lo stesso, e solo verso il
      // deposito di Filo (`attachmentFetchHeaders` lo confronta per intero):
      // oggi non apre niente da sola, ma se un domani le regole tornassero a
      // riconoscerla la richiesta è già firmata nel modo giusto. Se la sessione
      // è scaduta si prosegue senza: non cambia nulla per l'allegato.
      let idToken = '';
      try { idToken = (await auth.getIdToken()) || ''; } catch (_) { idToken = ''; }
      const res = await fetch(url, { headers: FB.attachmentFetchHeaders(url, idToken) });
      if (!res.ok) {
        // Un 403 su un allegato ora ha una causa sola e una cura sola: dirla
        // qui è la differenza fra un segnaposto muto e un problema che si
        // risolve. (Il motivo finisce nell'hover del segnaposto, in dashboard.)
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

  // Tocca SOLO i campi che riceve (come AUTOMATION_SET): salvare un bilancio
  // non deve riscrivere gli altri.
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
  //
  // `ownerOnly` NON è delle sole fusioni: è la porta unica di OGNI canale con
  // potere di proprietario di questo file. Ogni `on(MSG.…)` qui dentro che
  // richieda l'amministratore ci passa — i feedback, i modelli predefiniti (che
  // valgono per tutte le installazioni di Filo), l'automazione, i bilanci dei
  // giri, i modelli dei giudici, i registri del lavoro e delle routine, le
  // fusioni. Non è una regola di stile: il #583 ha chiuso quattro porte su
  // nove, e le cinque rimaste erano quelle che cambiano la configurazione di
  // tutti. `tests/feedback-canali-origine.spec.mjs` bussa a tutte da un sito
  // visitato e diventa rossa se una risponde qualcosa di diverso da
  // «rifiutato per provenienza»: è il posto dove aggiungere una porta nuova.
  function ownerOnly(handler) {
    return async (msg, sender, origin) => {
      // La provenienza la decide la porta unica del confine (handlers/origine.js),
      // che è la stessa di ogni altra porta con potere e porta con sé il motivo
      // in una parola: senza, il rifiuto arriva a una pagina come un errore
      // qualunque e finisce tradotto in "controlla la connessione", che non è
      // vero e manda a controllare la cosa sbagliata.
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
      // Le fusioni approvate e mai avvenute (conflitto): restano in vista
      // finché non vengono sistemate, non sono decisioni passate.
      failed: (r && r.failed) || [],
      recent: (r && r.recent) || [],
      // Le fusioni avvenute SENZA chiedere, perché l'owner aveva pre-approvato
      // la pratica: la traccia con cui controlla a posteriori.
      preapproved: (r && r.preapproved) || [],
      // Quante sono in tutto: se il server ne ha lasciate fuori, la pagina lo
      // dice invece di tacere. Un server vecchio non lo manda: vale l'elenco.
      preapprovedTotal: Number(r && r.preapprovedTotal) || ((r && r.preapproved) || []).length,
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
    // TUTTE le schede, paginate. Una finestra sui 500 più recenti per data
    // d'invio qui vuol dire che le schede più vecchie non le può togliere più
    // nessuno: un fix vecchio che torna in lavorazione resterebbe in bacheca
    // come risolto, votabile e riapribile a pagamento — cioè il doppione che il
    // blocco delle riaperture doveva impedire.
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
      const { rows, complete } = await FB.listAllPaged({ timeoutMs, idToken });
      return { ok: true, rows, complete };
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
      // Senza chiave lo status è un blob: pubblicare sarebbe alla cieca e
      // togliere cancellerebbe una scheda buona. Stessa scelta del giro
      // generale: fermarsi e dirlo.
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
        // I voti e le riaperture stanno sulla scheda: la maschera di
        // publishPublicCard non li tocca, ma quelli rimasti sul documento vanno
        // portati dentro come fa il giro generale.
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
    if (!FB || !idToken) return { rows, aggiunti, schedeCoperte: false };
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
      try { aggiungi(await FB.listResolved({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 30000, idToken, sinceIso, fields: campi })); }
      catch (e) { console.warn('[feedback] chiusi di recente non letti:', e?.message || e); }
    }

    const tutteLeMancanti = (Array.isArray(schede) ? schede : [])
      .map((c) => String((c && c._id) || ''))
      .filter((id) => id && !visti.has(id));
    const mancanti = tutteLeMancanti.slice(0, FB.LIST_PAGE_SIZE);
    let schedeCoperte = mancanti.length === tutteLeMancanti.length;
    if (mancanti.length) {
      try { aggiungi(await FB.getMany(mancanti, { idToken, timeoutMs: 30000 })); }
      catch (e) {
        schedeCoperte = false;
        console.warn('[feedback] feedback delle schede fuori pagina non letti:', e?.message || e);
      }
    }
    return { rows, aggiunti, schedeCoperte };
  }

  /**
   * Lo stato di questo feedback si è potuto leggere davvero? Un campo cifrato
   * che non si apre torna come segnaposto, e uno stato illeggibile non è
   * «questo feedback non merita una scheda»: pubblicare o togliere basandosi
   * su quello vorrebbe dire far sparire dalla bacheca un fix buono. Sulle
   * segnalazioni pescate fuori pagina, che prima questo giro non guardava
   * nemmeno, in quel caso si sta fermi.
   */
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
        // Senza chiave ogni status è un blob: pubblicare sarebbe alla cieca e
        // TOGLIERE cancellerebbe la bacheca. Si sta fermi e lo si dice.
        console.warn('[feedback] vista pubblica: chiave privata non configurata, sincronizzazione saltata');
        return { ok: false, skipped: true };
      }
      const base = (Array.isArray(rows) && rows.length)
        ? rows
        : await FB.list({ pageSize: FB.LIST_PAGE_SIZE, timeoutMs: 30000, idToken });
      // Le schede già in bacheca si leggono una volta sola e servono due volte:
      // per pescare i feedback fuori pagina che ne hanno una, e per il piano.
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

      // `complete`: il caricamento PER DATA D'INVIO non ha toccato il tetto,
      // quindi questi sono TUTTI i feedback che esistono, e solo allora una
      // scheda senza feedback è un orfano (feedback cancellato) da togliere.
      // Si guarda la pagina di partenza, non il totale: le segnalazioni pescate
      // per data di chiusura sono un'aggiunta, e contarle direbbe «pagina
      // piena» anche quando non lo era.
      const complete = base.length < FB.LIST_PAGE_SIZE;
      const plan = V.planSync(published, feedbacks, { complete });
      for (const { id, card } of plan.upsert) await FB.publishPublicCard(id, card, { idToken });
      for (const id of plan.remove) await FB.unpublishPublicCard(id, { idToken });

      // Il contatore dei numeri: lo crea e lo rimette in pari l'app
      // dell'owner, che è l'unica a poterlo scrivere a piacere. Senza, un
      // feedback nuovo arriverebbe senza numero.
      //
      // Il massimo si CHIEDE al server con una query sua (una lettura), non si
      // ricava dai feedback caricati: quelli sono i 500 più recenti per data, e
      // il numero più alto potrebbe stare fuori. Con il massimo vero,
      // `allowLower` è sempre lecito, ed è l'unico modo perché la cura funzioni:
      // chiunque può far avanzare il contatore di uno, e prima si abbassava solo
      // quando il caricamento non toccava il tetto, cioè mai più.
      let piuAlto = null;
      try { piuAlto = await FB.maxSeq({ idToken, timeoutMs: 15000 }); }
      catch (e) { console.warn('[feedback] numero più alto non letto:', e?.message || e); }
      if (piuAlto === null) {
        // Non lo sappiamo: al massimo alziamo il contatore fino a quello che
        // abbiamo visto, mai abbassarlo alla cieca.
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
        // E anche la memoria breve della lettura completa: le schede sono
        // appena cambiate, quindi quella di mezzo minuto fa non vale più.
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
    // Alla pagina arriva TUTTO quello che il server dice dell'esito, non solo
    // esito e sha: il riallineamento fatto dal server (`realigned`), la
    // richiesta nuova aperta per la sola differenza (`newRequest`, `newBlocks`)
    // e il motivo di un tentativo fallito (`realignReason`). Senza, la pagina
    // diceva «la richiesta decade, rilancia» a un riallineamento riuscito.
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
  const ESITI_SALTA = ['fuso', 'bloccato', 'conflitto', 'ramo_assente'];
  on(MSG.LIVELLO4_SALTA, ownerOnly(async (msg) => {
    const feedbackId = String(msg?.feedbackId || '').trim();
    if (!feedbackId) return { ok: false, error: 'Manca la segnalazione su cui saltare il controllo.' };
    const r = await callSecurityFunction('ownerSkipSecaudit', { feedbackId });
    if (!r || r.ok === false) {
      return { ok: false, error: (r && (r.detail || r.reason || r.error)) || 'Il server non ha saltato il controllo.' };
    }
    // Un esito che questo client non conosce non si traduce in «fatto»: passa
    // com'è, e la pagina lo scrive invece di inventarsi un successo.
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
