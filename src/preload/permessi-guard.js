// Quello che un sito legge sul proprio stato dei permessi (#586).
//
// Il problema. Chromium conosce tre stati: concesso, negato, da chiedere.
// L'aggancio con cui Electron fa rispondere Filo ne conosce due, sì e no:
// finché nessuno ha scelto, Filo deve dire no, e il sito legge «negato».
// Molti siti guardano quello stato PRIMA di chiedere e, se leggono «negato»,
// non chiedono mai: il pulsante «attiva le notifiche» non fa niente, oppure
// compare «hai bloccato le notifiche, sbloccale dalle impostazioni del
// browser». E nelle impostazioni di Filo quel sito non c'è, perché nessuna
// scelta è stata presa: chi ci finisce resta senza via d'uscita.
//
// La correzione. Qui dentro, nel mondo della pagina, «negato» torna a essere
// «da chiedere» quando Filo non ha in memoria nessuna scelta per quel sito.
// Se una scelta c'è, passa quella: un no detto davvero resta un no.
//
// Non è una falla: non concede niente a nessuno. Il cancello vero resta nel
// processo principale, che risponde alle richieste vere. Qui si cambia solo
// una scritta, nel senso di dire la verità. Che la pagina possa a sua volta
// ingannarsi da sola su questo non cambia nulla: sta mentendo a se stessa su
// una cosa che il main decide comunque per conto suo.

'use strict';

// Dal nome che usa il sito alla chiave della memoria di Filo.
//
// `local-fonts` c'è per lo stesso motivo degli altri, e per uno in più: è
// l'unico permesso che Filo chiede partendo da una lettura di stato, quindi è
// proprio quello su cui un sito che guarda prima di chiedere si ferma. Senza
// questa riga leggeva «negato» su una cosa che nessuno aveva negato, smetteva
// lì, e la domanda comparsa nel frattempo non serviva più a niente (#586,
// giro 5).
const NOMI = {
  camera: 'fotocamera',
  microphone: 'microfono',
  geolocation: 'posizione',
  notifications: 'notifiche',
  'clipboard-read': 'appunti',
  'display-capture': 'schermo',
  'local-fonts': 'local-fonts',
};

// Evento privato con cui il preload passa e aggiorna l'elenco delle scelte già
// prese per questa origine. Il DOM è condiviso col mondo della pagina anche a
// contesti isolati: è la strada che non lascia niente su `window`.
const CANALE = '__filo_permessi_noti';

// Evento privato con cui Filo chiede alla pagina di CHIUDERE quello che le ha
// già consegnato (una traccia del microfono, della fotocamera, dello schermo),
// e quello con cui la pagina risponde quante ne restano vive. Vedi
// `buildCatturaSicuraSource`.
const CANALE_FERMA = '__filo_permessi_ferma';
const CANALE_FERMATO = '__filo_permessi_fermato';

// L'attributo con cui ogni traccia consegnata viene appesa al DOM, dentro un
// elemento nascosto, con scritta accanto la chiave di Filo che la copre
// ('microfono', 'fotocamera', 'schermo').
//
// Perché esiste: il conto delle tracce vive lo teneva il codice che gira nel
// mondo della PAGINA, e il conto arrivava a Filo come una risposta della pagina
// stessa. Una pagina che dichiarava finite le proprie tracce mentre erano vive
// si teneva il microfono aperto a permesso tolto, perché Filo, sentendosi dire
// «non è rimasto niente», non ricaricava (#586, giro 9). Il DOM invece è
// condiviso fra il mondo della pagina e quello del preload, mentre gli STAMPI
// no: il preload legge `srcObject` e chiama `stop()` con i suoi, che la pagina
// non può toccare. Da lì esce il conto vero.
const ATTR_TRACCIA = 'data-filo-traccia';

// Evento privato con cui la pagina dice a Filo che la posizione non è arrivata.
const CANALE_POSIZIONE_KO = '__filo_posizione_ko';

