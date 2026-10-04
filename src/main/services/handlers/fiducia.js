// Handler di dominio: mittenti e siti fidati (#534) per la pagina Preferenze. Solo pagine di Filo.

const { soloFilo } = require('./origine');
const Fiducia = require('../fiduciaStore');
const Schede = require('../schedeAperte');

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;
  const F = () => globalThis.SN_FIDUCIA;

  function voceDa(msg) {
    const m = msg && msg.mittente;
    const s = msg && msg.sito;
    if (typeof m === 'string' && m.trim()) return { tipo: 'mittente', voce: F().indirizzo(m) };
    if (typeof s === 'string' && s.trim()) return { tipo: 'sito', voce: F().sito(s) };
    return { tipo: '', voce: '' };
  }
  const errore = (tipo) => (tipo === 'mittente' ? 'Non è un indirizzo email.' : tipo === 'sito' ? 'Non è il nome di un sito.' : 'Scrivi un indirizzo o un sito.');

  on(MSG.FIDUCIA_VISTA, soloFilo(async () => ({ ok: true, ...(await Fiducia.vista()) })));

  on(MSG.FIDUCIA_PREPARA, soloFilo(async (msg, sender) => {
    const { tipo, voce } = voceDa(msg);
    if (!voce) return { ok: false, error: errore(tipo) };
    const st = await Fiducia.leggi();
    const gia = tipo === 'mittente' ? F().fidatoMittente(st, voce) : st.siti.some((x) => x.sito === voce);
    let sconsiglio = '';
    if (tipo === 'sito' && !gia) {
      let segnali = null;
      try { segnali = await Schede.segnaliSito(winOf(sender), voce); } catch (_) {}
      sconsiglio = F().sconsiglio(voce, segnali);
    }
    return { ok: true, tipo, voce, gia, sconsiglio };
  }));

  on(MSG.FIDUCIA_AGGIUNGI, soloFilo(async (msg) => {
    const { tipo, voce } = voceDa(msg);
    if (!voce) return { ok: false, error: errore(tipo) };
    const r = await Fiducia.aggiungi({ [tipo]: voce, via: 'preferenze' });
    return r.errore ? { ok: false, error: r.errore } : { ok: true, voce: r.voce, aggiunto: r.aggiunto };
  }));

  on(MSG.FIDUCIA_TOGLI, soloFilo(async (msg) => {
    const { tipo, voce } = voceDa(msg);
    const grezzo = String((msg && (msg.mittente || msg.sito)) || '').trim();
    if (!voce && !grezzo) return { ok: false, error: errore(tipo) };
    const r = await Fiducia.togli(tipo === 'sito' || (!tipo && msg && msg.sito) ? { sito: voce || grezzo } : { mittente: voce || grezzo });
    return { ok: true, tolto: r.tolto };
  }));
};
