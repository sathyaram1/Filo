// Client Firebase REST per i feedback alpha.
// Funziona sia nei content script sia nelle pagine dell'estensione: niente SDK,
// solo fetch().
//
// Espone SN_FEEDBACK = { submit, list, configPublic }.

(function (global) {
  'use strict';

  const PROJECT_ID = 'filo-8b9cb';
  const BUCKET = 'filo-8b9cb.firebasestorage.app';
  const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
  const COLLECTION = 'feedback';
  // #583: la vista pubblica (un documento per feedback, stesso id, solo i campi
  // sicuri) e il contatore dei numeri. La collezione vera non si legge più
  // senza credenziali: vedi firestore.rules e src/shared/feedbackPublicView.js.
  const VIEW_COLLECTION = 'feedback-public';
  const COUNTERS_COLLECTION = 'counters';
  const SEQ_COUNTER = 'feedbackSeq';

  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;

  // ---- helpers ----
  // L'uuid non serve solo a non far collidere due nomi: da #582 è ANCHE il
  // segreto del percorso di un allegato (storage.rules concede la creazione
  // solo su un nome che lo contiene, e mai la sovrascrittura). Quindi i bit
  // vengono dal generatore crittografico quando c'è; `Math.random()` resta
  // l'ultima spiaggia per non rompere ambienti senza `crypto`, mai la prima.
  function uuid() {
    const c = global.crypto;
    if (c?.randomUUID) return c.randomUUID();
    if (c?.getRandomValues) {
      const b = c.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // Percorso di un allegato dentro il bucket. FONTE UNICA della forma del nome:
  // `storage.rules` concede la creazione SOLO su un nome fatto così, e una
  // sentinella (tests/unit/storageRulesAllegati.test.mjs) confronta quello che
  // esce di qui con l'espressione scritta nelle regole. Cambiare la forma qui
  // senza cambiarla là vuol dire che dal giorno del deploy nessun allegato si
  // carica più: il test lo dice prima.
  //
  // Forma: feedback/<etichetta_>?<millisecondi>_<uuid>.<estensione>
  // L'etichetta facoltativa dice la provenienza (`agent` per i ritrovamenti
  // dell'agente esploratore); i millisecondi servono a leggere a occhio quando
  // è arrivato; l'uuid è la parte che non si indovina.
  function attachmentPath(mimeOrExt, label) {
    const raw = String(mimeOrExt || '');
    const ext = (raw.includes('/') ? raw.split('/')[1] : raw).replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'bin';
    const et = String(label || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 16);
    return `${COLLECTION}/${et ? `${et}_` : ''}${Date.now()}_${uuid()}.${ext}`;
  }

  // I due modi in cui si può nominare un oggetto del bucket di Filo: il
  // percorso REST di Firebase e quello diretto di Google Storage. Host → inizi
  // ammessi del percorso, NOME DEL DEPOSITO compreso.
  //
  // I nomi del deposito sono due e sono lo stesso deposito: quello attuale
  // (`…firebasestorage.app`) e quello storico che finisce in `appspot.com`, che
  // gli allegati più vecchi hanno ancora dentro il proprio indirizzo. Con il
  // solo nome attuale un allegato del 2025 non sarebbe più riconosciuto come
  // roba di Filo, e la dashboard smetterebbe di aprirlo.
  const DEPOSITI = [BUCKET, `${PROJECT_ID}.appspot.com`];
  // ⚠️ Tabella SENZA eredità (`Object.create(null)`), e non è un vezzo: la
  // chiave con cui la si interroga è il nome di dominio scritto da chi manda la
  // segnalazione. Una tabella normale di nomi ne contiene già alcuni che
  // nessuno ci ha messo — `__proto__`, `constructor`, `toString` — e chiedendo
  // quelli tornava roba che non è un elenco di inizi: il `.some()` sotto
  // esplodeva invece di rispondere «no», e chi guardava un allegato si trovava
  // un guasto generico al posto della frase che dice che quello non è un
  // allegato di Filo (#582, giro 7). Cadeva dal lato chiuso, quindi non era una
  // porta aperta; ma una domanda di sicurezza deve RISPONDERE.
  const PREFISSI_ALLEGATO = Object.assign(Object.create(null), {
    'firebasestorage.googleapis.com': DEPOSITI.map((b) => `/v0/b/${b}/o/`),
    'storage.googleapis.com': DEPOSITI.map((b) => `/${b}/`),
  });

  // Un URL è un allegato del bucket dei feedback? PURA. Serve a due cose che
  // devono dare la stessa risposta: il guard anti-SSRF del main (che non deve
  // trasformare la decifratura allegati in una fetch arbitraria) e la decisione
  // di allegare o no il token dell'owner alla richiesta.
  //
  // ⚠️ Il confronto è sul BUCKET, non sull'host. Fermarsi all'host sembrava
  // bastare finché questa risposta serviva solo a non fare fetch arbitrarie:
  // da quando decide anche se firmare la richiesta con l'identità dell'owner,
  // l'host da solo è una porta aperta. L'indirizzo dell'allegato non lo sceglie
  // l'owner — sta dentro il documento del feedback, e un feedback lo crea
  // chiunque, anche senza account: bastava indicare un bucket qualsiasi ospitato
  // da Google e la dashboard ci portava il token dell'owner.
  // L'URL si PARSA, non si confronta a colpi di regex: `new URL` normalizza i
  // casi in cui una regex si fa fregare (host in maiuscolo, `@`, `..`), e un
  // indirizzo che non si parsa vale "no".
  function isAttachmentUrl(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (_) { return false; }
    if (u.protocol !== 'https:') return false;
    const prefissi = PREFISSI_ALLEGATO[u.hostname];
    // `Array.isArray` e non `!!`: la tabella non ha eredità, ma il confine lo
    // attraversa roba scelta da chi manda la segnalazione e questa domanda
    // decide se firmare col gettone di chi riceve le segnalazioni. Se un
    // giorno la tabella torna a essere un oggetto normale, qui si continua a
    // rispondere «no» invece di esplodere.
    return Array.isArray(prefissi) && prefissi.some((p) => u.pathname.startsWith(p));
  }

  // Intestazioni con cui l'owner scarica un allegato. PURA.
  //
  // Dal #583 la lettura del deposito è negata dalle regole a CHIUNQUE, owner
  // compreso: quello che apre un allegato è il download token dentro l'URL,
  // che Firebase valuta prima delle regole. Quindi questo Bearer non apre più
  // niente da solo, e resta per una ragione sola: se un domani le regole
  // tornassero a riconoscere un'identità, la richiesta è già firmata nel modo
  // giusto invece di esserlo nel modo comodo.
  //
  // La regola che conta è DOVE va: il token dell'owner esce SOLO verso il
  // deposito di Filo, e `isAttachmentUrl` lo confronta per intero, parsando
  // l'URL. L'indirizzo di un allegato non lo sceglie l'owner — sta dentro il
  // documento del feedback, e un feedback lo manda chiunque: su qualunque altro
  // URL queste intestazioni sono vuote.
  function attachmentFetchHeaders(url, idToken) {
    const t = String(idToken || '');
    if (!t || !isAttachmentUrl(url)) return {};
    return { Authorization: `Bearer ${t}` };
  }

  // Etichetta con cui si MOSTRA un indirizzo che arriva da fuori. PURA.
  //
  // Un indirizzo dentro una segnalazione non lo sceglie Filo: lo scrive chi
  // manda, e una segnalazione la manda chiunque, anche senza account. Quando
  // quell'indirizzo diventa qualcosa su cui si clicca, la scritta che si legge
  // deve dire dove si va — altrimenti è un'esca dentro una pagina di Filo.
  //
  // Cosa mangiava la vecchia scritta (i primi 80 caratteri dell'indirizzo,
  // tagliati senza nemmeno un puntino): chi lo costruisce apposta sceglie cosa
  // cade dentro quegli 80 caratteri, e `https://filo.app/guida/…@sito-di-un-
  // estraneo.invalid/accedi` si leggeva come un indirizzo di Filo.
  //
  // Le tre regole, in ordine di importanza:
  // 1. la parte prima della chiocciola NON si mostra mai: è lì solo per mentire
  //    (`u.host` non la contiene);
  // 2. l'host non si taglia MAI dalla coda, perché la coda è il posto vero
  //    (`aggiornamento.filo.app.qualcosa.sito-di-un-estraneo.invalid` sarebbe la
  //    stessa bugia un piano più sotto). Se è l'host a non entrare, si taglia da
  //    DAVANTI e il puntino va all'inizio;
  // 3. un indirizzo tagliato lo dice, con un carattere di troncamento.
  // Fuori si passa l'indirizzo già normalizzato da `new URL` (in pagina:
  // l'uscita di safeHref), così l'etichetta e la destinazione parlano dello
  // stesso indirizzo. Se non si parsa, torna stringa vuota: chi chiama mostrerà
  // l'indirizzo crudo, che però non è un collegamento.
  const LINK_LABEL_MAX = 80;
  function linkLabel(rawUrl, max) {
    const limite = Number.isFinite(max) && max >= 8 ? Math.floor(max) : LINK_LABEL_MAX;
    let u;
    try { u = new URL(String(rawUrl || '')); } catch (_) { return ''; }
    // Solo indirizzi che portano su un sito. `javascript:alert(1)` si parsa
    // benissimo, ha host vuoto, e l'etichetta diventerebbe `alert(1)`: una
    // scritta che non dice dove si va, che è esattamente ciò che questa
    // funzione esiste per evitare.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    const host = u.host; // host = dominio + porta, senza credenziali davanti
    const resto = `${u.pathname}${u.search}${u.hash}`;
    if (host.length >= limite) return `…${host.slice(host.length - (limite - 1))}`;
    if (host.length + resto.length <= limite) return `${host}${resto}`;
    return `${host}${resto.slice(0, limite - host.length - 1)}…`;
  }

  // Anti-duplicati (#370): id documento STABILE per una singola composizione di
  // feedback. Se il chiamante fornisce un submissionId, il documento viene creato
  // con quell'id; un secondo invio con lo stesso id (es. un tentativo andato in
  // timeout lato UI ma riuscito sul server, poi ripetuto dall'utente) viene
  // rifiutato dal server (409 ALREADY_EXISTS) invece di creare un duplicato.
  // Ripulisce l'id ai caratteri ammessi da Firestore per un documentId e scarta
  // i pattern vietati ('.', '..', __*__): in quei casi torna '' → creazione
  // normale con id auto-generato (retrocompat, nessuna idempotenza).
  function sanitizeDocId(id) {
    if (!id) return '';
    const s = String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200);
    if (!s || s === '.' || s === '..' || /^__.*__$/.test(s)) return '';
    return s;
  }

  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // Upload diretto a Firebase Storage. Ritorna { url, name }.
  //
  // L'upload è una CREAZIONE e basta: dal #582 le regole non concedono la
  // sovrascrittura, quindi un nome già esistente (che l'uuid rende comunque
  // improbabile) torna 403 invece di calpestare l'allegato di qualcun altro.
  // L'URL che torna porta il download token: da quando la lettura del bucket è
  // riservata all'owner, quel token È il permesso di leggere l'allegato — va
  // trattato come il contenuto, non come un indirizzo qualunque.
  //
  // ⚠️ DA QUI NON ESCE NIENTE IN CHIARO (#602). Questo è l'unico punto dell'app
  // che scrive nel deposito, ed è qui che il controllo va messo: i chiamanti
  // erano tre e la cifratura la ricordavano in due. Chi carica passa da
  // `sealForUpload`; se i byte che arrivano non sono un ciphertext la chiamata
  // si ferma prima della rete. Il tetto di lettura di quel deposito è il link
  // col codice di scarico, che vive dentro il documento del feedback e gira: un
  // allegato in chiaro lì dentro lo legge chiunque si sia portato via il link.
  async function uploadImage(blob) {
    await assertSealed(blob);
    const name = attachmentPath(blob.type || 'png');
    const url = `${STORAGE_BASE}?uploadType=media&name=${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`upload storage fallito (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const token = json.downloadTokens || (json.metadata?.downloadTokens) || '';
    // Il token di scarico è la CHIAVE dell'allegato, non un ornamento del link
    // (#583, giro 8): da quando le regole del deposito negano il `get`, un
    // indirizzo senza token non apre più niente — nemmeno al main dell'owner,
    // che è l'unico che quegli allegati li deve vedere. Prima il link si
    // costruiva lo stesso e funzionava, perché il file era aperto a chiunque:
    // adesso sarebbe un allegato perso in silenzio, scoperto settimane dopo da
    // chi apre il feedback e trova un buco. Meglio dirlo subito: chi invia
    // ritrova il nome del file fra quelli non caricati (i due chiamanti
    // raccolgono l'errore in `failed`) e può riprovare.
    if (!token) {
      throw new Error('il deposito non ha rilasciato il codice di scarico: '
        + "senza, l'allegato non sarebbe più leggibile da nessuno.");
    }
    const publicUrl = `${STORAGE_BASE}/${encodeURIComponent(name)}?alt=media&token=${token}`;
    return { url: publicUrl, name };
  }

  // ---- S1.F2.1: statusPublic — enum grossolano in chiaro ----------------------
  // Mapping fine→pubblico. Tre valori: 'open' (in lavorazione OPPURE bloccato —
  // i due collassano per non regalare hill-climbing: l'attaccante non distingue
  // `blocked` da un normale feedback in lavorazione), 'closed' (risolto/archiviato),
  // 'pending-approval' (riservato al futuro, oggi mai assegnato).
  //
  // ⚠️ NOTA SICUREZZA CRITICA: `blocked` DEVE mappare su `open`, non su `closed`.
  //   Se mappasse su `closed` o su un valore distinto, chi legge Firestore senza
  //   chiave potrebbe riconoscere un attacco beccato e usarlo per fare hill-climbing.
  //
  // Gli stati CANONICI della macchina a stati stanno in SN_FB_STATUS.PUBLIC_MAP
  // (shared/feedbackStatus.js): lì i "beccati" (attack/spam/suspicious_file e i
  // confermati) collassano sugli stessi valori dei feedback normali. Qui resta
  // solo il mapping degli stati LEGACY ritirati (documenti storici non ancora
  // migrati). Non duplicare il mapping altrove.
  const STATUS_PUBLIC_MAP = {
    new:     'open',
    draft:   'open',
    todo:    'open',
    clarify: 'open',
    review:  'open',
    blocked: 'open',   // ← CUORE DI SICUREZZA: collassa insieme agli "in lavorazione"
    done:     'closed',
    verified: 'closed',
    ignored:  'closed',
    archived: 'closed',
  };

  /**
   * Funzione pura condivisa: mappa uno status fine al valore pubblico grossolano.
   * Riusata in tutti i percorsi di scrittura di `status`. Da un unico posto.
   * Lookup pigra su SN_FB_STATUS (se caricato) così i due file non impongono un
   * ordine di caricamento; il fallback legacy copre gli stati ritirati.
   *
   * @param {string} fineStatus - Valore `status` fine (es. 'attack', 'done').
   * @returns {'open'|'closed'|'pending-approval'} Valore pubblico sicuro.
   */
  function statusToPublic(fineStatus) {
    const FS = global.SN_FB_STATUS;
    if (FS && FS.PUBLIC_MAP[fineStatus]) return FS.PUBLIC_MAP[fineStatus];
    return STATUS_PUBLIC_MAP[fineStatus] || 'open'; // default safe: unknown → 'open'
  }

  // ---- cifratura campi sensibili (S1.2) ----

  // PERCHÉ NON ESISTE PIÙ UN RIPIEGO IN CHIARO (#602)
  //   Fin qui la cifratura era una cortesia: se la chiave pubblica non c'era, o
  //   se l'operazione andava storta, il testo e gli allegati partivano lo stesso
  //   in chiaro, con una riga nella console che non legge nessuno. Il risultato
  //   è il contrario di quello che la cifratura serve a ottenere: il momento in
  //   cui qualcosa si rompe è esattamente il momento in cui il contenuto va
  //   protetto di più, e chi manda non lo sa. Adesso una cifratura che non si
  //   può fare FERMA la scrittura, e chi l'ha chiesta legge cosa è mancato.
  //
  //   Il cutover è del 25 giugno 2026 e non torna indietro: `isEnabled()` falso
  //   vuol dire chiave pubblica assente o interruttore spento a mano, cioè una
  //   copia dell'app messa male — non uno stato di esercizio.

  // Il motivo per cui la cifratura non si può fare, in una frase leggibile da
  // chi non sa niente di codice. Stringa vuota = si può cifrare.
  function encryptionUnavailable() {
    const C = global.SN_FEEDBACK_CRYPTO;
    if (!C || typeof C.isEnabled !== 'function') {
      return 'la parte di Filo che cifra non è stata caricata';
    }
    if (!C.hasPublicKey()) return 'manca la chiave con cui si cifra';
    if (!C.isEnabled()) return 'la cifratura è spenta su questa copia di Filo';
    return '';
  }

  // Frase unica per chi manda: dice cosa è mancato E che non è partito niente.
  // La leggono il riquadro dentro le pagine, la pagina dei feedback e la board.
  // Va bene sia per un invio sia per un singolo allegato, perché in tutti e due
  // i casi la cosa vera da dire è la stessa: non è arrivato niente da nessuna
  // parte, e il motivo.
  function encryptionBlockedMessage(motivo) {
    return `Non ho mandato niente: ${motivo || 'non riesco a cifrare'}. `
      + 'Senza cifratura quel contenuto lo può leggere chiunque.';
  }

  // Cifra un campo testo. Se non si può cifrare, LANCIA: il chiamante decide se
  // fermarsi (l'invio) o lasciare il campo com'era (le scritture della
  // dashboard), ma nessuno scrive il valore in chiaro al posto del cifrato.
  async function maybeEncrypt(value) {
    if (value == null || value === '') return value;
    const motivo = encryptionUnavailable();
    // Stesso tipo di errore degli allegati: chi lo riceve deve poter distinguere
    // «non si è potuto cifrare» da «la rete non c'era», perché il primo non si
    // risolve riprovando (scripts/claude-feedback.mjs lo usa per il codice
    // d'uscita, la pagina per decidere che frase mostrare).
    if (motivo) throw new ErroreCifratura(encryptionBlockedMessage(motivo));
    const C = global.SN_FEEDBACK_CRYPTO;
    let out;
    try { out = await C.encryptForOwner(String(value)); }
    catch (e) {
      throw new ErroreCifratura(encryptionBlockedMessage(
        `la cifratura non è riuscita (${e?.message || e})`));
    }
    // Cintura: se quello che torna non è un ciphertext, qualcuno ha sostituito
    // il modulo di cifratura con qualcosa che restituisce l'originale.
    if (!C.isEncrypted(out)) {
      throw new ErroreCifratura(encryptionBlockedMessage('il testo non risulta cifrato'));
    }
    return out;
  }

  // S1.F2.1: cifra il campo `status` fine quando il gate è acceso.
  // `statusPublic` (il mapping grossolano) viene sempre scritto in chiaro accanto:
  // calcolato PRIMA della cifratura, in modo che i lettori senza chiave privata
  // (C5, board utente) usino quello. Ritorna { fineStatus, publicStatus }.
  async function encryptStatus(status) {
    const publicStatus = statusToPublic(status);
    // #476: si cifra a LUNGHEZZA FISSA. La cifratura non imbottisce, quindi
    // senza questo il campo cifrato è lungo quanto il nome dello stato e
    // contarne i caratteri equivale a leggerlo: dal database pubblico si
    // pescavano i feedback beccati misurando il campo, senza chiave e senza
    // login. Chi decifra toglie gli spazi (SN_FB_STATUS.unpadFromCipher).
    const FS = global.SN_FB_STATUS;
    const daCifrare = FS && FS.padForCipher ? FS.padForCipher(status) : status;
    const fineStatus = await maybeEncrypt(daCifrare); // cifra solo se isEnabled()
    return { fineStatus, publicStatus };
  }

  // L'errore che dice «questo non si è potuto cifrare». Ha una classe sua
  // perché chi invia lo tratta diversamente da un caricamento andato storto:
  // un caricamento fallito lascia partire il resto della segnalazione, una
  // cifratura mancata ferma tutto.
  class ErroreCifratura extends Error {
    constructor(message) { super(message); this.name = 'ErroreCifratura'; this.cifratura = true; }
  }
  function isEncryptionError(e) { return !!(e && e.cifratura === true); }

  // Cifra i byte di un allegato prima dell'upload su Storage. Ritorna un Blob
  // con contentType application/octet-stream (il contenuto è opaco: ciphertext
  // Uint8Array). Se non si può cifrare LANCIA un ErroreCifratura: il blob
  // originale da qui non esce (#602).
  async function sealForUpload(blob) {
    const motivo = encryptionUnavailable();
    if (motivo) throw new ErroreCifratura(encryptionBlockedMessage(motivo));
    const C = global.SN_FEEDBACK_CRYPTO;
    let sealed;
    try {
      const ab = await blob.arrayBuffer();
      sealed = await C.encryptBytesForOwner(new Uint8Array(ab));
    } catch (e) {
      throw new ErroreCifratura(encryptionBlockedMessage(
        `la cifratura dell'allegato non è riuscita (${e?.message || e})`));
    }
    if (!C.isEncryptedBytes(sealed)) {
      throw new ErroreCifratura(encryptionBlockedMessage("l'allegato non risulta cifrato"));
    }
    return new Blob([sealed], { type: 'application/octet-stream' });
  }

  // Il controllo all'imbocco del deposito: i byte che stanno per partire devono
  // essere un ciphertext. Legge solo l'intestazione (78 byte), non l'allegato
  // intero. Un `Blob` senza `slice` (i finti dei test) viene letto per intero.
  async function assertSealed(blob) {
    const C = global.SN_FEEDBACK_CRYPTO;
    if (!C || !C.isEncryptedBytes) {
      throw new ErroreCifratura(encryptionBlockedMessage(encryptionUnavailable()
        || 'la parte di Filo che cifra non è stata caricata'));
    }
    const HEAD = 1 + 65 + 12; // versione + chiave effimera + nonce
    let testa;
    try {
      const pezzo = (blob && typeof blob.slice === 'function') ? blob.slice(0, HEAD) : blob;
      testa = new Uint8Array(await pezzo.arrayBuffer());
    } catch (e) {
      throw new ErroreCifratura(encryptionBlockedMessage(
        `non ho potuto controllare che l'allegato fosse cifrato (${e?.message || e})`));
    }
    if (!C.isEncryptedBytes(testa)) {
      throw new ErroreCifratura(encryptionBlockedMessage("l'allegato non risulta cifrato"));
    }
  }

  // Carica un allegato (immagine O file) su Storage e lo classifica per la UI.
  // Usata dalla dashboard per allegare immagini/file ai COMMENTI dei feedback
  // (#190.3). Su feedback/* chiunque può CREARE un allegato nuovo senza login
  // (storage.rules), ma nessuno può sovrascriverne uno: niente token da passare
  // di qui. Ritorna { kind:'img'|'file', url, name, type }.
  //
  // #602: qui si cifra come nell'invio di un feedback. Gli allegati dei commenti
  // salivano in chiaro, ed è il caso peggiore — nei commenti finiscono proprio
  // le schermate e i log del lavoro. `kind` e `type` restano quelli del file
  // VERO (non dell'involucro cifrato): sono il modo in cui la dashboard sa se
  // mostrare un'immagine o un collegamento, e con che tipo riaprire il file
  // dopo averlo decifrato.
  async function uploadAttachment(blob, name) {
    const type = (blob && blob.type) || '';
    const kind = type.startsWith('image/') ? 'img' : 'file';
    const sealed = await sealForUpload(blob);
    const u = await uploadImage(sealed);
    return {
      kind,
      url: u.url,
      name: String(name || (kind === 'img' ? 'immagine' : 'allegato')),
      type,
    };
  }

  // Converte un valore JS in un Value Firestore REST.
  function toFsValue(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'string') return { stringValue: v };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') {
      return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (Array.isArray(v)) {
      return { arrayValue: { values: v.map(toFsValue) } };
    }
    if (typeof v === 'object') {
      const fields = {};
      for (const [k, vv] of Object.entries(v)) fields[k] = toFsValue(vv);
      return { mapValue: { fields } };
    }
    return { stringValue: String(v) };
  }

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

  // ── Chi legge la collezione vera, e come ci arriva (#583) ──────────────────
  // Le regole ammettono solo l'owner (admin) e il server. L'ID token dell'owner
  // vive nel main process e non deve mai arrivare in una pagina, quindi da una
  // pagina filo:// la lettura si CHIEDE al main, che la esegue con il token e
  // torna le righe già decodificate. Nel main (e negli script) la fetch è
  // diretta, col token passato dal chiamante.
  //
  // Solo `window.filo` (il ponte delle pagine interne): un content script su una
  // pagina web ha `chrome.runtime.sendMessage`, ma di feedback non ne legge — e
  // il canale del main rifiuta comunque le origini che non sono filo://.
  function pageBridge() {
    const w = (typeof window !== 'undefined') ? window : null;
    if (w && w.filo && typeof w.filo.message === 'function') return (m) => w.filo.message(m);
    return null;
  }

  async function readViaMain(bridge, payload) {
    // 'feedback_fetch' = MSG.FEEDBACK_FETCH (src/shared/messages.js). Qui il
    // vocabolario non è caricato: questo modulo gira anche fuori dalle pagine.
    const r = await bridge({ type: 'feedback_fetch', ...payload });
    if (!r || r.ok !== true) {
      const code = r && r.code;
      if (code === 'not_admin' || code === 'forbidden') {
        // Non è un guasto: è un permesso che manca. Va detto con parole sue —
        // tradotto in "controlla la connessione" manderebbe a guardare la cosa
        // sbagliata, e riprovare non servirebbe a niente.
        const e = new Error('i feedback li legge solo chi li gestisce: accedi con l\'account amministratore per vederli.');
        e.code = 'FEEDBACK_READ_DENIED';
        throw e;
      }
      throw new Error((r && r.error) || 'lettura dei feedback non riuscita');
    }
    return Array.isArray(r.rows) ? r.rows : [];
  }

  function fsDocToObject(doc) {
    const out = {};
    for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFsValue(v);
    out._id = doc.name?.split('/').pop() || '';
    out._createTime = doc.createTime || null;
    // Ultima scrittura sul documento (la mette Firestore, non chi scrive): è
    // il segno con cui la dashboard riconosce, a ogni giro, quali feedback
    // sono cambiati senza rileggerli tutti.
    out._updateTime = doc.updateTime || null;
    return out;
  }

  // ---- numerazione progressiva ----
  // Ogni feedback ha un numero leggibile: `seq` (intero progressivo). Il campo
  // `subSeq` (#22.1, #22.2) è SOLO STORICO: lo scrivevano le routine quando
  // spezzavano una spec, meccanica abolita col ridisegno (SPEC-RIDISEGNO-MAX.md
  // §1). I sub-feedback esistenti restano visibili, quindi formatNum continua a
  // produrre anche la forma #N.M per la dashboard.
  function formatNum(seq, subSeq) {
    const s = Number(seq);
    if (!Number.isInteger(s) || s <= 0) return '';
    const sub = Number(subSeq);
    return Number.isInteger(sub) && sub > 0 ? `${s}.${sub}` : String(s);
  }

  // Tronca una stringa a `max` unità visibili senza mai spezzare un carattere
  // a metà. `String.slice` lavora su unità UTF-16: tagliare in mezzo a un'emoji
  // (coppia surrogata) lascerebbe un surrogato solitario che si vede come
  // rettangolino/glifo rotto. Contiamo per grafema (Intl.Segmenter, quando
  // disponibile, tiene insieme anche le emoji composte da più code point come
  // 👨‍👩‍👧 o le emoji col modificatore di tono pelle) con ripiego a code point.
  function truncateSafe(str, max) {
    const s = String(str == null ? '' : str);
    let units;
    try {
      if (typeof Intl !== 'undefined' && Intl.Segmenter) {
        const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
        units = Array.from(seg.segment(s), (g) => g.segment);
      } else {
        units = Array.from(s); // iteratore stringa → per code point, no surrogati soli
      }
    } catch {
      units = Array.from(s);
    }
    if (units.length <= max) return s;
    return units.slice(0, max).join('');
  }

  // Titolo di ripiego quando l'LLM non è disponibile: prime parole del testo.
  function fallbackName(text, maxWords = 6) {
    const words = String(text || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
    if (!words.length) return '';
    let out = words.slice(0, maxWords).join(' ');
    if (out.length > 60) return truncateSafe(out, 57).trimEnd() + '…';
    return words.length > maxWords ? out + '…' : out;
  }

  // ── Il numero progressivo (#583) ──────────────────────────────────────────
  // Prima si ricavava con una query sulla collezione feedback ordinata per
  // `seq`: una LETTURA, e dal 2026-09 la collezione non si legge senza
  // credenziali — mentre l'invio resta anonimo per scelta. Il numero adesso
  // viene da un contatore suo, `counters/feedbackSeq`: dentro c'è un intero e
  // niente altro, chiunque può farlo avanzare di uno, nessuno può farlo tornare
  // indietro (firestore.rules).
  //
  // Avanzamento con controllo di versione (`currentDocument.updateTime`): se
  // due invii partono insieme, il secondo si accorge che il contatore è
  // cambiato sotto e rilegge invece di sovrascrivere. Prima la race
  // DUPLICAVA un numero; adesso non può.
  //
  // Torna `null` (invece di lanciare) quando il contatore non c'è ancora o la
  // concorrenza non si risolve: il feedback parte SENZA numero, come già
  // faceva quando la query falliva. Il contatore lo crea e lo rimette in pari
  // l'app dell'owner (che è l'unica a poterlo scrivere a piacere).
  const SEQ_RETRIES = 5;

  async function nextSeq() {
    const docUrl = `${FIRESTORE_BASE}/${COUNTERS_COLLECTION}/${SEQ_COUNTER}`;
    for (let attempt = 0; attempt < SEQ_RETRIES; attempt++) {
      const res = await fetch(`${docUrl}?key=${API_KEY}`);
      if (res.status === 404) return null;      // contatore non ancora creato
      if (!res.ok) throw new Error(`firestore nextSeq fallito (${res.status})`);
      const doc = await res.json();
      const current = Number(fromFsValue(doc.fields?.value));
      const base = Number.isInteger(current) && current > 0 ? current : 0;
      const next = base + 1;
      const qs = [
        'updateMask.fieldPaths=value',
        `currentDocument.updateTime=${encodeURIComponent(doc.updateTime || '')}`,
        `key=${API_KEY}`,
      ].join('&');
      const w = await fetch(`${docUrl}?${qs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { value: { integerValue: String(next) } } }),
      });
      if (w.ok) return next;
      // 400/409/412: qualcun altro ha scritto nel frattempo (precondizione
      // fallita). Si rilegge e si riprova.
      if (w.status === 400 || w.status === 409 || w.status === 412) continue;
      throw new Error(`firestore nextSeq fallito (${w.status})`);
    }
    return null;
  }

  // Rimette il contatore in pari: lo crea se manca, lo alza se un `seq` più
  // alto è già in giro (backfill, migrazioni, numeri assegnati a mano). Solo
  // owner: serve il token admin. Torna il valore in vigore alla fine.
  //
  // `allowLower` lo RIPORTA GIÙ quando è più alto di qualunque `seq` esistente.
  // Serve perché farlo avanzare di uno lo può fare chiunque (è ciò che fa chi
  // invia, e non c'è modo di distinguerlo da chi lo alza a vuoto): senza questo,
  // un estraneo che lo spinge a diecimila lascerebbe i feedback nuovi con numeri
  // assurdi per sempre, e l'unica cura sarebbe la console. Si passa `true` SOLO
  // con il numero più alto VERO in mano (SN_FEEDBACK.maxSeq, che lo chiede al
  // server): con il massimo dei soli feedback caricati si riassegnerebbero
  // numeri già usati.
  //
  // Anche col massimo vero resta una corsa: un invio fra la nostra lettura e la
  // nostra scrittura assegna un numero che noi non abbiamo visto, e abbassare
  // lo farebbe riusare. Per questo si scende solo quando lo scarto è più largo
  // di qualunque corsa realistica (SEQ_LOWER_MARGIN): uno scarto di uno o due è
  // gente che sta inviando adesso, uno scarto di cento è un contatore gonfiato.
  // Uno scarto piccolo resta com'è: sono numeri saltati, cioè un'etichetta con
  // un buco, e vale meno del rischio di stamparne due uguali.
  const SEQ_LOWER_MARGIN = 10;

  async function ensureSeqCounter(maxSeq, opts = {}) {
    const value = Math.max(0, Math.trunc(Number(maxSeq) || 0));
    const docUrl = `${FIRESTORE_BASE}/${COUNTERS_COLLECTION}/${SEQ_COUNTER}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    // La lettura del contatore è pubblica: qui il token non serve.
    const res = await fetch(`${docUrl}?key=${API_KEY}`);
    let current = -1;
    if (res.ok) {
      const doc = await res.json();
      const v = Number(fromFsValue(doc.fields?.value));
      current = Number.isInteger(v) ? v : -1;
    } else if (res.status !== 404) {
      throw new Error(`firestore contatore non leggibile (${res.status})`);
    }
    if (current === value) return current;
    if (current > value && !opts.allowLower) return current;
    if (current > value && current - value < SEQ_LOWER_MARGIN) return current;
    const w = await fetch(`${docUrl}?updateMask.fieldPaths=value&key=${API_KEY}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: { value: { integerValue: String(value) } } }),
    });
    if (!w.ok) {
      const t = await w.text().catch(() => '');
      throw new Error(`firestore contatore non scritto (${w.status}): ${t.slice(0, 200)}`);
    }
    return value;
  }

  // Invia un feedback. images: array di { dataUrl } (max ~5).
  // files: array di { name, type, dataUrl } per allegati non-immagine (pdf,
  // txt, md, json…), max ~5. `name` è il titolo breve (generato da un LLM nel
  // main process prima della chiamata). Ritorna { id, url } del documento creato.
  // `parentId` (DC4): se presente, questo feedback nasce COLLEGATO a un altro
  // (es. la riapertura di un fix "Risolti" dalla board). Nessuna sub-numerazione
  // automatica (la spezzatura in #seq.subSeq è abolita; i .x esistenti sono
  // storico): il collegato nasce come un feedback normale (numero
  // proprio), `parentId` serve solo a far comparire "collegato a #N" in
  // dashboard e a far risalire chi triagia all'originale.
  async function submit({ text, url, title, userAgent, clientId, clientIdHash, images, files, name, parentId, capabilityGapId, submissionId }) {
    // NIENTE PARTE SE NON SI PUÒ CIFRARE (#602). Il controllo sta QUI, prima di
    // qualunque caricamento e prima di creare il documento: così «non è partito
    // niente» è vero alla lettera, e non «è partito tutto tranne il testo».
    // Chi chiama trasforma questo errore in una frase per l'utente.
    {
      const motivo = encryptionUnavailable();
      if (motivo) throw new ErroreCifratura(encryptionBlockedMessage(motivo));
    }
    // Allegati che NON sono riusciti a caricarsi: li riportiamo al chiamante
    // così la UI può avvisare l'utente (un upload fallito veniva ingoiato in
    // silenzio e il feedback partiva senza il file, senza alcun segnale).
    const failed = [];
    const imgs = Array.isArray(images) ? images.slice(0, 5) : [];
    const uploaded = [];
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img?.dataUrl) continue;
      const rawBlob = dataUrlToBlob(img.dataUrl);
      // Limite difensivo lato client: 4 MB per immagine (misurato sul raw,
      // prima della cifratura che aggiunge ~90 byte di overhead fisso).
      if (rawBlob.size > 4 * 1024 * 1024) {
        failed.push({ name: String(img.name || `immagine ${i + 1}`), reason: 'troppo grande (max 4 MB)' });
        continue;
      }
      try {
        // S1.2: cifra i byte prima dell'upload. Da #602 `sealForUpload` lancia
        // invece di ripiegare sul blob in chiaro.
        const blobToUpload = await sealForUpload(rawBlob);
        const u = await uploadImage(blobToUpload);
        uploaded.push(u.url);
      } catch (e) {
        // Una cifratura mancata NON è un caricamento andato storto: quella
        // lascia partire il resto della segnalazione, questa ferma tutto. Le
        // immagini già caricate sono cifrate, e il documento non esiste ancora.
        if (isEncryptionError(e)) throw e;
        console.warn('[SN feedback] upload immagine fallito:', e);
        failed.push({ name: String(img.name || `immagine ${i + 1}`), reason: 'caricamento non riuscito' });
      }
    }

    // Allegati non-immagine: stesso bucket /feedback, ma conserviamo nome e
    // tipo originali per mostrarli come link scaricabili nella dashboard.
    const docs = Array.isArray(files) ? files.slice(0, 5) : [];
    const uploadedFiles = [];
    for (const f of docs) {
      const fname = String(f?.name || 'allegato');
      if (!f?.dataUrl) { failed.push({ name: fname, reason: 'file vuoto' }); continue; }
      const rawBlob = dataUrlToBlob(f.dataUrl);
      if (rawBlob.size > 4 * 1024 * 1024) { failed.push({ name: fname, reason: 'troppo grande (max 4 MB)' }); continue; }
      try {
        // S1.2: cifra anche gli allegati non-immagine.
        const blobToUpload = await sealForUpload(rawBlob);
        const u = await uploadImage(blobToUpload); // upload generico (usa blob.type)
        uploadedFiles.push({ url: u.url, name: fname, type: String(f.type || rawBlob.type || '') });
      } catch (e) {
        if (isEncryptionError(e)) throw e; // come sopra: si ferma tutto
        console.warn('[SN feedback] upload file fallito:', e);
        failed.push({ name: fname, reason: 'caricamento non riuscito' });
      }
    }

    // Numero progressivo: best-effort, il feedback parte anche se la query
    // fallisce (resterà senza numero invece di bloccare l'invio).
    let seq = null;
    try { seq = await nextSeq(); }
    catch (e) { console.warn('[SN feedback] numerazione non disponibile:', e?.message || e); }

    // S1.2 (Fase 1): cifra SOLO il contenuto inviato dall'utente che nessun
    // altro utente deve poter leggere — `text` e `url` (la superficie d'attacco
    // injection + il contesto di navigazione). NON si cifrano `title`/`name`:
    // sono mostrati all'utente che ha inviato il feedback dal popup ricompense
    // (C5), che gira sulla sua macchina SENZA chiave privata → cifrarli li
    // renderebbe illeggibili. Restano per la Fase 2 (con proiezione sanitizzata).
    // Guard: gate dormiente, senza attivazione i valori restano in chiaro.
    const [encText, encUrl] = await Promise.all([
      maybeEncrypt(text || ''),
      maybeEncrypt(url || ''),
    ]);

    // S1.F2.2: hash deterministico del clientId (SHA-256 troncato, 32 hex, in chiaro).
    // Calcolato SEMPRE (anche con gate dormiente) per uniformità del match C5.
    // Se il chiamante ha già calcolato l'hash (es. src/content/feedback.js), riusa quello.
    let resolvedClientIdHash = (typeof clientIdHash === 'string' && clientIdHash.length === 32) ? clientIdHash : '';
    if (!resolvedClientIdHash) {
      try {
        const H = global.SN_FEEDBACK_CLIENT_ID_HASH;
        if (H && H.hashClientId) {
          resolvedClientIdHash = await H.hashClientId(clientId || '');
        }
      } catch (_) {}
    }

    // S1.F2.2: cifra `clientId` se la cifratura è attiva (il match avviene via hash).
    // Con gate dormiente, clientId rimane in chiaro (retrocompat).
    const encClientId = await maybeEncrypt(clientId || '');

    // #652 — lo pseudonimo del portafoglio, se questa copia di Filo ne ha uno:
    // è l'unico modo che ha il server di sapere a chi accreditare il premio per
    // la segnalazione (all'invio e alla risoluzione). Non dice CHI è: lo
    // pseudonimo è già il nome con cui questa installazione esiste sul server
    // dei crediti. Senza portafoglio il campo non si scrive e non si premia.
    let walletPseudonym = '';
    try {
      const raw = String((global.SN_WALLET_MAIN && global.SN_WALLET_MAIN.pseudonym && global.SN_WALLET_MAIN.pseudonym()) || '');
      if (/^[0-9a-f]{16}$/.test(raw)) walletPseudonym = raw;
    } catch (_) {}

    const doc = {
      fields: {
        text: toFsValue(encText),
        url: toFsValue(encUrl),
        title: toFsValue(title || ''),
        name: toFsValue(String(name || '').slice(0, 200)),
        userAgent: toFsValue(userAgent || ''),
        clientId: toFsValue(encClientId),
        // S1.F2.2: hash in chiaro per il match C5 (il raw clientId può essere cifrato).
        clientIdHash: toFsValue(resolvedClientIdHash),
        images: toFsValue(uploaded),
        files: toFsValue(uploadedFiles),
        // S1.F2.1: statusPublic SEMPRE in chiaro anche se status fine è cifrato.
        // Un feedback nuovo parte da 'new' → mappa su 'open'.
        statusPublic: toFsValue('open'),
        createdAt: { timestampValue: nowIso },
        // L'ORA DELL'ULTIMA SCRITTURA, scritta da chi scrive. È il campo su cui
        // la dashboard chiede «cosa è cambiato da allora?»: un feedback che non
        // ce l'ha non compare più in quella domanda, quindi OGNI cammino che
        // tocca un feedback deve rimetterlo (vedi `touchUpdatedAt`).
        updatedAt: { timestampValue: nowIso },
      },
    };
    if (seq) {
      doc.fields.seq = { integerValue: String(seq) };
      doc.fields.subSeq = { integerValue: '0' };
    }
    if (parentId) {
      doc.fields.parentId = toFsValue(String(parentId));
    }
    if (walletPseudonym) {
      doc.fields.walletPseudonym = toFsValue(walletPseudonym);
    }
    // F4 — auto-feedback: id strutturale del gap di capacità (per dedup F5).
    // Solo per feedback auto (`clientId` inizia con 'auto:'), non per quelli utente.
    if (capabilityGapId && String(clientId || '').startsWith('auto:')) {
      doc.fields.capabilityGapId = toFsValue(String(capabilityGapId).slice(0, 100));
    }

    // Idempotenza anti-duplicati (#370): con un submissionId stabile creiamo il
    // documento con QUELL'id (Firestore: `?documentId=`). Così se un invio va in
    // timeout lato UI ma è comunque riuscito sul server, un secondo invio della
    // stessa bozza non crea un duplicato — il server rifiuta il doc già presente.
    const docId = sanitizeDocId(submissionId);
    const idParam = docId ? `documentId=${encodeURIComponent(docId)}&` : '';
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}?${idParam}key=${API_KEY}`;
    let res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (res.status === 403) {
      // Rules non ancora aggiornate ai campi nuovi (name/seq/subSeq/parentId/clientIdHash):
      // meglio un feedback senza numero/titolo/collegamento che un invio
      // fallito. Ritenta con il solo schema storico.
      delete doc.fields.name;
      delete doc.fields.seq;
      delete doc.fields.subSeq;
      delete doc.fields.parentId;
      delete doc.fields.clientIdHash; // S1.F2.2: rules vecchie potrebbero rifiutarlo
      delete doc.fields.walletPseudonym; // #652: idem, finché le regole non sono deployate
      seq = null;
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
    }
    // 409 ALREADY_EXISTS con documentId → il feedback è già stato scritto da un
    // tentativo precedente (identico submissionId). Non è un errore: successo
    // idempotente, nessun duplicato creato.
    if (docId && res.status === 409) {
      return { id: docId, seq: null, images: uploaded, files: uploadedFiles, failed, deduped: true };
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore create fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const json = await res.json();
    return { id: json.name?.split('/').pop() || '', seq, images: uploaded, files: uploadedFiles, failed };
  }

  // ── Il tetto del caricamento, e come si dice ──────────────────────────────
  // Le pagine che ELENCANO i feedback (dashboard di gestione, pagina feedback,
  // bacheca) ne chiedono al massimo questi, dal più recente al più vecchio.
  // È un TETTO, non un totale: appena la raccolta lo supera, i più vecchi
  // restano fuori e nessun conteggio calcolato in pagina può vederli.
  const LIST_PAGE_SIZE = 500;

  // Il caricamento ha toccato il tetto? Allora ogni numero che ne deriva è un
  // "almeno N", non un totale.
  function listHitCap(loaded, pageSize) {
    const cap = Number(pageSize) > 0 ? Number(pageSize) : LIST_PAGE_SIZE;
    return Array.isArray(loaded) && loaded.length >= cap;
  }

  // Come si scrive un conteggio accanto al nome di una sezione: "(24)" quando
  // il numero è il totale, "(24+)" quando il caricamento ha toccato il tetto e
  // quindi è solo un minimo. Un numero che afferma un totale che non conosce
  // sembra una risposta ed è peggio di nessun numero; il "+" costa un carattere
  // e dice la verità (caricare TUTTO costerebbe letture, ed è una scelta
  // dell'owner, non di questa riga).
  function countLabel(n, truncated) {
    const v = Math.max(0, Math.trunc(Number(n) || 0));
    return truncated ? `(${v}+)` : `(${v})`;
  }

  // Perché c'è il "+": lo spiega l'hover, così il segno non resta un enigma.
  // La stessa frase serve anche a una sezione che sembra vuota (i feedback più
  // vecchi non sono in pagina), quindi non nomina il numero: vale in entrambi.
  const COUNT_CAP_HINT =
    `Caricati i ${LIST_PAGE_SIZE} feedback più recenti: se ce ne sono di più vecchi, non sono in pagina e non entrano nel conto.`;

  // Lista tutti i feedback (più recenti prima). Usata dalla dashboard e dalla
  // bacheca. `timeoutMs` (opzionale): se > 0, la fetch si arrende dopo quel tempo
  // invece di restare muta finché il sistema operativo non decide di mollare
  // (offline, un `fetch` del renderer può impiegare ~13 s prima di fallire da
  // solo). Chi lo passa vuole poter mostrare uno stato d'errore in tempi umani;
  // chi lo omette mantiene il comportamento storico (nessun timeout).
  // `fields` (opzionale): i soli campi da scaricare (proiezione). Senza, arriva
  // il documento intero. La dashboard di gestione lo usa in due modi: per
  // rimandare i campi pesanti che servono solo nel dettaglio, e — con il solo
  // `__name__` — per chiedere a Firestore "cosa è cambiato?" pagando pochi
  // byte: ogni riga porta comunque `updateTime`.
  // `afterName` (anche la stringa vuota, che vuol dire «dall'inizio»): la
  // pagina è ordinata per NOME del documento e comincia dopo quello passato. È
  // il cursore di `listAll`, e non passa dal ponte con il main: da una pagina
  // filo:// una lettura completa della collezione vera non si fa.
  async function list({ pageSize = 200, timeoutMs = 0, fields = null, idToken = '', afterName = null } = {}) {
    // Da una pagina filo:// la lettura passa dal main, che ha il token admin
    // (#583): qui non c'è nessuna credenziale, e la collezione non è più
    // pubblica. Il main torna le righe già decodificate.
    const bridge = pageBridge();
    if (bridge) {
      if (typeof afterName === 'string') {
        throw new Error('lettura completa dei feedback non disponibile da una pagina: passa dal main');
      }
      return readViaMain(bridge, { op: 'list', pageSize, timeoutMs, fields });
    }
    if (typeof afterName === 'string') {
      const { rows } = await listByNameDirect(COLLECTION, { pageSize, timeoutMs, afterName, idToken });
      return rows;
    }
    return listDirect(COLLECTION, { pageSize, timeoutMs, fields, idToken });
  }

  // I feedback CHIUSI più di recente (data di chiusura decrescente), non i più
  // recenti per data d'invio. Serve a chi tiene aggiornata la bacheca: una
  // segnalazione vecchia chiusa oggi sta in fondo alla lista per data d'invio,
  // cioè fuori dalla pagina che si carica, e senza questa domanda la sua scheda
  // non verrebbe scritta mai (niente bacheca, niente annuncio e niente crediti
  // per chi l'aveva mandata). Qui invece è in cima. La data di chiusura è in
  // chiaro sul documento, quindi si può ordinare; i feedback che non sono mai
  // stati chiusi non ce l'hanno e Firestore li lascia fuori da sé.
  // Serve il token dell'owner: la collezione non si legge senza.
  async function listResolved({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, idToken = '' } = {}) {
    return listDirect(COLLECTION, { pageSize, timeoutMs, idToken, orderField: 'resolvedAt' });
  }

  // ── TUTTE le segnalazioni, non una pagina ────────────────────────────────
  //
  // `list` è una FINESTRA sui più recenti per data d'invio, e va benissimo per
  // chi guarda gli ultimi arrivati: la posta dell'owner, una diagnostica. Non
  // va bene per chi fa una domanda sull'INSIEME.
  //
  // Il caso che l'ha fatta nascere è l'archiviazione automatica: decide quali
  // fix chiusi possono uscire dalla bacheca, e chiedendo una finestra sui
  // cinquecento più recenti non guardava nemmeno le segnalazioni più vecchie —
  // cioè quelle che dovrebbe prendere per prime. Con 711 segnalazioni le 211
  // più vecchie restavano fuori: i loro fix non uscivano mai dalla bacheca,
  // restavano votabili e riapribili a pagamento, e per loro non si accendeva
  // nemmeno il segnale «gli utenti dicono che non va». Il numero peggiorava da
  // solo, perché la finestra sta ferma e le segnalazioni crescono. È lo stesso
  // difetto della vista pubblica, da un'altra porta: vedi
  // patterns/una-pagina-dei-piu-recenti-non-e-tutto.md.
  //
  // Come `listAllPublic`: si pagina col nome del documento, che è unico e
  // stabile, si passa sempre dalla porta ESPOSTA (`SN_FEEDBACK.list`) così chi
  // la sostituisce in una prova sostituisce anche questa, e il freno sulle
  // pagine non mente — se scatta, la risposta lo dice.
  async function listAllPaged({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, idToken = '', maxPages = ALL_PAGES_MAX } = {}) {
    const limit = Math.max(1, Math.min(LIST_PAGE_SIZE, Number(pageSize) || LIST_PAGE_SIZE));
    const rows = [];
    const visti = new Set();
    let cursor = '';
    let complete = false;
    for (let page = 0; page < Math.max(1, Number(maxPages) || ALL_PAGES_MAX); page += 1) {
      const porta = (global.SN_FEEDBACK && global.SN_FEEDBACK.list) || list;
      // eslint-disable-next-line no-await-in-loop
      const batch = await porta({ pageSize: limit, timeoutMs, idToken, afterName: cursor });
      const arr = Array.isArray(batch) ? batch : [];
      let nuove = 0;
      for (const r of arr) {
        const id = String((r && r._id) || '');
        if (id && visti.has(id)) continue;
        if (id) visti.add(id);
        rows.push(r);
        nuove += 1;
      }
      const ultimo = nomeDocumento(COLLECTION, arr[arr.length - 1]);
      if (arr.length < limit || nuove === 0 || !ultimo || ultimo === cursor) { complete = true; break; }
      cursor = ultimo;
    }
    return { rows, complete };
  }

  async function listAll(opts = {}) {
    const { rows } = await listAllPaged(opts);
    return rows;
  }

  // La query vera e propria, senza ponti: la usano il main (col token
  // dell'owner), gli script e la vista pubblica (che non ha bisogno di token).
  async function listDirect(collectionId, { pageSize = 200, timeoutMs = 0, fields = null, idToken = '', orderField = 'createdAt' } = {}) {
    // structuredQuery via runQuery, ordinamento decrescente sul campo chiesto
    // (per data d'invio salvo che il chiamante ne chieda un altro).
    const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId }],
        orderBy: [
          { field: { fieldPath: String(orderField || 'createdAt') }, direction: 'DESCENDING' },
        ],
        limit: pageSize,
      },
    };
    if (Array.isArray(fields) && fields.length > 0) {
      body.structuredQuery.select = { fields: fields.map((f) => ({ fieldPath: String(f) })) };
    }
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const opts = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    };
    // Timeout opzionale via AbortController. Se scatta, rilanciamo un errore con
    // "timeout" nel messaggio: così SN_CHAT_ERRORS lo riconosce come guasto di
    // rete (e non come annullamento volontario, che invece non va segnalato).
    let timer = null;
    let timedOut = false;
    if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(() => { timedOut = true; try { controller.abort(); } catch (_) {} }, timeoutMs);
    }
    let res;
    try {
      res = await fetch(endpoint, opts);
    } catch (e) {
      if (timedOut) throw new Error('firestore list: timeout di rete');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore list fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const arr = await res.json();
    const out = [];
    for (const row of arr) {
      if (!row.document) continue;
      out.push(fsDocToObject(row.document));
    }
    return out;
  }

  // Il numero più alto MAI assegnato, chiesto al server con una query sua
  // (ordinata per `seq`, un documento solo). Serve il token dell'owner: la
  // collezione non si legge senza.
  //
  // Perché non basta il massimo dei feedback caricati: il caricamento si ferma
  // ai 500 più recenti PER DATA, e Filo quel numero l'ha passato. Chi guardava
  // solo quella pagina non poteva sapere se il contatore era più alto del
  // dovuto o solo più alto di quello che aveva visto, e per prudenza non lo
  // toccava: la cura scritta per un contatore gonfiato non è mai partita.
  // Questa domanda costa UNA lettura e la risposta è esatta.
  async function maxSeq({ idToken = '', timeoutMs = 0 } = {}) {
    const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const opts = {
      method: 'POST',
      headers,
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: COLLECTION }],
          orderBy: [{ field: { fieldPath: 'seq' }, direction: 'DESCENDING' }],
          limit: 1,
        },
      }),
    };
    let timer = null;
    if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(() => { try { controller.abort(); } catch (_) {} }, timeoutMs);
    }
    let res;
    try { res = await fetch(endpoint, opts); } finally { if (timer) clearTimeout(timer); }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore maxSeq fallito (${res.status}): ${t.slice(0, 200)}`);
    }
    const arr = await res.json();
    for (const row of Array.isArray(arr) ? arr : []) {
      if (!row || !row.document) continue;
      const n = Number(fromFsValue(row.document.fields?.seq));
      if (Number.isInteger(n) && n >= 0) return n;
    }
    // Nessun feedback con un numero: il contatore non ha un massimo da
    // rispettare. `null`, non 0: chi chiama deve poter distinguere «non lo so»
    // da «zero», o riporterebbe il contatore a zero su un database vuoto.
    return null;
  }

  // Le sole "versioni" dei feedback: per ciascuno id + `_updateTime`, niente
  // campi. È la domanda che la dashboard fa a ogni giro per restare aggiornata
  // senza riscaricare tutto (≈130 KB invece di 5 MB per 500 feedback).
  async function listVersions({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0 } = {}) {
    const rows = await list({ pageSize, timeoutMs, fields: ['__name__'] });
    return rows.map((r) => ({ _id: r._id, _updateTime: r._updateTime }));
  }

  // Legge i documenti indicati (interi) in UNA richiesta (batchGet). Ritorna
  // solo quelli trovati: un id cancellato nel frattempo non compare. Vuoto → [].
  async function getMany(ids, { timeoutMs = 0, idToken = '' } = {}) {
    const wanted = (Array.isArray(ids) ? ids : []).map((s) => String(s || '')).filter(Boolean);
    if (wanted.length === 0) return [];
    const bridge = pageBridge();
    if (bridge) return readViaMain(bridge, { op: 'getMany', ids: wanted, timeoutMs });
    const endpoint = `${FIRESTORE_BASE}:batchGet?key=${API_KEY}`;
    const prefix = `${FIRESTORE_BASE}/${COLLECTION}/`;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const opts = {
      method: 'POST',
      headers,
      body: JSON.stringify({ documents: wanted.map((id) => prefix + id) }),
    };
    let timer = null;
    let timedOut = false;
    if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(() => { timedOut = true; try { controller.abort(); } catch (_) {} }, timeoutMs);
    }
    let res;
    try {
      res = await fetch(endpoint, opts);
    } catch (e) {
      if (timedOut) throw new Error('firestore batchGet: timeout di rete');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore batchGet fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const arr = await res.json();
    const out = [];
    for (const row of Array.isArray(arr) ? arr : []) {
      if (row && row.found) out.push(fsDocToObject(row.found));
    }
    return out;
  }

  // ── La vista pubblica (#583) ──────────────────────────────────────────────
  // `feedback-public/{id}`: una scheda per feedback chiuso, con i soli campi
  // pubblici (src/shared/feedbackPublicView.js decide quali e per quali
  // feedback). È ciò che leggono la bacheca e il popup delle ricompense: niente
  // token, niente ponte col main: qui dentro non c'è nulla da proteggere.

  // UNA pagina di schede pubbliche.
  //
  // Senza `afterName`: le più recenti per data d'invio, come la lista vera, così
  // chi la mostra non cambia ragionamento.
  //
  // Con `afterName` (anche la stringa vuota, che vuol dire «dall'inizio»): la
  // pagina è ordinata per NOME del documento e comincia dopo quello passato. È
  // il cursore con cui `listAllPublic` arriva in fondo alla raccolta. Il nome è
  // unico e stabile, quindi non salta né ripete righe; una data no (due schede
  // possono averla identica).
  async function listPublic({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, afterName = null } = {}) {
    if (typeof afterName === 'string') {
      const { rows } = await listByNameDirect(VIEW_COLLECTION, { pageSize, timeoutMs, afterName });
      return rows;
    }
    return listDirect(VIEW_COLLECTION, { pageSize, timeoutMs });
  }

  // ── TUTTE le schede, non una pagina ───────────────────────────────────────
  //
  // Il tetto qui sopra è una FINESTRA sui più recenti PER DATA D'INVIO, e le
  // domande che si fanno alle schede non sono su quell'asse:
  //   · «mi spetta una ricompensa?» — una segnalazione vecchia chiusa oggi ha
  //     una data d'invio vecchia, quindi la sua scheda sta in fondo: fuori
  //     dalla finestra, e chi l'ha mandata non riceve né annuncio né crediti
  //     (verifica #583, giri 3, 4 e 5: lo stesso danno rientrato da tre porte);
  //   · «quali schede vanno tolte?» — una scheda fuori dalla finestra non la
  //     può togliere più nessuno, e un fix vecchio che torna in lavorazione
  //     resta in bacheca come risolto, votabile e riapribile a pagamento;
  //   · «cosa mostra la bacheca?» — i fix più vecchi sparirebbero dalla vetrina
  //     pur essendo pubblicati.
  // Sono tre modi di chiedere «tutte le schede». Con 552 schede e un tetto di
  // 500 la risposta ne dimenticava 52, in silenzio.
  //
  // Quindi qui non si finestra: si PAGINA fino in fondo, passando sempre da
  // `listPublic` — una porta sola, così chi la sostituisce in una prova
  // sostituisce anche questa. Il costo è una lettura per scheda — oggi ~550,
  // qualche centesimo al mese su tutte le installazioni — ed è lo stesso che
  // pagava la finestra da 500, ma completo.
  //
  // `maxPages` è un freno contro un ciclo infinito, non un tetto di prodotto:
  // se scatta la risposta lo DICE (`complete: false`) invece di far finta di
  // essere tutto. Chi vuole solo le righe usa `listAllPublic`.
  const ALL_PAGES_MAX = 40;

  async function listAllPublicPaged({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, maxPages = ALL_PAGES_MAX } = {}) {
    const limit = Math.max(1, Math.min(LIST_PAGE_SIZE, Number(pageSize) || LIST_PAGE_SIZE));
    const rows = [];
    const visti = new Set();
    let cursor = '';
    let complete = false;
    for (let page = 0; page < Math.max(1, Number(maxPages) || ALL_PAGES_MAX); page += 1) {
      // Si passa dalla porta ESPOSTA, non dal riferimento interno: chi
      // sostituisce `SN_FEEDBACK.listPublic` (una prova, la bacheca in modalità
      // test) deve sostituire anche questa lettura, o si ritroverebbe la rete
      // vera sotto una pagina che crede finta.
      const porta = (global.SN_FEEDBACK && global.SN_FEEDBACK.listPublic) || listPublic;
      // eslint-disable-next-line no-await-in-loop
      const batch = await porta({ pageSize: limit, timeoutMs, afterName: cursor });
      const arr = Array.isArray(batch) ? batch : [];
      let nuove = 0;
      for (const r of arr) {
        const id = String((r && r._id) || '');
        if (id && visti.has(id)) continue;
        if (id) visti.add(id);
        rows.push(r);
        nuove += 1;
      }
      // Una sorgente che ignora il cursore (una prova che la sostituisce con
      // un array fisso) torna sempre la stessa pagina: se non arriva niente di
      // nuovo si è già in fondo, e continuare sarebbe un ciclo.
      const ultimo = nomeDocumento(VIEW_COLLECTION, arr[arr.length - 1]);
      if (arr.length < limit || nuove === 0 || !ultimo || ultimo === cursor) { complete = true; break; }
      cursor = ultimo;
    }
    return { rows, complete };
  }

  // ── La memoria breve della lettura completa ──────────────────────────────
  //
  // L'annuncio della ricompensa gira a ogni caricamento della home, e la home
  // è la pagina di OGNI SCHEDA NUOVA. Senza memoria, chi ha mandato almeno una
  // segnalazione si riscarica tutte le schede della bacheca ogni volta che apre
  // una scheda: misurato, quattro aperture costavano 2208 schede in otto
  // richieste, e il numero cresce da solo a ogni fix che esce. La risposta che
  // serve («c'è un mio fix appena uscito?») cambia una volta ogni mai.
  //
  // Trenta secondi sono gli stessi che si dà chi gestisce i feedback dal lato
  // suo: era l'asimmetria da chiudere, due cammini uguali di cui uno solo
  // ricordava.
  //
  // La memoria tiene anche il riferimento della PORTA da cui è stata riempita.
  // Chi la sostituisce (una prova, la bacheca in modalità test) mette una
  // funzione nuova, quindi la memoria non combacia più e si rilegge: una prova
  // non si ritrova mai davanti le schede della scena precedente. E si ricorda
  // solo una lettura COMPLETA: memorizzare un troncamento vorrebbe dire
  // ripeterlo per mezzo minuto.
  const ALL_CACHE_TTL_MS = 30_000;
  let allCache = { at: 0, rows: null, porta: null };

  async function listAllPublic(opts = {}) {
    const porta = (global.SN_FEEDBACK && global.SN_FEEDBACK.listPublic) || listPublic;
    const fresca = !!(opts && opts.fresh);
    if (!fresca && allCache.rows && allCache.porta === porta
        && (Date.now() - allCache.at) < ALL_CACHE_TTL_MS) {
      return allCache.rows;
    }
    const { rows, complete } = await listAllPublicPaged(opts);
    allCache = complete ? { at: Date.now(), rows, porta } : { at: 0, rows: null, porta: null };
    return rows;
  }

  /** Butta via la memoria breve: dopo aver scritto o tolto una scheda. */
  function forgetAllPublic() { allCache = { at: 0, rows: null, porta: null }; }

  // Il nome intero del documento, quello che Firestore vuole come cursore.
  function nomeDocumento(collectionId, row) {
    const id = String((row && row._id) || '');
    if (!id) return '';
    return `${FIRESTORE_BASE.replace(/^https:\/\/firestore\.googleapis\.com\/v1\//, '')}/${collectionId}/${id}`;
  }

  // Una pagina ordinata per nome del documento, con cursore. È il mattone
  // delle letture complete: l'ordine è quello degli id, che a chi mostra le
  // righe non serve — ordina lui come gli pare. `idToken` serve per la
  // collezione vera, che senza credenziali non si legge (#583); la vista
  // pubblica lo lascia vuoto.
  async function listByNameDirect(collectionId, { pageSize = LIST_PAGE_SIZE, timeoutMs = 0, afterName = '', idToken = '' } = {}) {
    const endpoint = `${FIRESTORE_BASE}:runQuery?key=${API_KEY}`;
    const structuredQuery = {
      from: [{ collectionId }],
      orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
      limit: pageSize,
    };
    if (afterName) {
      structuredQuery.startAt = { before: false, values: [{ referenceValue: afterName }] };
    }
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const opts = { method: 'POST', headers, body: JSON.stringify({ structuredQuery }) };
    let timer = null;
    let timedOut = false;
    if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
      const controller = new AbortController();
      opts.signal = controller.signal;
      timer = setTimeout(() => { timedOut = true; try { controller.abort(); } catch (_) {} }, timeoutMs);
    }
    let res;
    try {
      res = await fetch(endpoint, opts);
    } catch (e) {
      if (timedOut) throw new Error('firestore list: timeout di rete');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore list fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    const arr = await res.json();
    const rows = [];
    let lastName = '';
    for (const row of arr) {
      if (!row.document) continue;
      lastName = row.document.name || lastName;
      rows.push(fsDocToObject(row.document));
    }
    return { rows, lastName };
  }

  // UNA scheda pubblica (per id). Torna null se non c'è: un feedback che non è
  // in bacheca semplicemente non ha scheda.
  async function getPublic(id, { idToken = '' } = {}) {
    const key = String(id || '');
    if (!key) return null;
    const url = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(key)}?key=${API_KEY}`;
    const headers = idToken ? { Authorization: `Bearer ${idToken}` } : undefined;
    const res = await fetch(url, headers ? { headers } : undefined);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`firestore vista pubblica fallita (${res.status})`);
    return fsDocToObject(await res.json());
  }

  // Scrive (o aggiorna) la scheda pubblica di un feedback. La maschera elenca
  // SOLO i campi della scheda: `votes` e `reopenRequests` li scrivono gli
  // utenti e non devono essere cancellati da una ripubblicazione.
  // Serve il token dell'owner (o del server): le regole non ammettono altri.
  async function publishPublicCard(id, card, opts = {}) {
    const key = String(id || '');
    if (!key) throw new Error('id mancante');
    const V = global.SN_FEEDBACK_PUBLIC_VIEW;
    const names = (V && V.CARD_FIELDS) ? V.CARD_FIELDS : Object.keys(card || {});
    const fields = {};
    const mask = [];
    for (const f of names) {
      if (f === 'publishedAt') continue;
      const v = (card || {})[f];
      fields[f] = toFsValue(v === undefined ? '' : v);
      mask.push(f);
    }
    fields.publishedAt = toFsValue(new Date().toISOString());
    mask.push('publishedAt');
    // I voti e le riaperture li scrivono gli UTENTI, quindi di norma non
    // entrano nella maschera: una ripubblicazione li cancellerebbe. L'unica
    // volta che ci entrano è il travaso dal documento alla scheda (#583,
    // SN_FEEDBACK_PUBLIC_VIEW.carryUserFields), e in quel caso il valore che
    // arriva qui ha già dentro anche quello che c'era sulla scheda.
    const userFields = (V && V.USER_FIELDS) ? V.USER_FIELDS : ['votes', 'reopenRequests'];
    for (const f of userFields) {
      const v = (card || {})[f];
      if (!v || typeof v !== 'object') continue;
      fields[f] = toFsValue(v);
      mask.push(f);
    }
    const qs = mask.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&');
    const url = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(key)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ fields }) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore pubblicazione scheda fallita (${res.status}): ${t.slice(0, 300)}`);
    }
    return true;
  }

  // Toglie la scheda pubblica: un fix riaperto o riclassificato esce dalla
  // bacheca perché la sua scheda non c'è più, non perché la pagina la nasconde.
  async function unpublishPublicCard(id, opts = {}) {
    const key = String(id || '');
    if (!key) throw new Error('id mancante');
    const url = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(key)}?key=${API_KEY}`;
    const headers = {};
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const res = await fetch(url, { method: 'DELETE', headers });
    // 404 = già tolta: l'esito voluto è lo stesso.
    if (!res.ok && res.status !== 404) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore rimozione scheda fallita (${res.status}): ${t.slice(0, 300)}`);
    }
    return true;
  }

  // Aggiorna stato/note di un feedback esistente. status ∈ new|todo|done|verified|ignored.
  // opts.idToken (Firebase ID token) viene allegato come Bearer: serve perché le
  // Firestore rules verifichino che l'utente è un admin. Senza token la scrittura
  // riuscirà solo se le regole consentono l'accesso anonimo (sconsigliato).
  async function updateStatus(id, { status, notes, userNote, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride, mergePreapproved }, opts = {}) {
    if (!id) throw new Error('id mancante');
    const idToken = opts.idToken;
    const fields = {};
    const mask = [];
    if (status !== undefined) {
      // S1.F2.1: cifra status fine se il gate è on; scrivi SEMPRE statusPublic in chiaro.
      const { fineStatus, publicStatus } = await encryptStatus(status);
      fields.status = toFsValue(fineStatus);
      mask.push('status');
      fields.statusPublic = toFsValue(publicStatus);
      mask.push('statusPublic');
    }
    // I DUE TESTI (spec ROUTINE-AUTH-SPEC.md §8). `notes` è la conversazione
    // della lavorazione — il report per l'OWNER — e viaggia CIFRATO: il
    // documento è a lettura pubblica, e quel testo prima o poi racconta come è
    // stato chiuso un fix di sicurezza, cioè cosa non funzionava, prima che la
    // correzione arrivi sui computer degli utenti.
    //
    // Fino a qui non si poteva cifrare per un motivo solo: era anche il testo
    // che l'utente leggeva nel popup delle ricompense, sulla sua macchina, che
    // la chiave non ce l'ha. Ora quella è una frase a parte (`userNote`), in
    // chiaro, e il report può essere protetto.
    //
    // La conversazione ha un tetto (SN_FEEDBACK_THREAD.capNotes): oltre quello
    // le regole respingono OGNI scrittura successiva sul feedback, non solo
    // quella sulle note — il feedback resterebbe immobile. Tagliamo i turni più
    // vecchi qui, PRIMA di cifrare, così il caso non si presenta mai.
    if (notes !== undefined) {
      const T = global.SN_FEEDBACK_THREAD;
      const capped = T && T.capNotes ? T.capNotes(notes) : notes;
      const C = global.SN_FEEDBACK_CRYPTO;
      let value = capped;
      if (capped && !(C && C.isEncrypted && C.isEncrypted(capped))) {
        // Se la cifratura non riesce NON si scrive il report in chiaro. E non
        // si tace nemmeno: fino al #602 il campo veniva lasciato cadere in
        // silenzio, cioè chi aveva appena scritto il report vedeva la scheda
        // salvarsi e il testo sparire senza una parola. L'errore risale e la
        // dashboard lo mostra; niente di questa scrittura parte.
        value = await maybeEncrypt(capped);
      }
      if (value !== undefined) { fields.notes = toFsValue(value); mask.push('notes'); }
    }
    // La frase per chi ha mandato il feedback: in chiaro per forza (la legge
    // senza chiave) e corta per costruzione.
    //
    // Il tetto e' in CARATTERI, e combacia con quello delle regole: provato dal
    // vivo su un documento-cavia — 500 lettere accentate (1000 byte) passano,
    // 501 lettere ASCII no. Diverso dal tetto della conversazione, che invece e'
    // in byte perche' li' quello che finisce sul documento e' il testo CIFRATO.
    if (userNote !== undefined) {
      // Il taglio degli spazi si fa QUI, alla consegna, e non mentre l'owner
      // scrive: riscrivere la casella sotto le dita gli mangia lo spazio appena
      // battuto e gli incolla insieme due parole.
      fields.userNote = toFsValue(String(userNote || '').trim().slice(0, 500)); mask.push('userNote');
    }
    // Override di revisione (owner sblocca un feedback fermato dalla sicurezza).
    // #476 — LA REVISIONE DELL'OWNER VIAGGIA TUTTA CIFRATA.
    //
    // Questi tre campi li scrive solo la dashboard dell'owner, quando sblocca o
    // CONFERMA un feedback fermato dalla sicurezza. Le letture della collezione
    // sono pubbliche, quindi in chiaro erano un annuncio a chi aveva mandato
    // quel feedback:
    //   · `reviewComment` diceva il PERCHÉ era stato beccato — il manuale per
    //     riprovare meglio;
    //   · `reviewDecision` diceva l'esito con una parola sola ('rejected');
    //   · e persino la SOLA PRESENZA di `reviewedAt` bastava: un feedback
    //     normale non ce l'ha, quindi vederlo significa "sei passato dalle mani
    //     dell'owner", cioè sei stato fermato.
    // Non basta cifrarne uno: l'attaccante gli bastava il campo rimasto. Vanno
    // insieme, o non serve a niente.
    //
    // Li rilegge solo chi ha la chiave: la dashboard (che li decifra prima di
    // mostrarli) e il backend di sicurezza, che su `reviewDecision === 'accepted'`
    // sa di non dover ri-bloccare un feedback che l'owner ha sbloccato a mano —
    // per questo la sua lista di campi da decifrare li comprende.
    // Retrocompat: i valori vecchi in chiaro continuano a leggersi.
    if (reviewDecision !== undefined) {
      fields.reviewDecision = toFsValue(await maybeEncrypt(reviewDecision));
      mask.push('reviewDecision');
    }
    if (reviewComment !== undefined) {
      fields.reviewComment = toFsValue(await maybeEncrypt(reviewComment));
      mask.push('reviewComment');
    }
    if (reviewedAt !== undefined) {
      fields.reviewedAt = toFsValue(await maybeEncrypt(reviewedAt));
      mask.push('reviewedAt');
    }
    // Preferito ⭐ (DB2): bool, "parcheggio per il futuro". Le Firestore rules
    // accettano `starred` (is bool) nel ramo update admin.
    if (starred !== undefined) { fields.starred = { booleanValue: !!starred }; mask.push('starred'); }
    // Override owner per l'auto-archiviazione a punteggio (DC3, vedi
    // boardArchive.js): 'archived' | 'keep_open' | '' (nessun override).
    if (archiveOverride !== undefined) { fields.archiveOverride = toFsValue(archiveOverride); mask.push('archiveOverride'); }
    // La pre-approvazione della fusione, per QUESTA pratica: `{ by, at }` per
    // metterla, `null` per toglierla. Togliere è CANCELLARE il campo: la maschera
    // lo nomina e i campi non lo portano, che per Firestore vuol dire "via".
    // Un `null` scritto come valore resterebbe sul documento e le regole lo
    // respingerebbero (vogliono una mappa, quando c'è).
    if (mergePreapproved !== undefined) {
      if (mergePreapproved && typeof mergePreapproved === 'object') {
        fields.mergePreapproved = toFsValue({
          by: String(mergePreapproved.by || '').slice(0, 120),
          at: String(mergePreapproved.at || new Date().toISOString()).slice(0, 40),
        });
      }
      mask.push('mergePreapproved');
    }
    if (priority !== undefined) {
      // Priorità 1-3 (0 = nessuna). Clamp PRIMA di cifrare.
      const p = Math.max(0, Math.min(3, Math.round(Number(priority) || 0)));
      // S1.priority: `priority` va scritto come stringValue (ciphertext FENC1:).
      // #602 — niente più ripiego su `integerValue` in chiaro quando la
      // cifratura non riesce: la priorità dice quanto ci tiene chi lavora un
      // feedback, e su un documento pubblico in chiaro è un'informazione
      // regalata. Se non si può cifrare la scrittura si ferma qui.
      fields.priority = { stringValue: await maybeEncrypt(String(p)) };
      mask.push('priority');
    }
    // priorityManual: flag booleano, non cifrato (indica che l'owner ha fissato
    // la priorità a mano — il backend di sicurezza lo usa per saltare l'override
    // automatico). Scritto solo quando esplicitamente passato `true`.
    if (priorityManual === true) {
      fields.priorityManual = { booleanValue: true };
      mask.push('priorityManual');
    }
    if (status === 'done') {
      fields.resolvedAt = { timestampValue: new Date().toISOString() };
      mask.push('resolvedAt');
    }
    if (status === 'verified') {
      fields.verifiedAt = { timestampValue: new Date().toISOString() };
      mask.push('verifiedAt');
    }
    const qs = mask.map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&');
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`firestore update fallito (${res.status}): ${errText.slice(0, 300)}`);
    }
    return true;
  }

  // ---- voti di verifica (DB4) ----
  // Substrato dei voti "funziona / non funziona" che la board utente (DC*) e
  // l'archiviazione automatica a punteggio (DC3) leggono. I voti vivono in un
  // campo `votes` (map): chiave = uid del votante, valore = { vote, at,
  // credibilitySnapshot }. Un voto per utente, cambiabile.
  // Le Firestore rules vincolano ogni utente a scrivere SOLO la propria chiave.
  //
  // #583: stanno sulla SCHEDA PUBBLICA (`feedback-public/{id}`), non più sul
  // documento feedback. È lì che la bacheca li legge — il documento vero, da
  // quando non è più pubblico, chi vota non lo può nemmeno aprire — e tenerli in
  // due posti avrebbe voluto dire due copie che divergono. Chi fa i conti dal
  // lato dell'owner (archiviazione a punteggio) li riceve dal main, che unisce
  // la scheda al documento quando lo legge. I voti storici già scritti sul
  // documento restano leggibili da lì.
  const VOTE_WORKS = 'works';
  const VOTE_BROKEN = 'broken';
  const VOTE_VALUES = [VOTE_WORKS, VOTE_BROKEN];

  // Credibilità di default di un votante: 1 "per ora" (DC3 — il substrato
  // credibilità per-utente arriva con DC5; finché non c'è, ogni voto pesa 1).
  function normalizeCredibility(v) {
    const c = Number(v);
    return Number.isFinite(c) && c >= 0 ? c : 1;
  }

  // PURA: ripulisce un map di voti grezzo (es. da fsDocToObject) tenendo solo le
  // entry ben formate. Scarta voti con `vote` non valido o entry non-oggetto;
  // normalizza `at` (stringa) e `credibilitySnapshot` (numero ≥ 0, default 1).
  function normalizeVotes(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [uid, v] of Object.entries(raw)) {
      if (!uid || !v || typeof v !== 'object') continue;
      if (v.vote !== VOTE_WORKS && v.vote !== VOTE_BROKEN) continue;
      out[uid] = {
        vote: v.vote,
        at: typeof v.at === 'string' ? v.at : '',
        credibilitySnapshot: normalizeCredibility(v.credibilitySnapshot),
      };
    }
    return out;
  }

  // PURA: conteggi e punteggio derivati dai voti. score = Σ credibilità("works")
  // − Σ credibilità("broken") (DC3). total = numero di votanti validi.
  function tallyVotes(raw) {
    const votes = normalizeVotes(raw);
    let works = 0;
    let broken = 0;
    let score = 0;
    for (const v of Object.values(votes)) {
      if (v.vote === VOTE_WORKS) { works += 1; score += v.credibilitySnapshot; }
      else { broken += 1; score -= v.credibilitySnapshot; }
    }
    return { works, broken, total: works + broken, score };
  }

  // PURA: il voto corrente di un utente ('works' | 'broken' | null).
  function userVote(raw, uid) {
    if (!uid) return null;
    const votes = normalizeVotes(raw);
    return votes[uid] ? votes[uid].vote : null;
  }

  // RETE: l'utente loggato esprime/cambia il proprio voto su un feedback.
  // Scrive solo `votes.<uid>` (updateMask mirato → non tocca altri voti né altri
  // campi). `opts.idToken` = Firebase ID token del votante (le rules verificano
  // chiave==uid). Ritorna l'entry scritta.
  async function castVote(id, { uid, vote, credibilitySnapshot } = {}, opts = {}) {
    if (!id) throw new Error('id mancante');
    if (!uid) throw new Error('uid mancante');
    if (vote !== VOTE_WORKS && vote !== VOTE_BROKEN) {
      throw new Error("vote dev'essere 'works' o 'broken'");
    }
    const entry = {
      vote,
      at: new Date().toISOString(),
      credibilitySnapshot: normalizeCredibility(credibilitySnapshot),
    };
    const fieldPath = `votes.\`${uid}\``;
    const qs = `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`;
    const endpoint = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const body = { fields: { votes: { mapValue: { fields: { [uid]: toFsValue(entry) } } } } };
    const res = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore castVote fallito (${res.status}): ${t.slice(0, 300)}`);
    }
    return entry;
  }

  // RETE: l'utente ritira il proprio voto (cancella `votes.<uid>`). updateMask
  // sul field path SENZA includerlo nel body → Firestore elimina solo quella
  // chiave, lasciando intatti i voti altrui.
  async function clearVote(id, uid, opts = {}) {
    if (!id) throw new Error('id mancante');
    if (!uid) throw new Error('uid mancante');
    const fieldPath = `votes.\`${uid}\``;
    const qs = `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`;
    const endpoint = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const res = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ fields: {} }) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore clearVote fallito (${res.status}): ${t.slice(0, 300)}`);
    }
    return true;
  }

  // ---- riapertura a pagamento (DC4) ----
  // RETE: marca SUL FEEDBACK ORIGINALE che l'uid ha chiesto la riapertura.
  // Scrive solo `reopenRequests.<uid>` (updateMask mirato, stesso pattern non-
  // admin di castVote): un utente normale NON può toccare `status` di un doc
  // che non ha creato (ramo admin delle regole, vedi firestore.rules) — flippare
  // l'originale fuori da "Risolti" resta al percorso fidato (routine/owner) che
  // legge questo campo. Qui scriviamo solo il SEGNALE + (nel chiamante) creiamo
  // il feedback collegato: è la parte che un utente può fare da solo.
  async function castReopenRequest(id, uid, opts = {}) {
    if (!id) throw new Error('id mancante');
    if (!uid) throw new Error('uid mancante');
    const entry = { at: new Date().toISOString() };
    const fieldPath = `reopenRequests.\`${uid}\``;
    const qs = `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`;
    const endpoint = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    const body = { fields: { reopenRequests: { mapValue: { fields: { [uid]: toFsValue(entry) } } } } };
    const res = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore castReopenRequest fallito (${res.status}): ${t.slice(0, 300)}`);
    }
    return entry;
  }

  // RETE: toglie la PROPRIA richiesta di riapertura (cancella
  // `reopenRequests.<uid>`), stessa forma di `clearVote`.
  //
  // Serve quando la riapertura non arriva in fondo. Il segnale si scrive PRIMA
  // di creare il feedback collegato, ed è lui a chiudere la porta ai duplicati;
  // ma se il feedback non è nato, di duplicati non ce n'è nessuno da temere, e
  // quel segnale rimasto lì dice a chi ha provato a riaprire che il fix è «già
  // stato segnalato»: la spiegazione appena scritta non ha più dove andare, e
  // non c'è modo di rimandarla. Toglierlo rimette la porta com'era.
  async function clearReopenRequest(id, uid, opts = {}) {
    if (!id) throw new Error('id mancante');
    if (!uid) throw new Error('uid mancante');
    const fieldPath = `reopenRequests.\`${uid}\``;
    const qs = `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`;
    const endpoint = `${FIRESTORE_BASE}/${VIEW_COLLECTION}/${encodeURIComponent(id)}?${qs}&key=${API_KEY}`;
    const headers = { 'Content-Type': 'application/json' };
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
    // Nessun valore per quel campo nel corpo: con la maschera d'aggiornamento è
    // così che Firestore lo cancella. Le regole lo prevedono — un utente tocca
    // solo la propria chiave, e la propria chiave può anche non esserci più.
    const res = await fetch(endpoint, { method: 'PATCH', headers, body: JSON.stringify({ fields: {} }) });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`firestore clearReopenRequest fallito (${res.status}): ${t.slice(0, 300)}`);
    }
    return true;
  }

  global.SN_FEEDBACK = {
    submit,
    list,
    // I chiusi più di recente: è così che una segnalazione vecchia chiusa oggi
    // arriva in bacheca, senza allargare il caricamento per data d'invio.
    listResolved,
    // TUTTE le segnalazioni, paginate fino in fondo. Serve a chi fa una
    // domanda sull'INSIEME (chi va archiviato?), non a chi guarda gli ultimi
    // arrivati: per quelli `list` va bene ed è una lettura sola.
    listAll,
    listAllPaged,
    listVersions,
    getMany,
    // #583 — la vista pubblica: l'unica lettura dei feedback che non chiede
    // credenziali. Ci sono dentro i soli campi pubblici dei feedback chiusi.
    listPublic,
    // TUTTE le schede, paginate fino in fondo: è la risposta a «mi spetta una
    // ricompensa?», «quali schede vanno tolte?» e «cosa mostra la bacheca?»,
    // che sull'asse della data d'invio non si possono chiedere.
    listAllPublic,
    listAllPublicPaged,
    // La memoria breve di `listAllPublic` si butta via da qui, dopo aver
    // scritto o tolto una scheda.
    forgetAllPublic,
    getPublic,
    publishPublicCard,
    unpublishPublicCard,
    // Il contatore dei numeri (l'owner lo crea e lo rimette in pari).
    ensureSeqCounter,
    nextSeq,
    maxSeq,
    // Tetto del caricamento e resa onesta dei conteggi che ne derivano (#495).
    LIST_PAGE_SIZE,
    listHitCap,
    countLabel,
    COUNT_CAP_HINT,
    updateStatus,
    // S1.F2.1: mapping status fine → valore pubblico grossolano (in chiaro).
    // Esportata perché owner-feedback.mjs (script .mjs) la riusa per scrivere statusPublic.
    statusToPublic,
    // Voti di verifica (DB4): substrato letto da board (DC*) e archiviazione (DC3).
    castVote,
    clearVote,
    normalizeVotes,
    tallyVotes,
    userVote,
    VOTE_VALUES,
    // Riapertura a pagamento (DC4).
    castReopenRequest,
    clearReopenRequest,
    uploadImage,
    uploadAttachment,
    // #602 — la cifratura degli allegati non ha più un ripiego in chiaro.
    // `encryptionUnavailable()` dice in una frase perché non si può cifrare
    // ('' se si può): il main la chiede PRIMA di accodare un invio, così chi
    // manda si sente dire subito che non è partito niente invece di ricevere
    // un «grazie» e vedere la segnalazione riprovare in eterno nella coda.
    encryptionUnavailable,
    encryptionBlockedMessage,
    isEncryptionError,
    sealForUpload,
    // #582 — il confine degli allegati: la forma del nome (che storage.rules
    // pretende), il riconoscimento di un URL del bucket e le intestazioni con
    // cui l'owner lo scarica. Pure, e usate anche dal main.
    attachmentPath,
    isAttachmentUrl,
    attachmentFetchHeaders,
    // #582 giro 3 — la scritta di un collegamento verso un indirizzo che arriva
    // da fuori: dice dove si va, e lo dice anche quando è tagliata.
    linkLabel,
    LINK_LABEL_MAX,
    formatNum,
    fallbackName,
    // Plumbing REST riutilizzabile (es. dal motore crediti): encoder Value
    // Firestore + endpoint/base. L'API_KEY è la chiave web pubblica Firebase
    // (già nel client), non un segreto.
    toFsValue,
    fromFsValue,
    fsDocToObject,
    rest: { FIRESTORE_BASE, API_KEY, PROJECT_ID, VIEW_COLLECTION },
    configPublic: { projectId: PROJECT_ID, bucket: BUCKET, collection: COLLECTION },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
