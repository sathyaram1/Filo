// I riquadri di Filo su un sito si aprono nello strato sopra la scheda (#1509.1), mai nel documento del sito. Aperto ai
// siti: chi chiede è il content script della pagina; lo strato non apre riquadri per conto d'altri.
// Regole: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

module.exports = function register(on, ctx) {
  const { MSG } = ctx;

  // La scheda della pagina che chiede, o la finestrella di accesso dove sta: ognuna ha i suoi strati.
  const stratiDi = (sender) => {
    if (!sender || !sender.wc || sender.strato) return null;
    const tabs = sender.win && sender.win._filoTabs;
    if (tabs && tabs.riquadri && sender.tab) return tabs.riquadri;
    let propria = null;
    try { propria = require('electron').BrowserWindow.fromWebContents(sender.wc); } catch (_) { propria = null; }
    return propria && propria.webContents === sender.wc && propria._filoRiquadri ? propria._filoRiquadri : null;
  };

  on(MSG.RIQUADRO_APRI, async (msg, sender) => {
    const r = stratiDi(sender);
    return r ? r.apri(sender, msg) : { ok: false };
  });

  // L'Aiuto nello strato e la pagina sotto (#1509.3): lo strato chiede, la pagina risponde e gli manda i gesti.
  on(MSG.AIUTO_ALLA_PAGINA, async (msg, sender) => {
    if (!sender || !sender.strato) return { ok: false, error: 'forbidden' };
    return require('../../stratoDeiRiquadri').aiutoAllaPagina(sender.strato, msg && msg.op, msg && msg.args);
  });
  on(MSG.AIUTO_ESITO, async (msg, sender) => {
    const r = stratiDi(sender);
    return r ? r.esitoDallaPagina(sender, msg) : { ok: false };
  });
  on(MSG.AIUTO_ALLO_STRATO, async (msg, sender) => {
    const r = stratiDi(sender);
    return r ? r.comandoAiuto(sender, msg) : { ok: false };
  });
};