// ── La richiesta vecchia della cattura schermo, in ogni sua forma (#586) ─────
//
// Chromium tiene ancora aperta una seconda strada per la cattura dello schermo:
// `getUserMedia` con `chromeMediaSource` fra i vincoli. Quella strada non passa
// dal punto in cui Filo fa scegliere COSA si condivide, quindi va riportata su
// quella moderna prima di partire — e per riportarla va riconosciuta.
//
// Il nome della fonte non è uno solo: Chromium tiene buoni «desktop»,
// «screen», «system» e «tab», e il vincolo può stare direttamente nell'oggetto,
// dentro `mandatory` o dentro `optional`, che è anche una lista. Cercare la sola
// parola «desktop» dentro `mandatory` lasciava passare le altre forme, e da lì
// lo schermo intero partiva con un «Consenti» solo, senza far scegliere niente
// (#586, giro 10). Qui basta che `chromeMediaSource` ci sia, qualunque valore
// abbia: è un vincolo che nessuna richiesta normale usa, quindi la sua presenza
// è già la risposta.
//
// PURA, e inserita tale e quale nel giro che gira dentro la pagina: gli unit
// test la provano da qui.
function sorgenteSchermo(vincolo) {
  try {
    if (!vincolo || typeof vincolo !== 'object') return false;
    const dentro = (o) => {
      if (!o || typeof o !== 'object') return false;
      if (Array.isArray(o)) return o.some(dentro);
      return typeof o.chromeMediaSource === 'string' && !!o.chromeMediaSource;
    };
    return dentro(vincolo) || dentro(vincolo.mandatory) || dentro(vincolo.optional);
  } catch (_) { return false; }
}

// ── I riquadri a cui il preload non arriva (#586, giro 10) ───────────────────
//
// Un `<iframe>` creato senza indirizzo resta sul suo documento vuoto iniziale:
// non c'è nessuna navigazione, quindi il preload lì non gira e niente di questo
// giro ci arriva. Una pagina si scrive un riquadro così in una riga, e da lì
// tornavano aperte le porte che il giro tiene chiuse.
//
// Ci arriviamo dal riquadro che lo contiene: la finestra del figlio è dello
// stesso sito, quindi i suoi stampi si possono mettere a posto direttamente da
// qui. Si fa al primo accesso — `contentWindow` e `contentDocument` sono la
// strada che la pagina deve prendere per usarlo — e su ogni riquadro che
// compare nel documento. Resta fuori chi arriva al figlio per una strada che
// non passa da una proprietà (`window.frames[0]`) prima che l'osservatore se ne
// accorga: per quello la garanzia sta nel processo principale, che chiude una
// cattura schermo consegnata senza scelta (services/permessiSito.js).
function sorgenteRiquadriFigli(installa) {
  return `
    const figliFatti = new WeakSet();
    const copri = (w) => {
      try {
        if (!w || figliFatti.has(w) || !w.MediaDevices) return;
        figliFatti.add(w);
        ${installa}(w);
      } catch (_) {}
    };
    const guarda = (nome) => {
      try {
        const proto = window.HTMLIFrameElement && window.HTMLIFrameElement.prototype;
        const d = proto && Object.getOwnPropertyDescriptor(proto, nome);
        if (!d || typeof d.get !== 'function') return;
        Object.defineProperty(proto, nome, {
          configurable: true,
          enumerable: !!d.enumerable,
          get() {
            const v = d.get.call(this);
            try { copri(nome === 'contentWindow' ? v : (v && v.defaultView)); } catch (_) {}
            return v;
          },
        });
      } catch (_) {}
    };
    guarda('contentWindow');
    guarda('contentDocument');
    try {
      const occhio = new MutationObserver((ms) => {
        for (const m of ms) {
          for (const n of (m.addedNodes || [])) {
            try {
              if (n && n.tagName === 'IFRAME') copri(n.contentWindow);
              else if (n && n.querySelectorAll) {
                for (const f of n.querySelectorAll('iframe')) copri(f.contentWindow);
              }
            } catch (_) {}
          }
        }
      });
      occhio.observe(document, { childList: true, subtree: true });
    } catch (_) {}
`;
}

