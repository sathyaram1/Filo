// Quello che il correttore impara (#1447) passa da qui, in una fila sola: le schede che scrivono e la pagina del
// correttore rileggono e riscrivono la stessa chiave, e due insieme si cancellerebbero i conti o una parola tolta.
// Le regole stanno in src/content/correttoreAutomatica.js; le soglie le legge il main dalle impostazioni.

require('../../content/correttoreRegole.js');
require('../../content/correttoreAutomatica.js');

const CHIAVE = 'sn_correttore_imparato';
const PAROLA_MAX = 120;
const A = () => globalThis.SN_CORRETTORE_AUTO;

const testo = (v) => (typeof v === 'string' && v.trim() && v.length <= PAROLA_MAX ? v.trim() : '');

const PASSI = {
  accettata: (m, q, s) => A().accettata(m, q.parola, q.correzione, s.accettiPerImparare),
  annullata: (m, q, s) => A().annullata(m, q.parola, s.annulliPerImparare),
  riscritta: (m, q, s) => A().riscritta(m, q.parola, { inizioFrase: q.inizioFrase === true }, s.riscrittePerImparare),
  corretta: (m, q) => ({ memoria: A().corretta(m, q.parola) }),
  dimentica: (m, q) => ({ memoria: A().dimentica(m, q.parola) }),
  rifiuta: (m, q) => {
    const k = A().chiave(q.parola);
    return { memoria: { ...m, rifiutate: m.rifiutate.includes(k) ? m.rifiutate : [...m.rifiutate, k] }, gia: m.rifiutate.includes(k) };
  },
  togliRifiutata: (m, q) => {
    const k = A().chiave(q.parola);
    return { memoria: A().dimentica({ ...m, rifiutate: m.rifiutate.filter((w) => w !== k) }, q.parola) };
  },
  rinominaRifiutata: (m, q) => {
    const da = A().chiave(q.parola);
    const a = A().chiave(q.nuova);
    if (!a || (da !== a && m.rifiutate.includes(a))) return { memoria: m, gia: true };
    return { memoria: { ...m, rifiutate: [...m.rifiutate.filter((w) => w !== da), a] } };
  },
};

async function esegui(q) {
  const fare = q && Object.prototype.hasOwnProperty.call(PASSI, q.passo) ? PASSI[q.passo] : null;
  const parola = testo(q && q.parola);
  if (!fare || !parola) return { ok: false, error: 'richiesta non valida' };
  const pulita = { ...q, parola, correzione: testo(q.correzione), nuova: testo(q.nuova) };
  if (q.passo === 'accettata' && !pulita.correzione) return { ok: false, error: 'richiesta non valida' };
  if (q.passo === 'rinominaRifiutata' && !pulita.nuova) return { ok: false, error: 'richiesta non valida' };
  const local = globalThis.chrome.storage.local;
  const soglie = globalThis.SN_CONST.soglieCorrettore(await globalThis.SN_STORAGE.getSettings());
  const prima = A().memoria((await local.get(CHIAVE))[CHIAVE]);
  const esito = fare(prima, pulita, soglie);
  await local.set({ [CHIAVE]: esito.memoria });
  return {
    ok: true, impara: esito.impara ?? null, rifiuta: !!esito.rifiuta, gia: !!esito.gia, rifiutate: esito.memoria.rifiutate,
  };
}

let coda = Promise.resolve();
function passo(q) {
  const giro = coda.then(() => esegui(q), () => esegui(q));
  coda = giro.then(() => {}, () => {});
  return giro;
}

module.exports = { passo, CHIAVE, PASSI };
