// Handler di dominio della barra laterale (#871): i nomi delle azioni della pagina, l'Aiuto della scheda e le sue
// risposte da leggere. Aperti ai content script dei siti: non leggono dati, e la disposizione delle icone non passa da qui.
// Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const RisposteInAttesa = require('../../risposteInAttesa');

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;

  // Solo dalla scheda davanti, e dal suo frame principale: le coordinate e i nomi di un riquadro non sono quelli della pagina.
  const barraDellaSchedaDavanti = (sender) => {
    const tabs = winOf(sender)?._filoTabs;
    if (!tabs?.barra || !sender?.tab?.id || sender.tab.id !== tabs.activeId) return null;
    if (sender.frame && sender.frame.parent) return null;
    return tabs.barra;
  };

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
