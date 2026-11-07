// Handler di dominio: la parola d'ordine «owner non fidato» e la copia di «Discutiamone» (SPEC-SEDI §4.5).
// Solo dalla Gestione: un'altra pagina di Filo non la tocca e non la mette negli appunti. Alla pagina arriva solo se
// c'è, mai la parola. Regole: services/parolaOwner.js; prove: tests/manage-domande-parola.spec.mjs.

const Parola = require('../parolaOwner');
const { daFilo } = require('./origine');

const GESTIONE = /^filo:\/\/manage\//i;

module.exports = function register(on, ctx) {
  const { MSG } = ctx;

  const daGestione = (handler) => async (msg, sender, origin) => {
    if (!daFilo(origin, sender) || !GESTIONE.test(String(origin || ''))) return { ok: false, code: 'forbidden', error: 'forbidden' };
    return handler(msg, sender, origin);
  };
  const annuncia = (r) => {
    if (r && r.ok) {
      try { ctx.broadcastToFiloPages({ type: MSG.PAROLA_OWNER_CAMBIATA, salvata: r.salvata === true }); } catch (_) {}
    }
    return r;
  };

  on(MSG.PAROLA_OWNER_STATO, daGestione(async () => ({ ok: true, ...Parola.stato() })));
  on(MSG.PAROLA_OWNER_SALVA, daGestione(async (msg) => annuncia(Parola.salva(msg && msg.parola))));
  on(MSG.PAROLA_OWNER_TOGLI, daGestione(async () => annuncia(Parola.togli())));
  on(MSG.DISCUTIAMONE_COPIA, daGestione(async (msg) => Parola.copiaDiscuti(msg && msg.id)));
};
