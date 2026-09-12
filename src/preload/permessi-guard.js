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

// Evento privato con cui la pagina dice a Filo che la posizione non è arrivata.
const CANALE_POSIZIONE_KO = '__filo_posizione_ko';

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

    const P = window.Permissions && window.Permissions.prototype;
    if (P && typeof P.query === 'function') {
      const vera = P.query;
      P.query = function query(desc) {
        try {
          const k = DA_LETTURA[String((desc && desc.name) || '')];
          if (k) return Promise.resolve(rispostaNostra(String(desc.name), k));
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

    if (typeof window.Notification === 'function') {
      const d = Object.getOwnPropertyDescriptor(window.Notification, 'permission');
      if (d && typeof d.get === 'function') {
        Object.defineProperty(window.Notification, 'permission', {
          configurable: true,
          enumerable: !!d.enumerable,
          get() {
            try {
              const v = d.get.call(window.Notification);
              return (v === 'denied' && mai('notifications')) ? 'default' : v;
            } catch (_) { return 'default'; }
          },
        });
      }
    }
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
//    schermo (`chromeMediaSource: 'desktop'` fra i vincoli) non si mescola: o
//    viene dal desktop tutto quello che si chiede, o non è una richiesta
//    valida. Chromium non la rifiuta, chiude il processo della pagina. Per chi
//    naviga la scheda muore all'istante e al suo posto compare la pagina di
//    errore di Filo, senza che abbia toccato niente. Le forme che ammazzano
//    sono due e sono speculari:
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
  return `(() => {
  try {
    const md = navigator.mediaDevices;
    // Il posto dove si avvolge è lo STAMPO, non l'oggetto. Avvolgendo l'oggetto,
    // la funzione originale restava lì accanto sullo stampo, raggiungibile con
    // una riga, e un sito che ne prendeva una seconda per quella via si teneva
    // il microfono aperto a permesso tolto: il conto non era a zero (la prima
    // era passata di qui), quindi la strada dura non partiva (#586, giro 7).
    // Sostituendo la funzione sullo stampo, l'originale non è più raggiungibile
    // da nessuna parte in questa pagina: la teniamo solo noi, in questa
    // chiusura. Resta scrivibile e riconfigurabile di proposito: le librerie
    // che avvolgono a loro volta il microfono (quelle delle videochiamate lo
    // fanno quasi tutte) si prendono la NOSTRA e la richiamano, e vietare la
    // scrittura le farebbe morire con un errore.
    const stampo = window.MediaDevices && window.MediaDevices.prototype;
    if (!md || !stampo || typeof stampo.getUserMedia !== 'function') return;
    const desktop = (v) => {
      try {
        if (!v || typeof v !== 'object') return false;
        const m = v.mandatory || v.optional;
        if (v.chromeMediaSource === 'desktop') return true;
        if (m && m.chromeMediaSource === 'desktop') return true;
        if (Array.isArray(m)) return m.some((o) => o && o.chromeMediaSource === 'desktop');
        return false;
      } catch (_) { return false; }
    };
    const chiesto = (v) => v !== undefined && v !== null && v !== false;

    // Le tracce consegnate, con la chiave di Filo che le copre. Un insieme
    // debole non va bene: qui ci serve scorrerle.
    const consegnate = new Set(); // { traccia, chiave }
    // Quante ne abbiamo viste passare, da sempre. Se è zero mentre Filo sa di
    // aver concesso qualcosa, vuol dire che la pagina non è passata di qui: chi
    // chiede non deve crederci e deve prendere la strada dura (#586, giro 6).
    let viste = 0;
    const segna = (t, k) => {
      if (!t) return t;
      for (const v of consegnate) if (v.t === t) return t;
      viste++;
      const voce = { t, k };
      consegnate.add(voce);
      try { t.addEventListener('ended', () => { consegnate.delete(voce); }); } catch (_) {}
      return t;
    };
    const chiaveDi = (t, chiave) => chiave || (t.kind === 'audio' ? 'microfono' : 'fotocamera');
    const registra = (stream, chiave) => {
      try {
        for (const t of stream.getTracks()) segna(t, chiaveDi(t, chiave));
      } catch (_) {}
      return stream;
    };

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
              const mia = [...consegnate].find((v) => v.t === this);
              if (quali === 'stream') {
                for (const t of out.getTracks()) segna(t, chiaveDi(t, null));
              } else if (mia) segna(out, mia.k);
            } catch (_) {}
            return out;
          },
        });
      } catch (_) {}
    };
    avvolgiClone(window.MediaStreamTrack && window.MediaStreamTrack.prototype, 'traccia');
    // Una copia dello stream copia le sue tracce: vanno registrate anche quelle,
    // con la chiave che avevano le originali quando si riesce a risalirci.
    try {
      const protoS = window.MediaStream && window.MediaStream.prototype;
      if (protoS && typeof protoS.clone === 'function') {
        const veroS = protoS.clone;
        Object.defineProperty(protoS, 'clone', {
          configurable: true,
          writable: true,
          value: function clone() {
            const out = veroS.call(this);
            try {
              const mie = this.getTracks();
              const nuove = out.getTracks();
              nuove.forEach((t, i) => {
                const vecchia = mie[i];
                const voce = vecchia ? [...consegnate].find((v) => v.t === vecchia) : null;
                segna(t, voce ? voce.k : chiaveDi(t, null));
              });
            } catch (_) {}
            return out;
          },
        });
      }
    } catch (_) {}

    document.addEventListener(${ferma}, (e) => {
      let vive = 0;
      try {
        const chiavi = (e && e.detail && Array.isArray(e.detail.chiavi)) ? e.detail.chiavi : null;
        for (const v of [...consegnate]) {
          if (v.t.readyState !== 'live') { consegnate.delete(v); continue; }
          // Quello che non è stato chiesto non si tocca e non si conta: chi
          // toglie il microfono non deve ritrovarsi la pagina ricaricata
          // perché la fotocamera, che non aveva tolto, è ancora accesa.
          if (chiavi && !chiavi.includes(v.k)) continue;
          try { v.t.stop(); } catch (_) {}
          if (v.t.readyState === 'live') vive++; else consegnate.delete(v);
        }
      } catch (_) {}
      try {
        document.dispatchEvent(new CustomEvent(${fermato}, {
          detail: { id: (e && e.detail && e.detail.id) || null, vive, viste },
        }));
      } catch (_) {}
    }, true);

    const vera = md.getUserMedia.bind(md);
    Object.defineProperty(md, 'getUserMedia', {
      configurable: true,
      writable: true,
      value: function getUserMedia(vincoli) {
        const c = vincoli || {};
        let schermo = false;
        try {
          const aD = desktop(c.audio);
          const vD = desktop(c.video);
          schermo = aD || vD;
          if (aD && !vD) {
            return Promise.reject(new DOMException(
              "L'audio del computer si può chiedere solo insieme all'immagine dello schermo.",
              'NotSupportedError',
            ));
          }
          if (vD && chiesto(c.audio) && !aD) {
            return Promise.reject(new DOMException(
              "L'immagine dello schermo si può chiedere da sola o insieme all'audio del computer, non insieme al microfono.",
              'NotSupportedError',
            ));
          }
        } catch (_) {}
        return vera(vincoli).then((s) => registra(s, schermo ? 'schermo' : null));
      },
    });

    if (typeof md.getDisplayMedia === 'function') {
      const veraD = md.getDisplayMedia.bind(md);
      Object.defineProperty(md, 'getDisplayMedia', {
        configurable: true,
        writable: true,
        value: function getDisplayMedia(vincoli) {
          return veraD(vincoli).then((s) => registra(s, 'schermo'));
        },
      });
    }
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
  CANALE,
  CANALE_FERMA,
  CANALE_FERMATO,
  CANALE_POSIZIONE_KO,
  NOMI,
};
