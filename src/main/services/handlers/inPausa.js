// Handler di dominio: Bacheca e Deck builder dei Mazzi in pausa per chi non è owner (#1592).
// Chi li vede lo decide services/inPausa.js; qui lo stato per la shell e le pagine, e gli interruttori di Gestione.
// Prove: tests/in-pausa.spec.mjs, tests/feedback-canali-origine.spec.mjs (le porte dell'owner da un sito).

const auth = require('../../auth/google-auth');
const InPausa = require('../inPausa');
const { soloFilo } = require('./origine');

module.exports = function register(on, ctx) {
  const { MSG } = ctx;

  // Riaperte o rimesse in pausa: la shell (menu App) e le pagine di Filo aperte (la home) lo sanno subito.
  InPausa.suCambio((nome, s) => {
    try { ctx.broadcastToFiloPages({ type: MSG.IN_PAUSA_CAMBIATO, nome, visible: s.visible }); } catch (_) {}
  });

  const soloOwner = (handler) => soloFilo(async (msg, sender, origin) => {
    if (!auth.isAdmin()) return { ok: false, code: 'not_admin', error: 'Comando riservato al proprietario.' };
    return handler(msg, sender, origin);
  });

  on(MSG.IN_PAUSA_STATO, soloFilo(async (msg) => {
    const stati = msg && msg.attendi ? await InPausa.statiSicuri() : InPausa.stati();
    return { ok: true, ...stati };
  }));

  on(MSG.IN_PAUSA_GET, soloOwner(async (msg) => {
    if (!InPausa.valido(msg?.nome)) return { ok: false, error: 'Funzione sconosciuta.' };
    const s = await InPausa.cancello(msg.nome).rileggiOra();
    return { ok: true, openToAll: s.openToAll, letto: s.letto };
  }));

  on(MSG.IN_PAUSA_SET, soloOwner(async (msg) => {
    if (!InPausa.valido(msg?.nome)) return { ok: false, error: 'Funzione sconosciuta.' };
    if (typeof msg?.openToAll !== 'boolean') return { ok: false, error: 'openToAll deve essere vero o falso.' };
    try {
      const s = await InPausa.cancello(msg.nome).impostaApertoATutti(msg.openToAll);
      return { ok: true, openToAll: s.openToAll };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  }));
};
