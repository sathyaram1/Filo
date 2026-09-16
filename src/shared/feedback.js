// Client Firebase REST per i feedback alpha: niente SDK, solo fetch(), così funziona sia nei content script sia nelle pagine dell'estensione.

(function (global) {
  'use strict';

  const PROJECT_ID = 'filo-8b9cb';
  const BUCKET = 'filo-8b9cb.firebasestorage.app';
  const API_KEY = 'AIzaSyDN_fpshLW_K78QLV0MMiX1gd-OfO7x-CY';
  const COLLECTION = 'feedback';
  // #583: la vista pubblica (un documento per feedback, stesso id, solo i campi sicuri) e il contatore dei numeri. La collezione vera non si legge più senza credenziali — firestore.rules e feedbackPublicView.js.
  const VIEW_COLLECTION = 'feedback-public';
  const COUNTERS_COLLECTION = 'counters';
  const SEQ_COUNTER = 'feedbackSeq';

  const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const STORAGE_BASE = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o`;

  // L'uuid non serve solo a evitare collisioni di nome: da #582 è ANCHE il segreto del percorso di un allegato, perché storage.rules concede la creazione solo su un nome che lo contiene e mai la sovrascrittura.
  // Quindi i bit vengono dal generatore crittografico quando c'è; `Math.random()` è l'ultima spiaggia per non rompere ambienti senza `crypto`, mai la prima.
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

  // FONTE UNICA della forma del nome di un allegato: storage.rules concede la creazione SOLO su un nome fatto così, e una sentinella confronta quello che esce di qui con l'espressione scritta nelle regole. Cambiarla qui senza cambiarla là vuol dire che dal deploy nessun allegato si carica più.
  // Forma: feedback/<etichetta_>?<millisecondi>_<uuid>.<estensione>. L'etichetta dice la provenienza, i millisecondi si leggono a occhio, l'uuid è la parte che non si indovina.
  function attachmentPath(mimeOrExt, label) {
    const raw = String(mimeOrExt || '');
    const ext = (raw.includes('/') ? raw.split('/')[1] : raw).replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'bin';
    const et = String(label || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 16);
    return `${COLLECTION}/${et ? `${et}_` : ''}${Date.now()}_${uuid()}.${ext}`;
  }

  // I due modi di nominare un oggetto del bucket — percorso REST di Firebase e percorso diretto di Google Storage — mappati a host → inizi ammessi, NOME DEL DEPOSITO compreso.
  // I nomi del deposito sono due e sono lo stesso deposito: l'attuale e quello storico in `appspot.com`, che gli allegati più vecchi hanno ancora dentro il proprio indirizzo. Col solo nome attuale un allegato del 2025 non sarebbe più riconosciuto come roba di Filo e la dashboard smetterebbe di aprirlo.
  const DEPOSITI = [BUCKET, `${PROJECT_ID}.appspot.com`];
  // Tabella SENZA eredità (`Object.create(null)`), e non è un vezzo: la chiave è il nome di dominio scritto da chi manda la segnalazione. Una tabella normale contiene già `__proto__`, `constructor`, `toString`, e chiedendo quelli tornava roba che non è un elenco di inizi: il `.some()` esplodeva invece di rispondere «no» (#582).
  // Cadeva dal lato chiuso, quindi non era una porta aperta; ma una domanda di sicurezza deve RISPONDERE.
  const PREFISSI_ALLEGATO = Object.assign(Object.create(null), {
    'firebasestorage.googleapis.com': DEPOSITI.map((b) => `/v0/b/${b}/o/`),
    'storage.googleapis.com': DEPOSITI.map((b) => `/${b}/`),
  });

  // Un URL è un allegato del bucket dei feedback? PURA, e serve a due cose che devono dare la stessa risposta: il guard anti-SSRF del main e la decisione di allegare o no il token dell'owner alla richiesta.
  // Il confronto è sul BUCKET, non sull'host. Fermarsi all'host bastava finché serviva solo a non fare fetch arbitrarie, ma da quando decide anche se firmare con l'identità dell'owner è una porta aperta: l'indirizzo dell'allegato sta dentro il documento del feedback, e un feedback lo crea chiunque, anche senza account — bastava indicare un bucket qualsiasi ospitato da Google e la dashboard ci portava il token.
  // L'URL si PARSA, non si confronta a regex: `new URL` normalizza i casi in cui una regex si fa fregare (host in maiuscolo, `@`, `..`), e un indirizzo che non si parsa vale «no».
  function isAttachmentUrl(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (_) { return false; }
    if (u.protocol !== 'https:') return false;
    const prefissi = PREFISSI_ALLEGATO[u.hostname];
    // `Array.isArray` e non `!!`: se un giorno la tabella tornasse un oggetto normale, qui si continua a rispondere «no» invece di esplodere su una domanda che decide se firmare col gettone dell'owner.
    return Array.isArray(prefissi) && prefissi.some((p) => u.pathname.startsWith(p));
  }

  // Dal #583 la lettura del deposito è negata dalle regole a CHIUNQUE, owner compreso: quello che apre un allegato è il download token dentro l'URL, valutato prima delle regole. Questo Bearer non apre più niente da solo, e resta perché se un domani le regole tornassero a riconoscere un'identità la richiesta sia già firmata nel modo giusto.
  // La regola che conta è DOVE va: il token dell'owner esce SOLO verso il deposito di Filo, e `isAttachmentUrl` lo confronta per intero parsando l'URL. Su qualunque altro indirizzo queste intestazioni sono vuote.
  function attachmentFetchHeaders(url, idToken) {
    const t = String(idToken || '');
    if (!t || !isAttachmentUrl(url)) return {};
    return { Authorization: `Bearer ${t}` };
  }

  // Etichetta con cui si MOSTRA un indirizzo che arriva da fuori. PURA. Un indirizzo dentro una segnalazione lo scrive chi manda, e manda chiunque: quando diventa qualcosa su cui si clicca, la scritta deve dire dove si va, o è un'esca dentro una pagina di Filo.
  // La vecchia scritta mostrava i primi 80 caratteri tagliati senza nemmeno un puntino, e chi li costruisce apposta sceglie cosa ci cade dentro: `https://filo.app/guida/…@sito-estraneo.invalid/accedi` si leggeva come un indirizzo di Filo.
  // Tre regole, in ordine: la parte prima della chiocciola non si mostra mai, è lì solo per mentire; l'host non si taglia MAI dalla coda, perché la coda è il posto vero — se non entra si taglia da DAVANTI, col puntino all'inizio; un indirizzo tagliato lo dice con un carattere di troncamento.
  // Fuori si passa l'indirizzo già normalizzato da `new URL`, così etichetta e destinazione parlano dello stesso indirizzo. Se non si parsa torna stringa vuota, e chi chiama mostrerà l'indirizzo crudo, che però non è un collegamento.
  const LINK_LABEL_MAX = 80;
  function linkLabel(rawUrl, max) {
    const limite = Number.isFinite(max) && max >= 8 ? Math.floor(max) : LINK_LABEL_MAX;
    let u;
    try { u = new URL(String(rawUrl || '')); } catch (_) { return ''; }
    // Solo indirizzi che portano su un sito: `javascript:alert(1)` si parsa benissimo, ha host vuoto, e l'etichetta diventerebbe `alert(1)` — una scritta che non dice dove si va, cioè quello che questa funzione esiste per evitare.
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
    const host = u.host; // host = dominio + porta, senza credenziali davanti
    const resto = `${u.pathname}${u.search}${u.hash}`;
    if (host.length >= limite) return `…${host.slice(host.length - (limite - 1))}`;
    if (host.length + resto.length <= limite) return `${host}${resto}`;
    return `${host}${resto.slice(0, limite - host.length - 1)}…`;
  }

  // Anti-duplicati (#370): id documento STABILE per una composizione di feedback. Con un submissionId il documento nasce con quell'id, e un secondo invio uguale (un tentativo andato in timeout lato UI ma riuscito sul server, poi ripetuto) viene rifiutato dal server invece di creare un duplicato.
  // Si ripulisce ai caratteri ammessi da Firestore e si scartano i pattern vietati: in quei casi torna '' e si ricade sull'id auto-generato, senza idempotenza.
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

  // L'upload è una CREAZIONE e basta: dal #582 le regole non concedono la sovrascrittura, quindi un nome già esistente torna 403 invece di calpestare l'allegato di qualcun altro.
  // L'URL che torna porta il download token: da quando la lettura del bucket è riservata all'owner, quel token È il permesso di leggere l'allegato — va trattato come il contenuto, non come un indirizzo qualunque.
  async function uploadImage(blob) {
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
    // Il token di scarico è la CHIAVE dell'allegato, non un ornamento del link (#583): da quando le regole negano il `get`, un indirizzo senza token non apre più niente, nemmeno al main dell'owner.
    // Prima il link si costruiva lo stesso e funzionava perché il file era aperto a chiunque; adesso sarebbe un allegato perso in silenzio, scoperto settimane dopo da chi apre il feedback e trova un buco. Meglio dirlo subito: chi invia ritrova il nome fra quelli non caricati e può riprovare.
    if (!token) {
      throw new Error('il deposito non ha rilasciato il codice di scarico: '
        + "senza, l'allegato non sarebbe più leggibile da nessuno.");
    }
    const publicUrl = `${STORAGE_BASE}/${encodeURIComponent(name)}?alt=media&token=${token}`;
    return { url: publicUrl, name };
  }

  // S1.F2.1 — mapping status fine → pubblico. Tre valori: 'open' (in lavorazione OPPURE bloccato: i due collassano per non regalare hill-climbing), 'closed' (risolto o archiviato), 'pending-approval' (riservato al futuro).
  // `blocked` DEVE mappare su 'open': su 'closed' o su un valore distinto, chi legge Firestore senza chiave riconoscerebbe un attacco beccato.
  // Gli stati CANONICI stanno in SN_FB_STATUS.PUBLIC_MAP; qui resta solo il mapping dei LEGACY ritirati, per i documenti storici non migrati. Non duplicarlo altrove.
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
  * Mappa uno status fine al valore pubblico grossolano, da un unico posto per tutti i percorsi di scrittura. Lookup pigra su SN_FB_STATUS così i due file non impongono un ordine di caricamento; il ripiego legacy copre gli stati ritirati.
  */
  function statusToPublic(fineStatus) {
    const FS = global.SN_FB_STATUS;
    if (FS && FS.PUBLIC_MAP[fineStatus]) return FS.PUBLIC_MAP[fineStatus];
    return STATUS_PUBLIC_MAP[fineStatus] || 'open'; // default safe: unknown → 'open'
  }

  // Cifra un campo testo se la chiave pubblica c'è; altrimenti lo lascia invariato — niente crash, scrittura in chiaro come prima.
  async function maybeEncrypt(value) {
    if (value == null || value === '') return value;
    const C = global.SN_FEEDBACK_CRYPTO;
    if (!C || !C.isEnabled()) return value; // dormiente finché il cutover non accende SN_FEEDBACK_ENC_ENABLED
    try { return await C.encryptForOwner(String(value)); }
    catch (e) { console.warn('[SN feedback] cifratura testo fallita:', e?.message || e); return value; }
  }

  // S1.F2.1: cifra `status` quando il gate è acceso. `statusPublic` si calcola PRIMA e si scrive sempre in chiaro accanto, perché i lettori senza chiave privata (C5, bacheca) usano quello.
  async function encryptStatus(status) {
    const publicStatus = statusToPublic(status);
    // #476: si cifra a LUNGHEZZA FISSA. La cifratura non imbottisce, quindi senza questo contare i caratteri del campo cifrato equivale a leggerlo: dal database pubblico si pescavano i feedback beccati misurando il campo, senza chiave e senza login.
    const FS = global.SN_FB_STATUS;
    const daCifrare = FS && FS.padForCipher ? FS.padForCipher(status) : status;
    const fineStatus = await maybeEncrypt(daCifrare); // cifra solo se isEnabled()
    return { fineStatus, publicStatus };
  }

  // Il contenuto diventa opaco (application/octet-stream). Senza pubkey torna il blob originale.
  async function maybeEncryptBlob(blob) {
    const C = global.SN_FEEDBACK_CRYPTO;
    if (!C || !C.isEnabled()) return blob; // dormiente finché il cutover non accende SN_FEEDBACK_ENC_ENABLED
    try {
      const ab = await blob.arrayBuffer();
      const plain = new Uint8Array(ab);
      const sealed = await C.encryptBytesForOwner(plain);
      return new Blob([sealed], { type: 'application/octet-stream' });
    } catch (e) {
      console.warn('[SN feedback] cifratura bytes fallita:', e?.message || e);
      return blob;
    }
  }

  // Allegati ai COMMENTI dei feedback (#190.3). Su feedback/* chiunque può CREARE un allegato nuovo senza login, ma nessuno può sovrascriverne uno: niente token da passare di qui.
  async function uploadAttachment(blob, name) {
    const u = await uploadImage(blob); // upload generico (usa blob.type)
    const type = (blob && blob.type) || '';
    const kind = type.startsWith('image/') ? 'img' : 'file';
    return {
      kind,
      url: u.url,
      name: String(name || (kind === 'img' ? 'immagine' : 'allegato')),
      type,
    };
  }

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

  // Chi legge la collezione vera (#583): le regole ammettono solo l'owner e il server. L'ID token dell'owner vive nel main e non deve mai arrivare in una pagina, quindi da una pagina filo:// la lettura si CHIEDE al main, che la esegue col token e torna le righe già decodificate; nel main e negli script la fetch è diretta.
  // Solo `window.filo`, il ponte delle pagine interne: un content script ha `chrome.runtime.sendMessage` ma di feedback non ne legge, e il canale del main rifiuta comunque le origini che non sono filo://.
  function pageBridge() {
    const w = (typeof window !== 'undefined') ? window : null;
    if (w && w.filo && typeof w.filo.message === 'function') return (m) => w.filo.message(m);
    return null;
  }

  async function readViaMain(bridge, payload) {
    // Il vocabolario dei messaggi non è caricato: questo modulo gira anche fuori dalle pagine.
    const r = await bridge({ type: 'feedback_fetch', ...payload });
    if (!r || r.ok !== true) {
      const code = r && r.code;
      if (code === 'not_admin' || code === 'forbidden') {
        // Non è un guasto, è un permesso che manca: tradotto in «controlla la connessione» manderebbe a guardare la cosa sbagliata, e riprovare non servirebbe.
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
    // Ultima scrittura sul documento, messa da Firestore: è il segno con cui la dashboard riconosce a ogni giro quali feedback sono cambiati senza rileggerli tutti.
    out._updateTime = doc.updateTime || null;
    return out;
  }

  // Ogni feedback ha un numero leggibile, `seq`. Il campo `subSeq` è SOLO STORICO: lo scrivevano le routine quando spezzavano una spec, meccanica abolita col ridisegno.
  // I sub-feedback esistenti restano visibili, quindi formatNum produce ancora anche la forma #N.M.
  function formatNum(seq, subSeq) {
    const s = Number(seq);
    if (!Number.isInteger(s) || s <= 0) return '';
    const sub = Number(subSeq);
    return Number.isInteger(sub) && sub > 0 ? `${s}.${sub}` : String(s);
  }

  // Tronca senza mai spezzare un carattere: `String.slice` lavora su unità UTF-16, e tagliare in mezzo a un'emoji lascia un surrogato solitario che si vede come glifo rotto.
  // Si conta per grafema con Intl.Segmenter quando c'è, così restano insieme anche le emoji composte e i modificatori di tono pelle; ripiego a code point.
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

  // Il numero progressivo (#583). Prima veniva da una query sulla collezione ordinata per `seq`, cioè una LETTURA, e dal 2026-09 la collezione non si legge senza credenziali mentre l'invio resta anonimo per scelta. Adesso viene da un contatore suo: dentro c'è un intero e basta, chiunque può farlo avanzare di uno, nessuno può farlo tornare indietro.
  // Avanzamento con controllo di versione: se due invii partono insieme, il secondo si accorge che il contatore è cambiato sotto e rilegge invece di sovrascrivere. Prima la race DUPLICAVA un numero.
  // Torna `null` invece di lanciare quando il contatore non c'è o la concorrenza non si risolve: il feedback parte senza numero, come già faceva quando la query falliva. A crearlo e rimetterlo in pari è l'app dell'owner.
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
      // 400/409/412: qualcun altro ha scritto nel frattempo, si rilegge e si riprova.
      if (w.status === 400 || w.status === 409 || w.status === 412) continue;
      throw new Error(`firestore nextSeq fallito (${w.status})`);
    }
    return null;
  }

  // Rimette il contatore in pari: lo crea se manca, lo alza se un `seq` più alto è già in giro. Solo owner, serve il token admin.
  // `allowLower` lo riporta GIÙ quando è più alto di qualunque `seq` esistente: farlo avanzare lo può fare chiunque, e senza questa cura un estraneo che lo spinge a diecimila lascerebbe i feedback nuovi con numeri assurdi per sempre. Si passa `true` SOLO col numero più alto VERO in mano (maxSeq): col massimo dei soli feedback caricati si riassegnerebbero numeri già usati.
  // Anche così resta una corsa — un invio fra la nostra lettura e la nostra scrittura assegna un numero che non abbiamo visto — quindi si scende solo se lo scarto è più largo di qualunque corsa realistica: uno o due è gente che sta inviando adesso, cento è un contatore gonfiato. Uno scarto piccolo resta com'è: numeri saltati valgono meno del rischio di stamparne due uguali.
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

  // Invia un feedback. images: { dataUrl }; files: { name, type, dataUrl } per gli allegati non-immagine; massimo una manciata per tipo. `name` è il titolo breve, generato da un LLM nel main prima della chiamata. Ritorna { id, url }.
  // `parentId` (DC4): il feedback nasce COLLEGATO a un altro, per esempio la riapertura di un fix dalla bacheca. Nessuna sub-numerazione automatica — la spezzatura in #seq.subSeq è abolita e i .x sono storico — il collegato ha un numero proprio e `parentId` serve solo a far comparire «collegato a #N» e a far risalire all'originale.
  async function submit({ text, url, title, userAgent, clientId, clientIdHash, images, files, name, parentId, capabilityGapId, submissionId }) {
    // Allegati che NON sono riusciti a caricarsi: tornano al chiamante così la UI avvisa. Prima un upload fallito veniva ingoiato e il feedback partiva senza il file, senza alcun segnale.
    const failed = [];
    const imgs = Array.isArray(images) ? images.slice(0, 5) : [];
    const uploaded = [];
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (!img?.dataUrl) continue;
      const rawBlob = dataUrlToBlob(img.dataUrl);
      // Limite difensivo lato client, misurato sul raw: la cifratura aggiunge una novantina di byte fissi.
      if (rawBlob.size > 4 * 1024 * 1024) {
        failed.push({ name: String(img.name || `immagine ${i + 1}`), reason: 'troppo grande (max 4 MB)' });
        continue;
      }
      try {
        // S1.2: si cifrano i byte prima dell'upload; senza pubkey il blob passa invariato.
        const blobToUpload = await maybeEncryptBlob(rawBlob);
        const u = await uploadImage(blobToUpload);
        uploaded.push(u.url);
      } catch (e) {
        console.warn('[SN feedback] upload immagine fallito:', e);
        failed.push({ name: String(img.name || `immagine ${i + 1}`), reason: 'caricamento non riuscito' });
      }
    }

    // Stesso bucket delle immagini, ma nome e tipo originali si conservano per mostrarli come link scaricabili in dashboard.
    const docs = Array.isArray(files) ? files.slice(0, 5) : [];
    const uploadedFiles = [];
    for (const f of docs) {
      const fname = String(f?.name || 'allegato');
      if (!f?.dataUrl) { failed.push({ name: fname, reason: 'file vuoto' }); continue; }
      const rawBlob = dataUrlToBlob(f.dataUrl);
      if (rawBlob.size > 4 * 1024 * 1024) { failed.push({ name: fname, reason: 'troppo grande (max 4 MB)' }); continue; }
      try {
        // S1.2: cifra anche gli allegati non-immagine.
        const blobToUpload = await maybeEncryptBlob(rawBlob);
        const u = await uploadImage(blobToUpload); // upload generico (usa blob.type)
        uploadedFiles.push({ url: u.url, name: fname, type: String(f.type || rawBlob.type || '') });
      } catch (e) {
        console.warn('[SN feedback] upload file fallito:', e);
        failed.push({ name: fname, reason: 'caricamento non riuscito' });
      }
    }

    // Numero progressivo best-effort: il feedback parte anche se la query fallisce, resterà senza numero invece di bloccare l'invio.
    let seq = null;
    try { seq = await nextSeq(); }
    catch (e) { console.warn('[SN feedback] numerazione non disponibile:', e?.message || e); }

    // S1.2 fase 1: si cifra SOLO il contenuto dell'utente che nessun altro utente deve poter leggere — `text` e `url`, cioè la superficie d'attacco e il contesto di navigazione.
    // NON si cifrano `title`/`name`: li mostra il popup ricompense, che gira sulla macchina di chi ha inviato, SENZA chiave privata. Restano per la fase 2, con proiezione sanitizzata.
    const [encText, encUrl] = await Promise.all([
      maybeEncrypt(text || ''),
      maybeEncrypt(url || ''),
    ]);

    // S1.F2.2: hash deterministico del clientId, calcolato SEMPRE (anche a gate dormiente) per uniformità del match C5. Se il chiamante l'ha già calcolato si riusa il suo.
    let resolvedClientIdHash = (typeof clientIdHash === 'string' && clientIdHash.length === 32) ? clientIdHash : '';
    if (!resolvedClientIdHash) {
      try {
        const H = global.SN_FEEDBACK_CLIENT_ID_HASH;
        if (H && H.hashClientId) {
          resolvedClientIdHash = await H.hashClientId(clientId || '');
        }
      } catch (_) {}
    }

    // S1.F2.2: `clientId` cifrato quando la cifratura è attiva, perché il match passa dall'hash. A gate dormiente resta in chiaro.
    const encClientId = await maybeEncrypt(clientId || '');

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
        // S1.F2.1: statusPublic SEMPRE in chiaro anche con status cifrato. Un feedback nuovo parte da 'new' → 'open'.
        statusPublic: toFsValue('open'),
        createdAt: { timestampValue: new Date().toISOString() },
      },
    };
    if (seq) {
      doc.fields.seq = { integerValue: String(seq) };
      doc.fields.subSeq = { integerValue: '0' };
    }
    if (parentId) {
      doc.fields.parentId = toFsValue(String(parentId));
    }
    // F4: id strutturale del gap di capacità per il dedup F5, solo per gli auto-feedback.
    if (capabilityGapId && String(clientId || '').startsWith('auto:')) {
      doc.fields.capabilityGapId = toFsValue(String(capabilityGapId).slice(0, 100));
    }

    // Idempotenza (#370): col submissionId il documento nasce con QUELL'id, così un invio andato in timeout lato UI ma riuscito sul server non diventa un duplicato quando l'utente ripete — il server rifiuta il doc già presente.
    const docId = sanitizeDocId(submissionId);
    const idParam = docId ? `documentId=${encodeURIComponent(docId)}&` : '';
    const endpoint = `${FIRESTORE_BASE}/${COLLECTION}?${idParam}key=${API_KEY}`;
    let res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (res.status === 403) {
      // Rules non ancora aggiornate ai campi nuovi: meglio un feedback senza numero, titolo o collegamento che un invio fallito. Si ritenta col solo schema storico.
      delete doc.fields.name;
      delete doc.fields.seq;
      delete doc.fields.subSeq;
      delete doc.fields.parentId;
      delete doc.fields.clientIdHash; // S1.F2.2: rules vecchie potrebbero rifiutarlo
      seq = null;
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      });
    }
    // 409 ALREADY_EXISTS con documentId: il feedback c'era già da un tentativo precedente. Non è un errore, è un successo idempotente.
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

  // Quante segnalazioni chiedono al massimo le pagine che le ELENCANO, dalla più recente. È un TETTO, non un totale: superata la soglia i più vecchi restano fuori e nessun conteggio calcolato in pagina può vederli.
  const LIST_PAGE_SIZE = 500;

  // Se il caricamento ha toccato il tetto, ogni numero che ne deriva è un «almeno N», non un totale.
  function listHitCap(loaded, pageSize) {
    const cap = Number(pageSize) > 0 ? Number(pageSize) : LIST_PAGE_SIZE;
    return Array.isArray(loaded) && loaded.length >= cap;
  }

  // «(24)» quando il numero è il totale, «(24+)» quando il caricamento ha toccato il tetto ed è solo un minimo. Un numero che afferma un totale che non conosce sembra una risposta ed è peggio di nessun numero; il «+» costa un carattere e dice la verità.
  function countLabel(n, truncated) {
    const v = Math.max(0, Math.trunc(Number(n) || 0));
    return truncated ? `(${v}+)` : `(${v})`;
  }

  // L'hover spiega il «+» così non resta un enigma, e serve anche a una sezione che sembra vuota perché i più vecchi non sono in pagina: per questo non nomina il numero.
  const COUNT_CAP_HINT =
    `Caricati i ${LIST_PAGE_SIZE} feedback più recenti: se ce ne sono di più vecchi, non sono in pagina e non entrano nel conto.`;

  // Lista i feedback, più recenti prima.
  // `timeoutMs`: la fetch si arrende dopo quel tempo invece di restare muta finché il sistema operativo non molla (offline, un fetch del renderer può metterci una dozzina di secondi). Chi lo passa vuole mostrare un errore in tempi umani; chi lo omette tiene il comportamento storico.
  // `fields`: i soli campi da scaricare. La dashboard lo usa per rimandare i campi pesanti al dettaglio e, col solo `__name__`, per chiedere «cosa è cambiato?» pagando pochi byte — ogni riga porta comunque `updateTime`.
  // `afterName` (anche stringa vuota, cioè «dall'inizio»): pagina ordinata per NOME del documento, che comincia dopo quello passato. È il cursore di `listAll`, e non passa dal ponte col main: da una pagina filo:// una lettura completa della collezione vera non si fa.
  async function list({ pageSize = 200, timeoutMs = 0, fields = null, idToken = '', afterName = null } = {}) {
    // Da una pagina filo:// la lettura passa dal main, che ha il token admin (#583): qui non c'è nessuna credenziale, e torna le righe già decodificate.
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

  // I feedback CHIUSI più di recente, non i più recenti per data d'invio: una segnalazione vecchia chiusa oggi sta in fondo alla lista per data, cioè fuori dalla pagina che si carica, e senza questa domanda la sua scheda non verrebbe scritta mai — niente bacheca, niente annuncio, niente crediti per chi l'aveva mandata.
  // La data di chiusura è in chiaro, quindi si può ordinare, e chi non è mai stato chiuso non ce l'ha e Firestore lo lascia fuori da sé. Serve il token dell'owner.
  async function listResolved({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, idToken = '' } = {}) {
    return listDirect(COLLECTION, { pageSize, timeoutMs, idToken, orderField: 'resolvedAt' });
  }

  // TUTTE le segnalazioni, non una pagina. `list` è una FINESTRA sui più recenti per data d'invio: va bene per chi guarda gli ultimi arrivati, non per chi fa una domanda sull'INSIEME.
  // Il caso che l'ha fatta nascere è l'archiviazione automatica: chiedendo la finestra sui cinquecento più recenti non guardava nemmeno le segnalazioni più vecchie, cioè quelle da prendere per prime — con 711 segnalazioni ne restavano fuori 211, i cui fix non uscivano mai dalla bacheca e restavano votabili e riapribili a pagamento. Il numero peggiora da solo, perché la finestra sta ferma e le segnalazioni crescono (patterns/una-pagina-dei-piu-recenti-non-e-tutto.md).
  // Quindi si pagina col nome del documento, che è unico e stabile, passando sempre dalla porta ESPOSTA così chi la sostituisce in una prova sostituisce anche questa; e se il freno sulle pagine scatta, la risposta lo dice.
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

  // La query vera, senza ponti: la usano il main col token dell'owner, gli script e la vista pubblica, che di token non ha bisogno.
  async function listDirect(collectionId, { pageSize = 200, timeoutMs = 0, fields = null, idToken = '', orderField = 'createdAt' } = {}) {
    // structuredQuery via runQuery, ordinamento decrescente sul campo chiesto (la data d'invio, salvo richiesta diversa).
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
    // Se il timeout scatta si rilancia un errore con «timeout» nel messaggio, così SN_CHAT_ERRORS lo riconosce come guasto di rete e non come annullamento volontario, che invece non va segnalato.
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

  // Il numero più alto MAI assegnato, chiesto al server con una query sua. Serve il token dell'owner.
  // Il massimo dei feedback caricati non basta: il caricamento si ferma ai più recenti per data, e chi guardava solo quella pagina non poteva sapere se il contatore era gonfiato o solo più alto di quello che aveva visto — per prudenza non lo toccava, e la cura non partiva mai. Questa domanda costa UNA lettura ed è esatta.
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
    // `null`, non 0: chi chiama deve distinguere «non lo so» da «zero», o riporterebbe il contatore a zero su un database vuoto.
    return null;
  }

  // Solo le «versioni»: id più `_updateTime`, niente campi. È la domanda che la dashboard fa a ogni giro per restare aggiornata senza riscaricare tutto.
  async function listVersions({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0 } = {}) {
    const rows = await list({ pageSize, timeoutMs, fields: ['__name__'] });
    return rows.map((r) => ({ _id: r._id, _updateTime: r._updateTime }));
  }

  // batchGet: torna solo i documenti trovati, quindi un id cancellato nel frattempo non compare.
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

  // La vista pubblica (#583): `feedback-public/{id}`, una scheda per feedback chiuso coi soli campi pubblici (li decide feedbackPublicView.js).
  // È ciò che leggono la bacheca e il popup delle ricompense: niente token e niente ponte col main, qui dentro non c'è nulla da proteggere.

  // Senza `afterName`: le più recenti per data d'invio, come la lista vera, così chi la mostra non cambia ragionamento.
  // Con `afterName` (anche stringa vuota, cioè «dall'inizio»): pagina ordinata per NOME del documento, il cursore con cui `listAllPublic` arriva in fondo. Il nome è unico e stabile e non salta né ripete righe; una data sì, perché due schede possono averla identica.
  async function listPublic({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, afterName = null } = {}) {
    if (typeof afterName === 'string') {
      const { rows } = await listByNameDirect(VIEW_COLLECTION, { pageSize, timeoutMs, afterName });
      return rows;
    }
    return listDirect(VIEW_COLLECTION, { pageSize, timeoutMs });
  }

  // TUTTE le schede, non una pagina. Il tetto qui sopra è una finestra sui più recenti PER DATA D'INVIO, e le domande che si fanno alle schede non sono su quell'asse: «mi spetta una ricompensa?» (una segnalazione vecchia chiusa oggi ha la scheda in fondo, e chi l'ha mandata non riceve né annuncio né crediti), «quali schede vanno tolte?» (una fuori dalla finestra non la toglie più nessuno, e un fix riaperto resta in bacheca come risolto), «cosa mostra la bacheca?».
  // Sono tre modi di chiedere «tutte le schede», e con 552 schede e un tetto di 500 la risposta ne dimenticava 52, in silenzio (#583, giri 3, 4 e 5).
  // Quindi qui non si finestra: si PAGINA fino in fondo passando sempre da `listPublic`, una porta sola. Il costo è una lettura per scheda, qualche centesimo al mese, lo stesso che pagava la finestra ma completo. `maxPages` è un freno contro un ciclo infinito, non un tetto di prodotto: se scatta la risposta lo DICE (`complete: false`).
  const ALL_PAGES_MAX = 40;

  async function listAllPublicPaged({ pageSize = LIST_PAGE_SIZE, timeoutMs = 0, maxPages = ALL_PAGES_MAX } = {}) {
    const limit = Math.max(1, Math.min(LIST_PAGE_SIZE, Number(pageSize) || LIST_PAGE_SIZE));
    const rows = [];
    const visti = new Set();
    let cursor = '';
    let complete = false;
    for (let page = 0; page < Math.max(1, Number(maxPages) || ALL_PAGES_MAX); page += 1) {
      // Si passa dalla porta ESPOSTA, non dal riferimento interno: chi sostituisce `SN_FEEDBACK.listPublic` in una prova deve sostituire anche questa lettura, o si ritroverebbe la rete vera sotto una pagina che crede finta.
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
      // Una sorgente che ignora il cursore torna sempre la stessa pagina: se non arriva niente di nuovo si è già in fondo, e continuare sarebbe un ciclo.
      const ultimo = nomeDocumento(VIEW_COLLECTION, arr[arr.length - 1]);
      if (arr.length < limit || nuove === 0 || !ultimo || ultimo === cursor) { complete = true; break; }
      cursor = ultimo;
    }
    return { rows, complete };
  }

  // Memoria breve della lettura completa. L'annuncio della ricompensa gira a ogni caricamento della home, e la home è la pagina di OGNI scheda nuova: senza memoria chi ha mandato almeno una segnalazione si riscarica tutte le schede ogni volta che apre una scheda — misurate, quattro aperture costavano 2208 schede in otto richieste, e il numero cresce da solo a ogni fix che esce. La risposta che serve cambia una volta ogni mai.
  // Trenta secondi sono gli stessi che si dà chi gestisce i feedback dal lato suo: era l'asimmetria da chiudere, due cammini uguali di cui uno solo ricordava.
  // La memoria tiene anche il riferimento della PORTA da cui è stata riempita: chi la sostituisce mette una funzione nuova, la memoria non combacia più e si rilegge, così una prova non si ritrova davanti le schede della scena precedente. E si ricorda solo una lettura COMPLETA: memorizzare un troncamento vorrebbe dire ripeterlo per mezzo minuto.
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

  // Una pagina ordinata per nome del documento, con cursore: è il mattone delle letture complete, e l'ordine degli id a chi mostra le righe non serve — ordina lui.
  // `idToken` serve per la collezione vera, che senza credenziali non si legge (#583); la vista pubblica lo lascia vuoto.
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

  // Torna null se non c'è: un feedback che non è in bacheca semplicemente non ha scheda.
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

  // La maschera elenca SOLO i campi della scheda: `votes` e `reopenRequests` li scrivono gli utenti e una ripubblicazione non deve cancellarli. Serve il token dell'owner o del server.
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
    // Voti e riaperture li scrivono gli UTENTI, quindi di norma non entrano nella maschera. L'unica volta che ci entrano è il travaso dal documento alla scheda (carryUserFields), e lì il valore che arriva ha già dentro anche quello che c'era sulla scheda.
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

  // Un fix riaperto o riclassificato esce dalla bacheca perché la sua scheda non c'è più, non perché la pagina la nasconde.
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

  // Aggiorna stato e note di un feedback. `opts.idToken` va come Bearer perché le rules verifichino che l'utente è un admin: senza, la scrittura riesce solo dove le regole ammettono l'anonimo.
  async function updateStatus(id, { status, notes, userNote, priority, priorityManual, reviewDecision, reviewComment, reviewedAt, starred, archiveOverride, mergePreapproved }, opts = {}) {
    if (!id) throw new Error('id mancante');
    const idToken = opts.idToken;
    const fields = {};
    const mask = [];
    if (status !== undefined) {
      // S1.F2.1: status fine cifrato se il gate è acceso, statusPublic SEMPRE in chiaro.
      const { fineStatus, publicStatus } = await encryptStatus(status);
      fields.status = toFsValue(fineStatus);
      mask.push('status');
      fields.statusPublic = toFsValue(publicStatus);
      mask.push('statusPublic');
    }
    // I DUE TESTI (ROUTINE-AUTH-SPEC.md §8). `notes` è la conversazione della lavorazione — il report per l'OWNER — e viaggia CIFRATO: il documento è a lettura pubblica, e quel testo prima o poi racconta come è stato chiuso un fix di sicurezza, cioè cosa non funzionava, prima che la correzione arrivi sui computer degli utenti.
    // Non si poteva cifrare per un motivo solo: era anche il testo che l'utente leggeva nel popup delle ricompense, sulla sua macchina, che la chiave non ce l'ha. Ora quella è una frase a parte in chiaro (`userNote`), e il report può essere protetto.
    // La conversazione ha un tetto (capNotes): oltre quello le regole respingono OGNI scrittura successiva sul feedback, non solo quella sulle note, e il feedback resterebbe immobile. I turni più vecchi si tagliano qui, PRIMA di cifrare, così il caso non si presenta mai.
    if (notes !== undefined) {
      const T = global.SN_FEEDBACK_THREAD;
      const capped = T && T.capNotes ? T.capNotes(notes) : notes;
      const C = global.SN_FEEDBACK_CRYPTO;
      let value = capped;
      if (C && C.isEnabled && C.isEnabled() && capped && !C.isEncrypted(capped)) {
        // Fail-safe: se la cifratura non riesce NON si scrive il report in chiaro, si lascia la conversazione com'era.
        try { value = await C.encryptForOwner(capped); } catch (_) { value = undefined; }
      }
      if (value !== undefined) { fields.notes = toFsValue(value); mask.push('notes'); }
    }
    // La frase per chi ha mandato il feedback: in chiaro per forza, perché la legge senza chiave, e corta per costruzione.
    // Il tetto è in CARATTERI e combacia con quello delle regole, provato dal vivo su un documento-cavia. Diverso dal tetto della conversazione, che è in byte perché lì sul documento finisce il testo CIFRATO.
    if (userNote !== undefined) {
      // Il taglio degli spazi si fa alla consegna e non mentre l'owner scrive: riscrivere la casella sotto le dita gli mangia lo spazio appena battuto e incolla insieme due parole.
      fields.userNote = toFsValue(String(userNote || '').trim().slice(0, 500)); mask.push('userNote');
    }
    // #476 — la revisione dell'owner viaggia TUTTA cifrata. Questi tre campi li scrive solo la dashboard quando sblocca o conferma un feedback fermato dalla sicurezza, e le letture della collezione sono pubbliche: in chiaro erano un annuncio a chi aveva mandato quel feedback.
    // `reviewComment` diceva il PERCHÉ era stato beccato, cioè il manuale per riprovare meglio; `reviewDecision` l'esito in una parola; e persino la SOLA PRESENZA di `reviewedAt` bastava, perché un feedback normale non ce l'ha. Non basta cifrarne uno: all'attaccante basterebbe il campo rimasto — vanno insieme, o non serve a niente.
    // Li rilegge solo chi ha la chiave: la dashboard e il backend di sicurezza, che su `reviewDecision === 'accepted'` sa di non dover ri-bloccare un feedback sbloccato a mano. I valori vecchi in chiaro continuano a leggersi.
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
    // Preferito (DB2), parcheggio per il futuro: le rules accettano `starred` nel ramo update admin.
    if (starred !== undefined) { fields.starred = { booleanValue: !!starred }; mask.push('starred'); }
    // Override owner per l'auto-archiviazione a punteggio (DC3, boardArchive.js).
    if (archiveOverride !== undefined) { fields.archiveOverride = toFsValue(archiveOverride); mask.push('archiveOverride'); }
    // La pre-approvazione della fusione per QUESTA pratica: `{ by, at }` per metterla, `null` per toglierla.
    // Togliere è CANCELLARE il campo: la maschera lo nomina e i campi non lo portano, che per Firestore vuol dire «via». Un `null` scritto come valore resterebbe sul documento e le regole lo respingerebbero.
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
      // Clamp PRIMA di cifrare.
      const p = Math.max(0, Math.min(3, Math.round(Number(priority) || 0)));
      // Con cifratura attiva `priority` va come stringValue (ciphertext); senza, integerValue come prima.
      const C = global.SN_FEEDBACK_CRYPTO;
      if (C && C.isEnabled()) {
        try {
          const encPriority = await C.encryptForOwner(String(p));
          fields.priority = { stringValue: encPriority };
        } catch (e) {
          console.warn('[SN feedback] cifratura priority fallita, scrivo in chiaro:', e?.message || e);
          fields.priority = { integerValue: String(p) };
        }
      } else {
        fields.priority = { integerValue: String(p) };
      }
      mask.push('priority');
    }
    // `priorityManual` non è cifrato: dice che l'owner ha fissato la priorità a mano, e il backend di sicurezza lo usa per saltare l'override automatico. Si scrive solo quando passato esplicitamente.
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

  // Voti di verifica (DB4), il substrato che la bacheca e l'archiviazione a punteggio leggono: un campo `votes` con chiave = uid del votante e valore { vote, at, credibilitySnapshot }, un voto per utente e cambiabile, con le rules che vincolano ognuno a scrivere solo la propria chiave.
  // #583: stanno sulla SCHEDA PUBBLICA, non più sul documento. È lì che la bacheca li legge — il documento vero chi vota non lo può nemmeno aprire — e tenerli in due posti avrebbe voluto dire due copie che divergono. Chi fa i conti dal lato owner li riceve dal main, che unisce scheda e documento; i voti storici già sul documento restano leggibili da lì.
  const VOTE_WORKS = 'works';
  const VOTE_BROKEN = 'broken';
  const VOTE_VALUES = [VOTE_WORKS, VOTE_BROKEN];

  // Credibilità di default 1: il substrato per-utente arriva con DC5, finché non c'è ogni voto pesa uguale.
  function normalizeCredibility(v) {
    const c = Number(v);
    return Number.isFinite(c) && c >= 0 ? c : 1;
  }

  // PURA: tiene solo le entry ben formate, scarta i voti non validi e normalizza `at` e `credibilitySnapshot`.
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

  // PURA: score = Σ credibilità(«works») − Σ credibilità(«broken»), total = votanti validi.
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

  // RETE: l'utente loggato esprime o cambia il proprio voto. Scrive solo `votes.<uid>` con updateMask mirato, così non tocca né altri voti né altri campi; le rules verificano chiave==uid.
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

  // updateMask sul field path SENZA includerlo nel body: Firestore elimina solo quella chiave e lascia intatti i voti altrui.
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

  // Riapertura a pagamento (DC4): si marca sul feedback ORIGINALE che l'uid l'ha chiesta, scrivendo solo `reopenRequests.<uid>` con updateMask mirato, come castVote.
  // Un utente normale non può toccare `status` di un documento che non ha creato: spostare l'originale fuori da «Risolti» resta al percorso fidato che legge questo campo. Qui si scrive solo il SEGNALE, e il chiamante crea il feedback collegato.
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

  global.SN_FEEDBACK = {
    submit,
    list,
    // Così una segnalazione vecchia chiusa oggi arriva in bacheca, senza allargare il caricamento per data d'invio.
    listResolved,
    // Per chi fa una domanda sull'INSIEME (chi va archiviato?), non per chi guarda gli ultimi arrivati: a quelli basta `list`, che è una lettura sola.
    listAll,
    listAllPaged,
    listVersions,
    getMany,
    // #583 — l'unica lettura dei feedback che non chiede credenziali: i soli campi pubblici dei feedback chiusi.
    listPublic,
    // TUTTE le schede: è la risposta a «mi spetta una ricompensa?», «quali schede vanno tolte?» e «cosa mostra la bacheca?», che sull'asse della data d'invio non si possono chiedere.
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
    // Esportata perché owner-feedback.mjs la riusa per scrivere statusPublic.
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
    uploadImage,
    uploadAttachment,
    // #582 — il confine degli allegati: forma del nome (che storage.rules pretende), riconoscimento di un URL del bucket, intestazioni di scarico. Pure, usate anche dal main.
    attachmentPath,
    isAttachmentUrl,
    attachmentFetchHeaders,
    // #582 — la scritta di un collegamento verso un indirizzo che arriva da fuori: dice dove si va, anche quando è tagliata.
    linkLabel,
    LINK_LABEL_MAX,
    formatNum,
    fallbackName,
    // Plumbing REST riutilizzabile (es. dal motore crediti). L'API_KEY è la chiave web pubblica Firebase, già nel client, non un segreto.
    toFsValue,
    fromFsValue,
    fsDocToObject,
    rest: { FIRESTORE_BASE, API_KEY, PROJECT_ID, VIEW_COLLECTION },
    configPublic: { projectId: PROJECT_ID, bucket: BUCKET, collection: COLLECTION },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
