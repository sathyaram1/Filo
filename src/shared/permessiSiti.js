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
    // Tenere acceso lo schermo mentre va un video: lo chiedono i lettori video,
    // le mappe mentre guidi, le pagine di ricette. Non legge niente e non
    // accende niente; lo fa perché l'utente ha premuto play, e nessun browser
    // lo domanda. Chiederlo significava fermare ogni film con una domanda che
    // nessuno capisce, e un «Nega» spegneva lo schermo a metà (#586, giro 4).
    'screen-wake-lock',
    // «Non buttarmi via i dati che ho già salvato qui». Non esce niente dal
    // computer e non si accende niente: riguarda solo lo spazio che il sito
    // occupa già. Anche questa nessun browser la domanda.
    'persistent-storage',
    'durable-storage',
  ]);

  // Permessi che Chromium non CHIEDE mai: si limita a domandare a Filo cosa è
  // già stato deciso, e con un no consegna al sito un risultato vuoto senza
  // dire niente a nessuno. Senza una richiesta non compare nessuna pastiglia,
  // quindi nessuna scelta viene mai registrata, quindi in Impostazioni quel
  // sito non compare e non c'è niente da ribaltare: si poteva solo negare, mai
  // consentire (#586, giro 4). Per questi la domanda la fa partire il
  // CONTROLLO, che intanto risponde no.
  const SOLO_CONTROLLO = new Set(['local-fonts']);

  function soloControllo(permesso) {
    return SOLO_CONTROLLO.has(String(permesso || ''));
  }

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
    sensors: 'sentire come muovi e inclini il computer',
    'local-fonts': 'vedere i caratteri installati sul tuo computer',
  };

  // Come si legge una domanda per un permesso che Filo non ha in elenco. Prima
  // qui finiva il nome tecnico dentro le virgolette, e la domanda diventava
  // «vuole usare «screen-wake-lock»»: chi la legge non sa cosa sta per dare
  // (#586, giro 4). Il nome tecnico non sparisce, si sposta: `tecnici()` lo dà
  // a chi lo può mettere dove non dà fastidio (il suggerimento della pastiglia,
  // l'elenco delle Impostazioni, dove due sconosciuti vanno distinti).
  const ETICHETTA_IGNOTA = 'usare una funzione che Filo non conosce';
  const NOME_IGNOTO = 'Funzione sconosciuta';

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
    sensors: 'Movimento del computer',
    'local-fonts': 'Caratteri installati',
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

  // Un permesso che Filo non sa nominare: il nome tecnico non va mostrato a
  // chi deve rispondere, ma non va nemmeno perso.
  function ignoto(chiave) {
    const k = String(chiave || '');
    return !ETICHETTE[k] && !NOMI[k];
  }

  // I nomi tecnici delle chiavi che Filo non conosce, per chi ha un posto dove
  // metterli senza sporcare la domanda (il suggerimento della pastiglia).
  function tecnici(chiavi) {
    return (Array.isArray(chiavi) ? chiavi : [chiavi])
      .map((k) => String(k || '')).filter((k) => k && ignoto(k));
  }

  function etichetta(chiave) {
    const k = String(chiave || '');
    return ETICHETTE[k] || ETICHETTA_IGNOTA;
  }

  // Nelle Impostazioni due sconosciuti dello stesso sito vanno distinti, quindi
  // lì il nome tecnico resta, fra parentesi e dopo le parole in italiano.
  function nome(chiave) {
    const k = String(chiave || '');
    return NOMI[k] || (k ? `${NOME_IGNOTO} (${k})` : NOME_IGNOTO);
  }

  // Cosa un sito PUÒ fare, per il cartello che resta acceso finché ce l'ha.
  // «può», non «sta»: quando il sito smette da solo nessuno ce lo dice, e la
  // sola cosa certa è che finché quella pagina è lì il permesso ce l'ha ancora.
  function frasePotere(chiavi, audioSistema) {
    const base = etichettaRichiesta(chiavi);
    if (!base) return '';
    return audioSistema ? `${base} e sentire l'audio del computer` : base;
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
        // Un permesso che non si ricorda non resta scritto nemmeno se lo
        // trovassimo già sul disco (una versione precedente lo salvava): qui
        // sparisce da solo alla prima lettura.
        if (!siRicorda(chiave)) continue;
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
      // Un permesso che non si ricorda si richiede sempre, qualunque cosa ci
      // sia scritto.
      if (!siRicorda(k)) return null;
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
      if (k && siRicorda(k)) voci[String(k)] = scelta;
    }
    if (!Object.keys(voci).length) { delete out[o]; return out; }
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

  // Come si chiamano, in italiano, gli schermi fra cui scegliere quando si
  // condivide. Il sistema li nomina in inglese («Entire screen», «Screen 1») e
  // quei nomi finivano tali e quali nel riquadro della condivisione, sotto una
  // frase italiana. Con un solo schermo la scelta è una sola e si chiama per
  // quello che è; con più schermi si numerano nell'ordine in cui arrivano.
  // Le FINESTRE restano col loro nome: quello è il titolo vero della finestra,
  // ed è come la si riconosce.
  // Torna una mappa { "<id della fonte>": "<nome>" } con dentro i soli schermi.
  function nomiDegliSchermi(idFonti) {
    const ids = (Array.isArray(idFonti) ? idFonti : []).map((x) => String(x || ''));
    const schermi = ids.filter((x) => x.startsWith('screen:'));
    const out = {};
    schermi.forEach((x, i) => {
      out[x] = schermi.length > 1 ? `Schermo ${i + 1}` : 'Tutto lo schermo';
    });
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
    SOLO_UNA_VOLTA,
    siRicorda,
    preamboloSchermo,
    innocuo,
    chiaviRichieste,
    etichetta,
    etichettaRichiesta,
    nome,
    nomiDegliSchermi,
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
