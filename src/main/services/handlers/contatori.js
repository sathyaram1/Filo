// Handler di dominio dei contatori giornalieri (#969): crea il servizio, lo mette a disposizione del cancello dei
// modelli e risponde alla pagina dell'owner. Cosa si conta e quando parte: src/main/services/contatori.js.

const { soloFilo } = require('./origine');
const auth = require('../../auth/google-auth');
const Servizio = require('../contatori');

module.exports = function register(on, ctx) {
  const { MSG } = ctx;
  const A = globalThis.SN_CONST.ACTIONS;
  const contatori = Servizio.crea({
    // Le funzioni che preparano una risposta prima che la persona la chieda: l'uso lo conta la pagina che la mostra.
    dallaPagina: [A.EXPLAIN, A.SPELLCHECK_SEMANTIC, A.SPELLCHECK_CONTEXT],
    esclusi: async () => {
      const out = [];
      try { out.push(await globalThis.SN_STORAGE.getRaw('sn_feedback_client_id', null)); } catch (_) {}
      try { out.push(globalThis.SN_WALLET_MAIN?.pseudonym?.()); } catch (_) {}
      return out.filter(Boolean);
    },
  });
  globalThis.SN_CONTATORI_MAIN = contatori;
  contatori.avvia();

  on(MSG.CONTATORI_USO, async (msg) => ({ ok: contatori.usoDallaPagina(msg && msg.action, msg && msg.attesaMs) }));

  on(MSG.CONTATORI_INSTALLAZIONI, soloFilo(async () => {
    if (!ctx.isAdmin()) return { ok: false, error: 'not_admin' };
    try {
      return { ok: true, installazioni: await contatori.installazioni({ idToken: await auth.getIdToken() }) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }));
};
