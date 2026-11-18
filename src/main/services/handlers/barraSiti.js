// La barra dei siti della nuova scheda (#1803): solo pagine di Filo. La stessa mossa arriva dalla chat (azione
// BARRA_SITI) e passa dallo stesso servizio, src/main/services/barraSiti.js.

const { soloFilo } = require('./origine');

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const Barra = () => require('../barraSiti');

  on(MSG.BARRA_SITI_GET, soloFilo(async () => ({ ok: true, voci: await Barra().leggi() })));
  on(MSG.BARRA_SITI_MODIFICA, soloFilo(async (msg, sender) => {
    const esito = await Barra().modifica(msg && msg.mossa);
    if (esito.errore) return { ok: false, error: esito.errore, voci: esito.voci };
    if (esito.cambiato) ctx.annunciaBarraSiti(esito.voci, sender);
    return { ok: true, voci: esito.voci, voce: esito.voce || null, gia: !!esito.gia };
  }));
  on(MSG.BARRA_SITI_AVVIA, soloFilo(async (msg) => Barra().avvia(msg && msg.id)));
};