function buildPermessiGuardSource(noti) {
  const iniziali = JSON.stringify(noti && typeof noti === 'object' ? noti : {});
  const nomi = JSON.stringify(NOMI);
  const canale = JSON.stringify(CANALE);
  return `(() => {
  try {
    const NOMI = ${nomi};
    let noti = ${iniziali};
    document.addEventListener(${canale}, (e) => {
      try { if (e && e.detail && typeof e.detail === 'object') noti = e.detail; } catch (_) {}
    }, true);

    // "Filo non sa niente di questo permesso per questo sito": solo allora un
    // "negato" è in realtà un "da chiedere".
    const mai = (nome) => {
      const k = NOMI[String(nome || '')];
      return !!k && !noti[k];
    };

    // I permessi che Filo chiede partendo da una LETTURA di stato, e non da una
    // richiesta del sito (oggi: l'elenco dei caratteri installati). Per questi
    // la lettura la serviamo qui, senza disturbare il cancello: altrimenti una
    // pagina che si limita a guardare cosa può fare — la riga più educata che un
    // sito possa scrivere — faceva comparire una domanda col nome del sito,
    // senza che nessuno avesse cliccato niente, a ogni caricamento (#586,
    // giro 5). La domanda resta legata alla richiesta vera, che è l'unica cosa
    // che il cancello vede ancora passare.
    const DA_LETTURA = { 'local-fonts': 'local-fonts' };
    const statoNoto = (k) => (noti[k] === 'allow' ? 'granted' : (noti[k] === 'deny' ? 'denied' : 'prompt'));
    // Le risposte che serviamo noi restano vive: quando l'utente risponde alla
    // pastiglia, un sito iscritto ai cambi lo sente, come con quelle vere.
    const nostre = new Set();
    const rispostaNostra = (nome, k) => {
      const t = new EventTarget();
      let corrente = statoNoto(k);
      Object.defineProperties(t, {
        name: { get: () => nome, enumerable: true },
        state: { get: () => corrente, enumerable: true },
        onchange: { value: null, writable: true, enumerable: true },
      });
      t.__aggiorna = () => {
        const nuovo = statoNoto(k);
        if (nuovo === corrente) return;
        corrente = nuovo;
        const ev = new Event('change');
        try { if (typeof t.onchange === 'function') t.onchange.call(t, ev); } catch (_) {}
        try { t.dispatchEvent(ev); } catch (_) {}
      };
      nostre.add(t);
      return t;
    };
    document.addEventListener(${canale}, () => {
      for (const t of nostre) { try { t.__aggiorna(); } catch (_) {} }
    }, true);

    // La stessa messa a posto, per una finestra qualunque dello stesso sito: la
    // propria, e quella di un riquadro creato senza indirizzo, dove il preload
    // non gira (#586, giro 10). Lì dentro un widget leggeva «negato» su cose che
    // nessuno aveva negato, quindi non chiedeva mai e mostrava «sbloccalo dalle
    // impostazioni del browser», dove non c'era niente da sbloccare.
    const installaLetture = (w) => {
      try {
        const P = w.Permissions && w.Permissions.prototype;
        if (P && typeof P.query === 'function') {
          const vera = P.query;
          P.query = function query(desc) {
            try {
              const k = DA_LETTURA[String((desc && desc.name) || '')];
              if (k) return w.Promise.resolve(rispostaNostra(String(desc.name), k));
            } catch (_) {}
            return vera.call(this, desc).then((stato) => {
              try {
                const nome = desc && desc.name;
                if (!stato || stato.state !== 'denied' || !mai(nome)) return stato;
                // Un oggetto che ridice solo lo stato: i metodi (addEventListener,
                // onchange) restano quelli veri, legati all'originale, altrimenti
                // un sito che si iscrive ai cambi si prende un errore.
                return new Proxy(stato, {
                  get(t, p, r) {
                    if (p === 'state') return 'prompt';
                    const v = Reflect.get(t, p, t);
                    return typeof v === 'function' ? v.bind(t) : v;
                  },
                });
              } catch (_) { return stato; }
            });
          };
        }

        if (typeof w.Notification === 'function') {
          const d = Object.getOwnPropertyDescriptor(w.Notification, 'permission');
          if (d && typeof d.get === 'function') {
            Object.defineProperty(w.Notification, 'permission', {
              configurable: true,
              enumerable: !!d.enumerable,
              get() {
                try {
                  const v = d.get.call(w.Notification);
                  return (v === 'denied' && mai('notifications')) ? 'default' : v;
                } catch (_) { return 'default'; }
              },
            });
          }
        }
      } catch (_) {}
    };

    installaLetture(window);
${sorgenteRiquadriFigli('installaLetture')}
  } catch (_) {}
})();`;
}

