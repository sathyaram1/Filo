// Handler della barra laterale (#871: azioni della pagina, Aiuto, risposte da leggere, la disposizione delle icone e
// il trascinamento fra la fila del tasto destro e la barra, #1434; aperti ai siti, non leggono dati) e del pannello di
// destra delle app (#1433: solo pagine di Filo). Regole: patterns/globale-nella-barra-contestuale-nel-tasto-destro.md

const RisposteInAttesa = require('../../risposteInAttesa');
const Layout = require('../layoutIcone');
const Registro = require('../registroCambi');
const Pannelli = require('../pannelliApp');
const { soloFilo } = require('./origine');

module.exports = function register(on, ctx) {
  const { MSG, winOf } = ctx;

  // Solo dalla scheda davanti, e dal suo frame principale: le coordinate e i nomi di un riquadro non sono quelli della pagina.
  const barraDellaSchedaDavanti = (sender) => {
    const tabs = winOf(sender)?._filoTabs;
    if (!tabs?.barra || !sender?.tab?.id || sender.tab.id !== tabs.activeId) return null;
    if (sender.frame && sender.frame.parent) return null;
    return tabs.barra;
  };

  const incognitoDi = (sender) => !!winOf(sender)?._filoIncognito;

  on(MSG.ICON_LAYOUT_GET, async (msg, sender) => ({ ok: true, layout: await Layout.leggi({ incognito: incognitoDi(sender) }) }));

  // Un'icona posata nella fila del tasto destro o nel suo «Altro…» (#1434): un cambio del filo, come dalla barra.
  on(MSG.ICON_LAYOUT_DROP, async (msg, sender) => {
    const D = globalThis.SN_DISPOSIZIONE_ICONE;
    const id = String(msg?.id || '');
    const target = String(msg?.target || '');
    if (!D || !D.esiste(id) || !D.ammessa(id, target)) return { ok: false, error: 'icona o zona sconosciuta' };
    const beforeId = msg?.beforeId && D.esiste(String(msg.beforeId)) ? String(msg.beforeId) : null;
    // Da dove viene, per i contatori (#1471): presa dalla barra, l'apertura della barra è servita a qualcosa.
    const origine = msg?.source === 'bar' ? 'icona_barra' : 'icona_menu';
    const layout = await Registro.con({ via: 'interfaccia', dove: 'tasto-destro' },
      () => Layout.posa({ id, target, beforeId }, { incognito: incognitoDi(sender), origine }));
    if (layout && origine === 'icona_barra') { try { winOf(sender)?._filoTabs?.barra?.iconaPresaFuori(); } catch (_) {} }
    return layout ? { ok: true, layout } : { ok: false, error: 'icona o zona sconosciuta' };
  });

  // Dal menu della scheda davanti verso la barra: la scheda ha il puntatore per tutto il gesto.
  on(MSG.BARRA_TRASCINA, async (msg, sender) => {
    const barra = barraDellaSchedaDavanti(sender);
    return barra ? barra.dallaScheda(msg || {}, sender.tab.id) : { ok: false };
  });

  // Le icone della finestra portate nella fila del tasto destro: le descrive e le esegue la barra, con le sue regole.
  on(MSG.FILA_FINESTRA, async (msg, sender) => {
    const barra = barraDellaSchedaDavanti(sender);
    return barra ? { ok: true, icone: barra.iconeFila() } : { ok: false };
  });

  on(MSG.FILA_FINESTRA_ESEGUI, async (msg, sender) => {
    const barra = barraDellaSchedaDavanti(sender);
    if (!barra) return { ok: false };
    barra.esegui(String(msg?.id || ''), { via: 'fila' });
    return { ok: true };
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

  // ── Il pannello di destra delle app (#1433) ───────────────────────────────
  const appDi = (msg) => {
    const app = String(msg?.app || '');
    return globalThis.SN_PANNELLI_APP?.catalogo(app) ? app : '';
  };

  on(MSG.PANNELLO_APP_LEGGI, soloFilo(async (msg) => {
    const app = appDi(msg);
    if (!app) return { ok: false, error: 'app sconosciuta' };
    return { ok: true, stato: await Pannelli.leggi(app) };
  }));

  on(MSG.PANNELLO_APP_MODIFICA, soloFilo(async (msg) => {
    const app = appDi(msg);
    if (!app) return { ok: false, error: 'app sconosciuta' };
    const esito = await Pannelli.modifica(app, {
      op: String(msg?.op || ''), id: String(msg?.id || ''), primaDi: msg?.primaDi ? String(msg.primaDi) : null, config: msg?.config,
    });
    return esito ? { ok: true, stato: esito.stato, cambiato: esito.cambiato } : { ok: false, error: 'mossa non valida' };
  }));

  // La pagina dice al main che ha un pannello e com'è: il bordo destro e il tasto valgono solo lì.
  on(MSG.PANNELLO_APP_STATO, soloFilo(async (msg, sender) => {
    const s = schedaDi(sender);
    if (!s) return { ok: false };
    const app = appDi(msg);
    s.tab.pannelloApp = app ? {
      app,
      aperto: msg?.aperto === true,
      dentro: msg?.dentro === true,
      motivo: String(msg?.motivo || '').slice(0, 20),
      // I pixel dal bordo destro che il puntatore attraversa per arrivare al pannello: l'Aiuto aperto accanto.
      transito: Math.max(0, Math.min(4000, Math.round(Number(msg?.transito) || 0))),
    } : null;
    s.tabs.barra?.destro?.statoDallaScheda(s.tab);
    return { ok: true };
  }));
};
