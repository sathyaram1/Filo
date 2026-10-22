// Quello che il correttore impara e il dizionario personale (#1447) si scrivono da qui, in una fila sola: le schede che
// scrivono e la pagina del correttore rileggono e riscrivono le stesse chiavi, e due insieme si cancellerebbero i conti o
// una parola tolta. Le regole stanno in src/content/correttoreAutomatica.js; le soglie le legge il main.

require('../../content/correttoreRegole.js');
require('../../content/correttoreAutomatica.js');

const CHIAVE = 'sn_correttore_imparato';
const DIZIONARIO = 'sn_personal_dict';
// Largo: una parola del dizionario può essere un codice o un indirizzo incollato.
const PAROLA_MAX = 1000;
const A = () => globalThis.SN_CORRETTORE_AUTO;

const testo = (v) => (typeof v === 'string' && v.trim() && v.length <= PAROLA_MAX ? v.trim() : '');
const basso = (p) => String(p).toLowerCase();

// I passi sulla memoria di quello che si impara: (memoria, richiesta, soglie) → { memoria, … }.
const PASSI = {
  accettata: (m, q, s) => A().accettata(m, q.parola, q.correzione, s.accettiPerImparare),
  annullata: (m, q, s) => A().annullata(m, q.parola, s.annulliPerImparare),
  riscritta: (m, q, s) => A().riscritta(m, q.parola, { inizioFrase: q.inizioFrase === true }, s.riscrittePerImparare),
  corretta: (m, q) => ({ memoria: A().corretta(m, q.parola) }),
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
    if (da !== a && m.rifiutate.includes(a)) return { memoria: m, gia: true };
    return { memoria: { ...m, rifiutate: [...m.rifiutate.filter((w) => w !== da), a] } };
  },
};

// I passi sul dizionario personale: (parole, richiesta) → { parole, gia, dimentica }. Le parole restano come le ha
// scritte l'utente («iPhone»), il confronto è senza maiuscole.
const PASSI_DIZIONARIO = {
  aggiungiParola: (d, q) => (d.some((w) => basso(w) === basso(q.parola)) ? { parole: d, gia: true } : { parole: [...d, q.parola] }),
  togliParola: (d, q) => ({ parole: d.filter((w) => basso(w) !== basso(q.parola)), dimentica: [q.parola] }),
  rinominaParola: (d, q) => {
    if (basso(q.parola) !== basso(q.nuova) && d.some((w) => basso(w) === basso(q.nuova))) return { parole: d, gia: true };
    return { parole: [...d.filter((w) => basso(w) !== basso(q.parola)), q.nuova], dimentica: [q.parola, q.nuova] };
  },
};

// Da un sito si impara scrivendo; cambiare o togliere a mano si fa solo dalla pagina del correttore.
const SOLO_DA_FILO = new Set(['rifiuta', 'togliRifiutata', 'rinominaRifiutata', 'togliParola', 'rinominaParola']);

async function esegui(q, { daFilo = false } = {}) {
  const nome = q && typeof q.passo === 'string' ? q.passo : '';
  const local = globalThis.chrome.storage.local;
  const memoria = async () => A().memoria((await local.get(CHIAVE))[CHIAVE]);
  // Alle schede basta sapere quali parole non correggere: i conti a metà restano qui.
  if (nome === 'leggi') return { ok: true, rifiutate: (await memoria()).rifiutate };
  const passoMemoria = Object.prototype.hasOwnProperty.call(PASSI, nome) ? PASSI[nome] : null;
  const passoDizionario = Object.prototype.hasOwnProperty.call(PASSI_DIZIONARIO, nome) ? PASSI_DIZIONARIO[nome] : null;
  const parola = testo(q && q.parola);
  if ((!passoMemoria && !passoDizionario) || !parola || /\s/.test(parola)) return { ok: false, error: 'richiesta non valida' };
  if (SOLO_DA_FILO.has(nome) && !daFilo) return { ok: false, code: 'forbidden', error: 'forbidden' };
  const pulita = { ...q, parola, correzione: testo(q.correzione), nuova: testo(q.nuova) };
  if (nome === 'accettata' && !pulita.correzione) return { ok: false, error: 'richiesta non valida' };
  if (/^rinomina/.test(nome) && (!pulita.nuova || /\s/.test(pulita.nuova))) return { ok: false, error: 'richiesta non valida' };

  if (passoDizionario) {
    const prima = (await local.get(DIZIONARIO))[DIZIONARIO];
    const esito = passoDizionario(Array.isArray(prima) ? prima.map(String) : [], pulita);
    if (!esito.gia) await local.set({ [DIZIONARIO]: esito.parole });
    let m = null;
    for (const p of esito.dimentica || []) m = A().dimentica(m || await memoria(), p);
    if (m) await local.set({ [CHIAVE]: m });
    return { ok: true, gia: !!esito.gia, parole: esito.parole, rifiutate: m ? m.rifiutate : undefined };
  }
  const soglie = globalThis.SN_CONST.soglieCorrettore(await globalThis.SN_STORAGE.getSettings());
  const esito = passoMemoria(await memoria(), pulita, soglie);
  await local.set({ [CHIAVE]: esito.memoria });
  return {
    ok: true, impara: esito.impara ?? null, rifiuta: !!esito.rifiuta, gia: !!esito.gia, rifiutate: esito.memoria.rifiutate,
  };
}

let coda = Promise.resolve();
function passo(q, opz = {}) {
  const giro = coda.then(() => esegui(q, opz), () => esegui(q, opz));
  coda = giro.then(() => {}, () => {});
  return giro;
}

module.exports = { passo, CHIAVE, PASSI, PASSI_DIZIONARIO, SOLO_DA_FILO };
