// Detta sulle pagine web: il microfono lo apre la cornice di Filo (filo://shell), mai la pagina, così il sito non
// eredita un microfono aperto per conto dell'utente (#586). Qui si fa da ponte fra il frame che detta e la cornice.
// AVVIA e FERMA arrivano dai content script; EVENTO solo dalla cornice.

const Permessi = require('../permessiSiti');
const { soloFilo } = require('./origine');

const GESTO_DETTA_MS = 5000;

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const attive = new Map();
  let prossimo = 1;

  function manda(voce, evento) {
    const msg = { type: MSG.DETTATURA_EVENTO, id: voce.id, ...evento };
    try {
      if (voce.frame && !voce.frame.detached) voce.frame.send('filo:broadcast', msg);
      else if (voce.wc && !voce.wc.isDestroyed()) voce.wc.send('filo:broadcast', msg);
    } catch (_) {}
  }

  function ferma(voce, motivo) {
    if (!attive.has(voce.id)) return;
    try { if (voce.win && !voce.win.isDestroyed()) voce.win.webContents.send('shell:dettatura', { azione: 'ferma', id: voce.id, motivo }); } catch (_) {}
  }

  function chiudi(voce) {
    attive.delete(voce.id);
    for (const off of voce.sganci) { try { off(); } catch (_) {} }
  }

  on(MSG.DETTATURA_AVVIA, async (msg, sender) => {
    const wc = sender && sender.wc;
    const win = sender && sender.win;
    if (!sender || !sender.tab || !wc || !win || win.isDestroyed()) return { ok: false, error: 'no_tab' };
    if (!Permessi.gestoVeroRecente(wc, GESTO_DETTA_MS)) return { ok: false, error: 'no_gesture' };
    // Una dettatura per scheda: la seconda richiesta chiude la prima, come il vecchio «Detta» premuto due volte.
    for (const v of attive.values()) if (v.wc === wc) ferma(v, 'nuova');
    const voce = { id: `detta-${prossimo++}`, wc, win, frame: sender.frame || null, sganci: [] };
    attive.set(voce.id, voce);
    // Cambiare pagina o chiudere la scheda spegne il microfono: la frase dopo non avrebbe un campo dove andare.
    const fine = () => ferma(voce, 'pagina');
    try { wc.once('did-navigate', fine); voce.sganci.push(() => wc.removeListener('did-navigate', fine)); } catch (_) {}
    try { wc.once('destroyed', fine); voce.sganci.push(() => wc.removeListener('destroyed', fine)); } catch (_) {}
    try {
      win.webContents.send('shell:dettatura', { azione: 'avvia', id: voce.id, lang: String((msg && msg.lang) || '').slice(0, 20) });
    } catch (_) {
      chiudi(voce);
      return { ok: false, error: 'no_shell' };
    }
    return { ok: true, id: voce.id };
  });

  on(MSG.DETTATURA_FERMA, async (msg, sender) => {
    const voce = attive.get(String((msg && msg.id) || ''));
    if (!voce || !sender || voce.wc !== sender.wc) return { ok: false, error: 'not_found' };
    ferma(voce, 'utente');
    return { ok: true };
  });

  on(MSG.DETTATURA_EVENTO, soloFilo(async (msg, sender) => {
    const voce = attive.get(String((msg && msg.id) || ''));
    if (!voce || !sender || sender.win !== voce.win || !sender.isShell) return { ok: false, error: 'not_found' };
    const tipo = String(msg.tipo || '');
    if (!['provvisoria', 'frase', 'errore', 'fine', 'ascolta'].includes(tipo)) return { ok: false, error: 'bad_request' };
    manda(voce, { tipo, testo: typeof msg.testo === 'string' ? msg.testo.slice(0, 20000) : undefined, res: msg.res || undefined });
    if (tipo === 'fine') chiudi(voce);
    return { ok: true };
  }));
};
