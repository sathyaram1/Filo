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

  // Solo dalla scheda davanti, e dal suo frame principale: una in secondo piano non ha un menu sotto
  // gli occhi di nessuno, e le coordinate di un riquadro non sono quelle della barra.
  const barraDellaSchedaDavanti = (sender) => {
    const tabs = winOf(sender)?._filoTabs;
    if (!tabs?.barra || !sender?.tab?.id || sender.tab.id !== tabs.activeId) return null;
    if (sender.frame && sender.frame.parent) return null;
    return tabs.barra;
  };

  on(MSG.BARRA_TRASCINA, async (msg, sender) => {
    const barra = barraDellaSchedaDavanti(sender);
    return barra ? barra.dallaScheda(msg || {}, sender.tab.id) : { ok: false };
  });

  // Come si chiamano adesso le azioni della pagina che stanno nella barra («Traduci» o «Mostra originale»).
  on(MSG.BARRA_ETICHETTE, async (msg, sender) => {
    const barra = barraDellaSchedaDavanti(sender);
    if (!barra) return { ok: false };
    barra.etichette(sender.tab.id, msg && msg.voci);
    return { ok: true };
  });
};
