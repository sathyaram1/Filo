// I segreti che Filo ha letto da fuori in questa sessione, da qualunque superficie (#810): l'uscita che ne porta
// uno si ferma in ogni conversazione, non solo in quella che l'ha letto. Solo in memoria, mai a un modello.
// Regole: src/shared/urlExfil.js (valutaUscita); chi legge chiama `ricorda`, la porta delle uscite `tutti`.

// Largo: una pagina di codici di recupero ne ha decine, e il costo per uscita resta di pochi millisecondi.
const MAX_LETTI = 50000;

// Pieno, il registro toglie dalla lettura che ha portato più voci: una pagina che nasconde migliaia di codici finti
// consuma solo il proprio posto, e il codice vero letto altrove resta. Prova: tests/unit/usciteSegreti.test.mjs.
function registro(max = MAX_LETTI) {
  const voci = new Map();
  const lotti = new Map();
  let ultimo = 0;

  function metti(x, fonte, lotto) {
    if (!x || typeof x.valore !== 'string' || !x.valore) return;
    const k = `${x.regola}:${x.valore.toLowerCase()}`;
    // La prima fonte è quella vera: una frase di Filo che lo ripete dopo non la cambia.
    if (voci.has(k)) return;
    voci.set(k, { valore: x.valore, regola: x.regola, fonte: fonte || x.fonte || 'da fuori', lotto });
    if (!lotti.has(lotto)) lotti.set(lotto, new Set());
    lotti.get(lotto).add(k);
  }

  function sfoltisci() {
    while (voci.size > max) {
      let piu = null;
      for (const [lotto, chiavi] of lotti) if (!piu || chiavi.size > piu.chiavi.size) piu = { lotto, chiavi };
      for (const k of piu.chiavi) {
        if (voci.size <= max) break;
        voci.delete(k);
        piu.chiavi.delete(k);
      }
      if (!piu.chiavi.size) lotti.delete(piu.lotto);
    }
  }

  return {
    aggiungi(x, fonte) { metti(x, fonte, ++ultimo); sfoltisci(); },
    aggiungiTutti(lista, fonte) {
      const lotto = ++ultimo;
      for (const x of Array.isArray(lista) ? lista : []) metti(x, fonte, lotto);
      sfoltisci();
    },
    tutti: () => [...voci.values()].map(({ valore, regola, fonte }) => ({ valore, regola, fonte })),
    svuota() { voci.clear(); lotti.clear(); },
  };
}

const letti = registro();

function ricorda(testo, fonte) {
  const G = globalThis.SN_GUARDIANO_STATICO;
  if (!G || typeof testo !== 'string' || !testo.trim()) return;
  letti.aggiungiTutti(G.segretiNelTesto(testo), fonte);
}

module.exports = {
  ricorda, registro, aggiungi: letti.aggiungi, aggiungiTutti: letti.aggiungiTutti, tutti: letti.tutti, svuota: letti.svuota,
};