// ── La richiesta che ammazza la scheda, e la roba già consegnata (#586) ──────
//
// Due cose nello stesso pezzo di codice, perché tutt'e due hanno bisogno di
// stare dentro il mondo della pagina, dove vivono le tracce che il sito ha in
// mano.
//
// 1. LA RICHIESTA CHE AMMAZZA LA SCHEDA. La strada vecchia della cattura
//    schermo (`chromeMediaSource` fra i vincoli) non si mescola: o viene dal
//    desktop tutto quello che si chiede, o non è una richiesta valida. Chromium
//    non la rifiuta, chiude il processo della pagina. Per chi naviga la scheda
//    muore all'istante e al suo posto compare la pagina di errore di Filo,
//    senza che abbia toccato niente. Le forme che ammazzano sono due e sono
//    speculari:
//      · l'audio del computer senza l'immagine dello schermo (#586, giro 4);
//      · l'immagine dello schermo insieme a un microfono o a una webcam veri
//        (#586, giro 5), che è quello che fanno i siti di videochiamata
//        rimasti indietro quando condividono schermo e voce insieme.
//    Qui tutt'e due tornano un errore che il sito sa gestire, prima che
//    Chromium le veda. Non è un cancello di sicurezza (una pagina ostile può
//    far fuori il proprio processo in altri modi): è la differenza fra un
//    errore e una scheda morta.
//
// 2. CHIUDERE QUELLO CHE IL SITO HA GIÀ IN MANO. Togliere un permesso deve
//    togliere anche la traccia già consegnata (#586, giro 4). L'unica strada
//    che c'era era ricaricare la pagina, e ricaricare butta via quello che chi
//    naviga stava scrivendo lì: il commento a metà, il modulo compilato, il
//    punto in cui era arrivato a leggere (#586, giro 5). Qui teniamo il conto
//    delle tracce consegnate e le fermiamo su richiesta, senza toccare la
//    pagina. Filo ricarica solo se qualcosa resta vivo lo stesso, che è il caso
//    di una pagina che ha fatto di tutto per non passare di qui.
function buildCatturaSicuraSource() {
  const ferma = JSON.stringify(CANALE_FERMA);
  const fermato = JSON.stringify(CANALE_FERMATO);
  const attr = JSON.stringify(ATTR_TRACCIA);
  return `(() => {
  try {
    const md = navigator.mediaDevices;
    const stampo = window.MediaDevices && window.MediaDevices.prototype;
    if (!md || !stampo || typeof stampo.getUserMedia !== 'function') return;

    const schermoChiesto = ${sorgenteSchermo.toString()};
    const chiesto = (v) => v !== undefined && v !== null && v !== false;

    // GLI STAMPI DI QUESTO MONDO, PRESI ADESSO. Questo giro parte prima del
    // codice del sito, e quello che si prende qui non gli si può più riscrivere
    // sotto. Passare dalle proprietà («el.srcObject = …», «el.setAttribute(…)»,
    // «dove.appendChild(el)») voleva dire passare da funzioni che il sito
    // ridefinisce quando vuole: bastavano due righe perché le tracce
    // arrivassero a un elemento che non le teneva, il conto di Filo non le
    // vedesse, e un microfono restasse aperto a permesso tolto (#586, giro 10).
    const creaEl = document.createElement.bind(document);
    const setAttr = Element.prototype.setAttribute;
    const appendiNodo = Node.prototype.appendChild;
    const togliNodo = Element.prototype.remove;
    const ascolta = EventTarget.prototype.addEventListener;
    const spara = EventTarget.prototype.dispatchEvent;
    const Evento = window.CustomEvent;
    const Flusso = window.MediaStream;
    const tracceDi = Flusso && Flusso.prototype.getTracks;
    const setSrc = (() => {
      try { return Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject').set; }
      catch (_) { return null; }
    })();
    const radiceDoc = (() => {
      try {
        const d = Object.getOwnPropertyDescriptor(Document.prototype, 'documentElement');
        return () => d.get.call(document);
      } catch (_) { return () => document.documentElement; }
    })();
    const statoTraccia = (() => {
      try {
        const d = Object.getOwnPropertyDescriptor(window.MediaStreamTrack.prototype, 'readyState');
        return (t) => d.get.call(t);
      } catch (_) { return (t) => t.readyState; }
    })();
    const fermaTraccia = (window.MediaStreamTrack && window.MediaStreamTrack.prototype.stop) || null;

    // Le tracce consegnate, con la chiave di Filo che le copre. Un insieme
    // debole non va bene: qui ci serve scorrerle. Il registro è UNO per
    // documento e vale anche per le tracce prese dentro un riquadro creato
    // senza indirizzo, perché l'elemento che le porta lo appendiamo qui.
    const consegnate = new Set(); // { t, k }
    // Quante ne abbiamo viste passare, da sempre. Questo numero lo tiene una
    // variabile chiusa qui dentro, che il sito non raggiunge: è il confronto con
    // quello che il preload vede nel DOM a dire se qualcuno ha rotto il ponte.
    let viste = 0;
    const appendi = (t, k) => {
      try {
        if (!setSrc || !Flusso) return;
        const el = creaEl('audio');
        el.muted = true;
        setAttr.call(el, ${attr}, String(k || ''));
        el.style.display = 'none';
        setSrc.call(el, new Flusso([t]));
        const dove = radiceDoc() || document.body;
        if (dove) appendiNodo.call(dove, el);
        ascolta.call(t, 'ended', () => { try { togliNodo.call(el); } catch (_) {} });
      } catch (_) {}
    };
    const segna = (t, k) => {
      if (!t) return t;
      for (const v of consegnate) if (v.t === t) return t;
      viste++;
      const voce = { t, k };
      consegnate.add(voce);
      appendi(t, k);
      try { ascolta.call(t, 'ended', () => { consegnate.delete(voce); }); } catch (_) {}
      return t;
    };
    const chiaveDi = (t, chiave) => chiave || (t.kind === 'audio' ? 'microfono' : 'fotocamera');
    const registra = (stream, chiave) => {
      try {
        for (const t of tracceDi.call(stream)) segna(t, chiaveDi(t, chiave));
      } catch (_) {}
      return stream;
    };

    ascolta.call(document, ${ferma}, (e) => {
      let vive = 0;
      try {
        const chiavi = (e && e.detail && Array.isArray(e.detail.chiavi)) ? e.detail.chiavi : null;
        for (const v of [...consegnate]) {
          if (statoTraccia(v.t) !== 'live') { consegnate.delete(v); continue; }
          // Quello che non è stato chiesto non si tocca e non si conta: chi
          // toglie il microfono non deve ritrovarsi la pagina ricaricata
          // perché la fotocamera, che non aveva tolto, è ancora accesa.
          if (chiavi && !chiavi.includes(v.k)) continue;
          try { fermaTraccia ? fermaTraccia.call(v.t) : v.t.stop(); } catch (_) {}
          if (statoTraccia(v.t) === 'live') vive++; else consegnate.delete(v);
        }
      } catch (_) {}
      try {
        spara.call(document, new Evento(${fermato}, {
          detail: { id: (e && e.detail && e.detail.id) || null, vive, viste },
        }));
      } catch (_) {}
    }, true);

    // Una traccia CLONATA è una traccia in più, viva per conto suo: fermare
    // l'originale non la ferma. Chi si metteva da parte una copia continuava ad
    // ascoltare a permesso tolto, e Filo, visto che l'originale si era fermato,
    // concludeva che non fosse rimasto niente (#586, giro 6).
    const avvolgiClone = (proto, quali) => {
      try {
        if (!proto || typeof proto.clone !== 'function') return;
        const vero = proto.clone;
        Object.defineProperty(proto, 'clone', {
          configurable: true,
          writable: true,
          value: function clone() {
            const out = vero.call(this);
            try {
              if (quali === 'stream') {
                // Una copia dello stream copia le sue tracce: vanno registrate
                // anche quelle, con la chiave che avevano le originali. Senza il
                // riscontro per posizione, la copia di uno schermo finiva
                // registrata come fotocamera, e togliere lo schermo non la
                // chiudeva.
                const mie = tracceDi.call(this);
                const nuove = tracceDi.call(out);
                nuove.forEach((t, i) => {
                  const vecchia = mie[i];
                  const voce = vecchia ? [...consegnate].find((v) => v.t === vecchia) : null;
                  segna(t, voce ? voce.k : chiaveDi(t, null));
                });
              } else {
                const mia = [...consegnate].find((v) => v.t === this);
                if (mia) segna(out, mia.k);
              }
            } catch (_) {}
            return out;
          },
        });
      } catch (_) {}
    };

    // Tutto quello che va messo a posto in UNA finestra dello stesso sito: la
    // propria, e quella di un riquadro creato senza indirizzo, dove il preload
    // non gira. Senza, quel riquadro era la scorciatoia per saltare la scelta di
    // cosa si condivide e per far morire la scheda con una riga (#586, giro 10).
    const installaCattura = (w) => {
      const suo = w.MediaDevices && w.MediaDevices.prototype;
      if (!suo || typeof suo.getUserMedia !== 'function') return;
      const suaMd = w.navigator && w.navigator.mediaDevices;
      const Attesa = w.Promise;
      const Errore = w.DOMException;
      // Il posto dove si avvolge è lo STAMPO, non l'oggetto. Avvolgendo
      // l'oggetto, la funzione originale restava lì accanto sullo stampo,
      // raggiungibile con una riga, e un sito che ne prendeva una seconda per
      // quella via si teneva il microfono aperto a permesso tolto: il conto non
      // era a zero (la prima era passata di qui), quindi la strada dura non
      // partiva (#586, giro 7). Sostituendo la funzione sullo stampo,
      // l'originale non è più raggiungibile da nessuna parte in questa
      // finestra: la teniamo solo noi, in questa chiusura. Resta scrivibile e
      // riconfigurabile di proposito: le librerie che avvolgono a loro volta il
      // microfono (quelle delle videochiamate lo fanno quasi tutte) si prendono
      // la NOSTRA e la richiamano, e vietare la scrittura le farebbe morire con
      // un errore.
      const vera = suo.getUserMedia;
      const veraDisplay = typeof suo.getDisplayMedia === 'function' ? suo.getDisplayMedia : null;
      Object.defineProperty(suo, 'getUserMedia', {
        configurable: true,
        writable: true,
        value: function getUserMedia(vincoli) {
          const c = vincoli || {};
          let schermo = false;
          try {
            const aD = schermoChiesto(c.audio);
            const vD = schermoChiesto(c.video);
            schermo = aD || vD;
            if (aD && !vD) {
              return Attesa.reject(new Errore(
                "L'audio del computer si può chiedere solo insieme all'immagine dello schermo.",
                'NotSupportedError',
              ));
            }
            if (vD && chiesto(c.audio) && !aD) {
              return Attesa.reject(new Errore(
                "L'immagine dello schermo si può chiedere da sola o insieme all'audio del computer, non insieme al microfono.",
                'NotSupportedError',
              ));
            }
            // LA STRADA VECCHIA DELLO SCHERMO, riportata su quella nuova.
            //
            // Le due strade arrivano a Filo con una richiesta indistinguibile,
            // ma solo la nuova passa dal punto in cui Filo fa scegliere COSA si
            // condivide (tutto lo schermo o una finestra sola) e se dare anche
            // l'audio del computer. Dalla vecchia partivano lo schermo intero e
            // il suono insieme, con un «Consenti» solo: la scelta valeva per i
            // siti che chiedevano con le buone, e bastava una riga per saltarla
            // (#586, giro 9). Qui la richiesta vecchia diventa quella nuova
            // prima di partire, così la scelta la incontra chiunque chieda lo
            // schermo. L'audio del computer resta una richiesta a parte, che il
            // riquadro mostra spenta: chiederlo non è averlo.
            if (vD && veraDisplay) {
              let v = (c.video && typeof c.video === 'object') ? { ...c.video } : true;
              if (v && typeof v === 'object') {
                delete v.mandatory; delete v.optional;
                delete v.chromeMediaSource; delete v.chromeMediaSourceId;
                if (!Object.keys(v).length) v = true;
              }
              return veraDisplay.call(this || suaMd || md, {
                video: v,
                ...(aD ? { audio: true } : {}),
              }).then((s) => registra(s, 'schermo'));
            }
          } catch (_) {}
          return vera.call(this || suaMd || md, vincoli).then((s) => registra(s, schermo ? 'schermo' : null));
        },
      });

      if (typeof suo.getDisplayMedia === 'function') {
        const veraD = suo.getDisplayMedia;
        Object.defineProperty(suo, 'getDisplayMedia', {
          configurable: true,
          writable: true,
          value: function getDisplayMedia(vincoli) {
            return veraD.call(this || suaMd || md, vincoli).then((s) => registra(s, 'schermo'));
          },
        });
      }

      avvolgiClone(w.MediaStreamTrack && w.MediaStreamTrack.prototype, 'traccia');
      avvolgiClone(w.MediaStream && w.MediaStream.prototype, 'stream');
    };

    installaCattura(window);
${sorgenteRiquadriFigli('installaCattura')}
  } catch (_) {}
})();`;
}

