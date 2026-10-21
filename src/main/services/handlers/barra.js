// Handler di dominio della barra laterale (#871): la disposizione delle icone e il trascinamento
// fra il menu del tasto destro e la barra. Aperti ai content script dei siti: non leggono dati.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const Layout = require('../layoutIcone');
const RisposteInAttesa = require('../../risposteInAttesa');

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

  // L'Aiuto della scheda e le sue risposte da leggere (#1432), anche dalle schede dietro e dalla riserva della scheda
  // nuova: valgono quando tornano davanti. Dal solo frame principale, e del messaggio restano solo parole di un elenco.
  const schedaDi = (sender) => {
    const tabs = winOf(sender)?._filoTabs;
    if (!tabs || !sender?.tab?.id || (sender.frame && sender.frame.parent)) return null;
    const tab = tabs._perScheda(sender.tab.id);
    return tab ? { tabs, tab } : null;
  };
  const PANNELLI = new Set(['chiuso', 'ridotto', 'aperto']);
  const VOCI = new Set(['pronto', 'avvio', 'ascolta', 'trascrive', 'attesa']);
  const SPENTI = new Set(['', 'aiuto', 'sito', 'pagina']);
  const tra = (v, ammessi, base) => (ammessi.has(String(v)) ? String(v) : base);

  on(MSG.AIUTO_STATO, async (msg, sender) => {
    const s = schedaDi(sender);
    if (!s) return { ok: false };
    s.tab.aiuto = {
      pannello: tra(msg?.pannello, PANNELLI, 'chiuso'),
      voce: tra(msg?.voce, VOCI, 'pronto'),
      spento: tra(msg?.spento, SPENTI, ''),
    };
    s.tabs.barra?.aggiornaNav();
    return { ok: true };
  });

  on(MSG.RISPOSTA_IN_ATTESA, async (msg, sender) => {
    const s = schedaDi(sender);
    if (!s) return { ok: false };
    if (RisposteInAttesa.segna(s.tab, String(msg?.fonte || ''), msg?.attesa === true)) s.tabs.barra?.aggiornaNav();
    return { ok: true };
  });
};
