// Permessi che i siti chiedono (fotocamera, microfono, posizione, notifiche,
// appunti, schermo…): REGOLA PURA, senza Electron e senza DOM.
//
// Perché esiste: senza un gestore dei permessi Electron CONCEDE per default, e
// un sito qualunque accendeva webcam e microfono, leggeva la posizione e gli
// appunti senza che comparisse niente (audit di sicurezza pre-alpha, #586).
// Qui vivono le sole decisioni di merito — cos'è innocuo, come si chiama una
// richiesta in italiano, cosa dice la memoria per quel sito — così che il main
// (src/main/services/permessiSito.js), la shell e la pagina Sicurezza leggano
// tutti la stessa tabella e nessuno se ne faccia una copia.
//
// La memoria è una mappa { "<origine>": { "<chiave>": "allow" | "deny" } },
// dove l'origine è schema+host+porta ("https://esempio.it") e la chiave è una
// delle CHIAVI qui sotto. Vive in settings.security.sitePermissions.

(function (global) {
  'use strict';

  // Permessi che NON meritano una domanda: non aprono un sensore, non leggono
  // dati dell'utente e servono a cose che l'utente ha appena chiesto lui
  // (mettere un video a tutto schermo, copiare negli appunti premendo un
  // bottone "copia", riprodurre un video protetto da DRM, un gioco che prende
  // il cursore). Tutto ciò che NON è in questa lista passa da una scelta —
  // anche i permessi che non conosciamo, che è il motivo per cui la lista è
  // fatta di ciò che è innocuo e non di ciò che è pericoloso: un permesso
  // nuovo di una versione futura di Chromium nasce chiuso, non aperto.
  const INNOCUI = new Set([
    'fullscreen',
    'pointerLock',
    'keyboardLock',
    'clipboard-sanitized-write', // scrittura sanificata: non LEGGE nulla
    'mediaKeySystem',            // DRM: serve a far partire i video protetti
    'background-sync',
  ]);

  // Chiavi stabili della memoria: NON si cambiano (sono scritte nello storage
  // di chi usa Filo). 'media' si spacca in due perché fotocamera e microfono
  // sono due cose diverse e vanno ricordate separatamente.
  const CHIAVI = {
    FOTOCAMERA: 'fotocamera',
    MICROFONO: 'microfono',
    POSIZIONE: 'posizione',
    NOTIFICHE: 'notifiche',
    APPUNTI: 'appunti',
    SCHERMO: 'schermo',
  };

  // Come si chiama, per chi legge. La frase completa è "<sito> vuole <etichetta>".
  const ETICHETTE = {
    [CHIAVI.FOTOCAMERA]: 'usare la fotocamera',
    [CHIAVI.MICROFONO]: 'usare il microfono',
    [CHIAVI.POSIZIONE]: 'sapere dove sei',
    [CHIAVI.NOTIFICHE]: 'mandarti notifiche',
    [CHIAVI.APPUNTI]: 'leggere i tuoi appunti',
    [CHIAVI.SCHERMO]: 'vedere il tuo schermo',
    midi: 'usare i tuoi strumenti musicali MIDI',
    midiSysex: 'comandare i tuoi strumenti musicali MIDI',
    usb: 'collegarsi ai tuoi dispositivi USB',
    serial: 'collegarsi alle tue porte seriali',
    hid: 'collegarsi a tastiere e joystick collegati',
    bluetooth: 'collegarsi ai tuoi dispositivi Bluetooth',
    'idle-detection': 'sapere quando sei lontano dal computer',
    'window-management': 'vedere come sono disposti i tuoi schermi',
    'speaker-selection': 'scegliere da quale altoparlante esce l\'audio',
    'storage-access': 'usare i suoi cookie dentro un altro sito',
    'top-level-storage-access': 'usare i suoi cookie dentro un altro sito',
    openExternal: 'aprire un\'altra applicazione del computer',
  };

  // Nome breve della chiave per le liste (Impostazioni, menu del tasto destro).
  const NOMI = {
    [CHIAVI.FOTOCAMERA]: 'Fotocamera',
    [CHIAVI.MICROFONO]: 'Microfono',
    [CHIAVI.POSIZIONE]: 'Posizione',
    [CHIAVI.NOTIFICHE]: 'Notifiche',
    [CHIAVI.APPUNTI]: 'Appunti',
    [CHIAVI.SCHERMO]: 'Schermo',
    midi: 'MIDI',
    midiSysex: 'MIDI (comandi)',
    usb: 'USB',
    serial: 'Porta seriale',
    hid: 'Dispositivi collegati',
    bluetooth: 'Bluetooth',
    'idle-detection': 'Presenza al computer',
    'window-management': 'Disposizione degli schermi',
    'speaker-selection': 'Scelta dell\'altoparlante',
    'storage-access': 'Cookie dentro altri siti',
    'top-level-storage-access': 'Cookie dentro altri siti',
    openExternal: 'Apertura di altre applicazioni',
  };

  const SCELTE = new Set(['allow', 'deny']);

  // Permessi che NON si ricordano: si richiedono ogni volta.
  //
  // Lo schermo è l'unico, e non è una scelta di gusto. Una webcam accesa si
  // vede (la spia, il riquadro che parte), un microfono aperto prima o poi si
  // sente; una ripresa dello schermo non lascia nessun segno. Un «sempre» lì
  // significa che il sito riprende quello che stai facendo quando gli pare e
  // tu non lo sai mai. Nessun browser lo ricorda, per questo.
  const SOLO_UNA_VOLTA = new Set([CHIAVI.SCHERMO]);

  function siRicorda(chiave) {
    return !SOLO_UNA_VOLTA.has(String(chiave || ''));
  }

  function innocuo(permesso) {
    return INNOCUI.has(String(permesso || ''));
  }

  // La richiesta che Chromium fa PRIMA di una condivisione dello schermo:
  // permesso 'media' con la lista dei tipi VUOTA. Non è una richiesta di
  // fotocamera e microfono, e non va trattata come tale: chiedere «vuole usare
  // la fotocamera e il microfono» a chi ha premuto «condividi lo schermo» gli
  // fa consentire due sensori che nessuno gli ha nominato, e glieli lascia
  // consentiti per sempre. La domanda vera arriva subito dopo, dal gestore
  // della cattura schermo, che sa cosa sta per essere consegnato.
  function preamboloSchermo(permesso, dettagli) {
    if (String(permesso || '') !== 'media') return false;
    const tipi = (dettagli || {}).mediaTypes;
    return Array.isArray(tipi) && tipi.length === 0;
  }

  // Da (permesso, dettagli di Electron) alle chiavi di memoria coinvolte.
  // 'media' porta con sé `mediaTypes` (richiesta) o `mediaType` (controllo):
  // una videochiamata chiede fotocamera E microfono insieme, e la memoria deve
  // ricordarli distinti — chi ha detto sì al microfono non ha detto sì alla
  // fotocamera.
  function chiaviRichieste(permesso, dettagli) {
    const p = String(permesso || '');
    const d = dettagli || {};
    if (p === 'media') {
      const tipi = Array.isArray(d.mediaTypes) && d.mediaTypes.length
        ? d.mediaTypes
        : (d.mediaType ? [d.mediaType] : []);
      const out = [];
      for (const t of tipi) {
        if (t === 'video' && !out.includes(CHIAVI.FOTOCAMERA)) out.push(CHIAVI.FOTOCAMERA);
        if (t === 'audio' && !out.includes(CHIAVI.MICROFONO)) out.push(CHIAVI.MICROFONO);
      }
      // Tipo non dichiarato ('unknown', o assente): trattiamo la richiesta come
      // fotocamera + microfono. Concedere il meno possibile non si può — il
      // permesso è uno solo — quindi si chiede il massimo che potrebbe aprire.
      if (!out.length) return [CHIAVI.FOTOCAMERA, CHIAVI.MICROFONO];
      return out;
    }
    if (p === 'geolocation') return [CHIAVI.POSIZIONE];
    if (p === 'notifications') return [CHIAVI.NOTIFICHE];
    if (p === 'clipboard-read') return [CHIAVI.APPUNTI];
    if (p === 'display-capture') return [CHIAVI.SCHERMO];
    if (!p) return [];
    return [p];
  }

  function etichetta(chiave) {
    const k = String(chiave || '');
    return ETICHETTE[k] || `usare «${k}»`;
  }

  function nome(chiave) {
    const k = String(chiave || '');
    return NOMI[k] || k;
  }

  // "usare la fotocamera e il microfono" — una frase sola per una richiesta
  // che porta più chiavi.
  function etichettaRichiesta(chiavi) {
    const l = (Array.isArray(chiavi) ? chiavi : []).map(etichetta);
    if (!l.length) return '';
    if (l.length === 1) return l[0];
    // "usare la fotocamera e usare il microfono" suona male: dal secondo in poi
    // si tiene solo il complemento.
    const resto = l.slice(1).map((s) => s.replace(/^usare /, ''));
    return [l[0], ...resto].join(' e ');
  }

  // Origine confrontabile di una URL: schema://host[:porta]. Torna null per
  // tutto ciò che non è web (le pagine interne di Filo, devtools, about:blank):
  // quelle non passano mai dal permesso, sono Filo stesso.
  function origineDi(url) {
    const s = String(url || '');
    if (!/^https?:\/\//i.test(s)) return null;
    try {
      const u = new URL(s);
      if (!u.hostname) return null;
      return u.origin;
    } catch (_) { return null; }
  }

  // Superficie di Filo (pagina interna, shell, devtools): niente domande, è
  // l'app stessa che chiede — la dettatura e la lettura degli appunti dei menu
  // di Filo si romperebbero, e chiedere all'utente il permesso per una cosa
  // che ha appena chiesto lui è attrito puro.
  function interno(url) {
    const s = String(url || '').toLowerCase();
    return s.startsWith('filo://') || s.startsWith('devtools://') || s.startsWith('chrome-extension://');
  }

  function host(origine) {
    try { return new URL(String(origine || '')).host; } catch (_) { return String(origine || ''); }
  }

  // Difensiva: dalla mappa grezza dello storage a una mappa con sole voci
  // sensate. Non tronca e non butta via l'insieme se una voce è sporca: scarta
  // la singola voce.
  function normalizza(grezza) {
    const out = {};
    if (!grezza || typeof grezza !== 'object') return out;
    for (const [origine, voci] of Object.entries(grezza)) {
      if (!voci || typeof voci !== 'object') continue;
      const o = origineDi(origine);
      if (!o) continue;
      const pulite = {};
      for (const [chiave, scelta] of Object.entries(voci)) {
        if (!chiave || !SCELTE.has(scelta)) continue;
        pulite[chiave] = scelta;
      }
      if (Object.keys(pulite).length) out[o] = pulite;
    }
    return out;
  }

  // La memoria per questa richiesta: 'allow' solo se TUTTE le chiavi sono state
  // consentite, 'deny' se anche una sola è stata negata, null se manca qualcosa
  // (→ si chiede).
  function decisione(mappa, origine, chiavi) {
    const voci = (normalizzaOrigine(mappa, origine)) || {};
    const lista = Array.isArray(chiavi) ? chiavi : [chiavi];
    if (!lista.length) return null;
    let tutte = true;
    for (const k of lista) {
      const v = voci[k];
      if (v === 'deny') return 'deny';
      if (v !== 'allow') tutte = false;
    }
    return tutte ? 'allow' : null;
  }

  function normalizzaOrigine(mappa, origine) {
    if (!mappa || typeof mappa !== 'object') return null;
    const o = origineDi(origine);
    if (!o) return null;
    return mappa[o] || null;
  }

  // Ritorna una mappa NUOVA con la scelta registrata (le funzioni pure non
  // modificano l'originale: la mappa in memoria del main viene sostituita).
  function conScelta(mappa, origine, chiavi, scelta) {
    const o = origineDi(origine);
    if (!o || !SCELTE.has(scelta)) return normalizza(mappa);
    const out = normalizza(mappa);
    const voci = { ...(out[o] || {}) };
    for (const k of (Array.isArray(chiavi) ? chiavi : [chiavi])) {
      if (k) voci[String(k)] = scelta;
    }
    out[o] = voci;
    return out;
  }

  // Toglie una chiave (o tutta l'origine se `chiave` manca): è il "si può
  // togliere tutto ciò che si può aggiungere" delle invarianti.
  function senza(mappa, origine, chiave) {
    const o = origineDi(origine);
    const out = normalizza(mappa);
    if (!o || !out[o]) return out;
    if (!chiave) { delete out[o]; return out; }
    delete out[o][String(chiave)];
    if (!Object.keys(out[o]).length) delete out[o];
    return out;
  }

  // Elenco ordinato per le liste (Impostazioni → Sicurezza, menu del tasto
  // destro): [{ origine, host, voci: [{ chiave, nome, scelta }] }].
  function elenco(mappa) {
    const m = normalizza(mappa);
    return Object.keys(m).sort((a, b) => host(a).localeCompare(host(b))).map((origine) => ({
      origine,
      host: host(origine),
      voci: Object.keys(m[origine]).sort((a, b) => nome(a).localeCompare(nome(b))).map((chiave) => ({
        chiave,
        nome: nome(chiave),
        scelta: m[origine][chiave],
      })),
    }));
  }

  global.SN_PERMESSI_SITI = {
    CHIAVI,
    INNOCUI,
    innocuo,
    chiaviRichieste,
    etichetta,
    etichettaRichiesta,
    nome,
    origineDi,
    interno,
    host,
    normalizza,
    decisione,
    conScelta,
    senza,
    elenco,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
