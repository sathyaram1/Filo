// Dove vivono mittenti e siti fidati (#534): una chiave locale, scritture in fila, un avviso alle pagine di Filo.
// La regola sta in src/shared/fiducia.js; qui solo lettura, scrittura e annuncio.

const F = () => globalThis.SN_FIDUCIA;
const chiave = () => globalThis.SN_CONST.STORAGE_KEYS.FILO_FIDUCIA;

let coda = Promise.resolve();

async function leggi() {
  let grezzo = null;
  try { grezzo = await globalThis.SN_STORAGE.getRaw(chiave(), null); } catch (_) {}
  return F().normalizza(grezzo);
}

function annuncia() {
  try {
    const { MSG } = globalThis.SN_MSG;
    if (typeof globalThis.SN_BROADCAST_FILO === 'function') globalThis.SN_BROADCAST_FILO({ type: MSG.FIDUCIA_CAMBIATA });
  } catch (_) {}
}

// Rilegge e riscrive tutto: due scritture vicine (la chat e le Preferenze) non devono perdersi l'una l'altra.
function cambia(fn) {
  const giro = coda.then(async () => {
    const prima = await leggi();
    const r = fn(prima) || {};
    if (r.stato && JSON.stringify(r.stato) !== JSON.stringify(prima)) {
      await globalThis.SN_STORAGE.setRaw(chiave(), r.stato);
      if (r.annuncia !== false) annuncia();
    }
    return r;
  });
  coda = giro.catch(() => {});
  return giro;
}

async function vista() {
  const st = await leggi();
  const dal = (a, b) => (b.dal || 0) - (a.dal || 0);
  return {
    mittenti: st.mittenti.slice().sort(dal),
    siti: st.siti.slice().sort(dal),
  };
}

async function aggiungi({ mittente, sito, via }) {
  const r = await cambia((st) => F().aggiungi(st, { mittente, sito, via }));
  return { aggiunto: !!r.aggiunto, voce: r.voce || '', errore: r.errore || '' };
}

async function togli({ mittente, sito }) {
  const r = await cambia((st) => F().togli(st, { mittente, sito }));
  return { tolto: !!r.tolto, voce: r.voce || '' };
}

async function daInviati(account, indirizzi) {
  const r = await cambia((st) => F().daInviati(st, account, indirizzi));
  return r.nuovi || [];
}

module.exports = { leggi, vista, aggiungi, togli, daInviati };
