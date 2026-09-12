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
const NOMI = {
  camera: 'fotocamera',
  microphone: 'microfono',
  geolocation: 'posizione',
  notifications: 'notifiche',
  'clipboard-read': 'appunti',
  'display-capture': 'schermo',
};

// Evento privato con cui il preload passa e aggiorna l'elenco delle scelte già
// prese per questa origine. Il DOM è condiviso col mondo della pagina anche a
// contesti isolati: è la strada che non lascia niente su `window`.
const CANALE = '__filo_permessi_noti';

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

    const P = window.Permissions && window.Permissions.prototype;
    if (P && typeof P.query === 'function') {
      const vera = P.query;
      P.query = function query(desc) {
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

module.exports = { buildPermessiGuardSource, CANALE, NOMI };
