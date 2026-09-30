// Handler di dominio della barra laterale (#871): la disposizione delle icone e il trascinamento
// fra il menu del tasto destro e la barra. Aperti ai content script dei siti: non leggono dati.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const Layout = require('../layoutIcone');

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;
  const incognitoDi = (sender) => !!winOf(sender)?._filoIncognito;

  on(MSG.ICON_LAYOUT_GET, async (msg, sender) => {
    const layout = await Layout.leggi({ incognito: incognitoDi(sender) });
    return { ok: true, layout };
  });

  on(MSG.ICON_LAYOUT_DROP, async (msg, sender) => {
    const drop = {
      id: String(msg?.id || ''),
      target: String(msg?.target || ''),
      beforeId: msg?.beforeId ? String(msg.beforeId) : null,
    };
    const layout = await Layout.posa(drop, { incognito: incognitoDi(sender) });
    return layout ? { ok: true, layout } : { ok: false, error: 'icona o zona sconosciuta' };
  });

  // Solo dalla scheda davanti: una in secondo piano non ha un menu sotto gli occhi di nessuno.
  on(MSG.BARRA_TRASCINA, async (msg, sender) => {
    const win = winOf(sender);
    const tabs = win?._filoTabs;
    if (!tabs?.barra || !sender?.tab?.id || sender.tab.id !== tabs.activeId) return { ok: false };
    if (sender.frame && sender.frame.parent) return { ok: false };
    return tabs.barra.dallaScheda(msg || {}, sender.tab.id);
  });
};