// ── La posizione che non arriva mai (#586) ──────────────────────────────────
//
// Il motore su cui Filo è costruito chiede dove sei a un servizio di rete, e
// quel servizio vuole una chiave che nelle versioni pubbliche del motore non
// c'è. Risultato: chi risponde «Consenti» a «vuole sapere dove sei» dà via una
// cosa delicata e al sito non arriva nessuna coordinata, solo un errore di
// rete. Il sito mostra una mappa rotta e chi naviga dà la colpa al sito.
//
// Filo la posizione non la sa produrre da sé: quello che può fare è non far
// finta. Qui il fallimento smette di essere silenzioso e diventa una riga che
// lo dice, una volta per scheda.
function buildPosizioneSinceraSource() {
  const canale = JSON.stringify(CANALE_POSIZIONE_KO);
  return `(() => {
  try {
    const g = navigator.geolocation;
    if (!g || typeof g.getCurrentPosition !== 'function') return;
    let detto = false;
    // Codice 2 = POSITION_UNAVAILABLE: il sistema non ha saputo dire dove sei.
    // Il 1 (negato) e il 3 (tempo scaduto) non c'entrano: quelli li ha decisi
    // qualcuno.
    const segnala = (err) => {
      try {
        if (detto || !err || err.code !== 2) return;
        detto = true;
        document.dispatchEvent(new CustomEvent(${canale}, { detail: {} }));
      } catch (_) {}
    };
    const avvolgi = (nome) => {
      const vera = g[nome] && g[nome].bind(g);
      if (!vera) return;
      Object.defineProperty(g, nome, {
        configurable: true,
        writable: true,
        value: function (ok, ko, opzioni) {
          return vera(ok, (err) => { segnala(err); if (typeof ko === 'function') ko(err); }, opzioni);
        },
      });
    };
    avvolgi('getCurrentPosition');
    avvolgi('watchPosition');
  } catch (_) {}
})();`;
}

module.exports = {
  buildPermessiGuardSource,
  buildCatturaSicuraSource,
  buildPosizioneSinceraSource,
  sorgenteSchermo,
  CANALE,
  CANALE_FERMA,
  CANALE_FERMATO,
  ATTR_TRACCIA,
  CANALE_POSIZIONE_KO,
  NOMI,
};
