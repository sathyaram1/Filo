// Handler di dominio: i permessi che i siti chiedono. Le porte che decidono per un sito passano da soloFilo;
// aperte ai content script solo FILO_READ_CLIPBOARD (Incolla, subito dopo un gesto vero) e PERMESSI_ESC.

const Permessi = require('../permessiSiti');
const { soloFilo } = require('./origine');

// Il gesto che apre Incolla è il clic sulla voce del menu: pochi secondi bastano anche su un computer lento.
const GESTO_INCOLLA_MS = 5000;

module.exports = function register(on, ctx) {
  const { MSG, broadcastToFiloPages } = ctx;

  Permessi.alCambio(() => broadcastToFiloPages({ type: MSG.SITE_PERMISSIONS_UPDATED }));

  // Con una scheda si parla del suo ambito; senza, dell'ambito chiesto: le finestre normali, o l'incognito di chi chiede.
  function sessione(msg, sender) {
    if (msg && msg.tabId != null) {
      const s = Permessi.schedaPerId(msg.tabId);
      const wc = s && s.tab && s.tab.view && s.tab.view.webContents;
      return wc && !wc.isDestroyed() ? { ses: wc.session, wc } : null;
    }
    if (msg && msg.ambito === 'incognito') {
      const wc = sender && sender.wc;
      const ses = wc && !wc.isDestroyed() ? wc.session : null;
      return ses && Permessi.incognito(ses) ? { ses, wc: null } : null;
    }
    return { ses: null, wc: null };
  }

  on(MSG.SITE_PERMISSIONS_LIST, soloFilo(async (msg, sender) => {
    await Permessi.carica();
    if (msg && msg.tabId != null) {
      const s = sessione(msg, sender);
      if (!s) return { ok: false, error: 'tab_not_found' };
      return { ok: true, siti: Permessi.elenco(s.ses) };
    }
    const wc = sender && sender.wc;
    const mia = wc && !wc.isDestroyed() ? wc.session : null;
    return {
      ok: true,
      siti: Permessi.elenco(null),
      incognito: mia && Permessi.incognito(mia) ? Permessi.elenco(mia) : null,
    };
  }));

  on(MSG.SITE_PERMISSIONS_OF_TAB, soloFilo(async (msg, sender) => {
    await Permessi.carica();
    const s = sessione({ tabId: msg && msg.tabId }, sender);
    if (!s || !s.wc) return { ok: false, error: 'tab_not_found' };
    const origine = globalThis.SN_PERMESSI_SITI.origineDi(s.wc.getURL());
    return { ok: true, sito: origine ? Permessi.perSito(s.ses, origine) : null };
  }));

  on(MSG.SITE_PERMISSION_SET, soloFilo(async (msg, sender) => {
    await Permessi.carica();
    const s = sessione(msg, sender);
    if (!s) return { ok: false, error: 'tab_not_found' };
    return Permessi.imposta(s.ses, String(msg.origine || ''), String(msg.tipo || ''), msg.scelta == null ? null : msg.scelta);
  }));

  on(MSG.SITE_PERMISSIONS_FORGET, soloFilo(async (msg, sender) => {
    await Permessi.carica();
    const s = sessione(msg, sender);
    if (!s) return { ok: false, error: 'tab_not_found' };
    return Permessi.dimentica(s.ses, String(msg.origine || ''));
  }));

  on(MSG.SITE_PERMISSION_ANSWER, soloFilo(async (msg) => Permessi.rispondi(msg && msg.id, msg && msg.scelta, msg && msg.fonte)));

  on(MSG.SITE_SCREEN_SOURCES, soloFilo(async (msg) => Permessi.fontiPerDomanda(msg && msg.id)));

  on(MSG.PERMESSI_ESC, async (msg, sender) => ({ ok: true, chiusa: Permessi.chiudiPrimaDomanda(sender && sender.wc) }));

  // Gli appunti per Incolla li legge Filo dal sistema: il permesso del sito resta fuori, e la pagina non lo eredita.
  on(MSG.FILO_READ_CLIPBOARD, async (msg, sender) => {
    const wc = sender && sender.wc;
    if (!sender || !sender.tab || !wc) return { ok: false, error: 'no_tab' };
    if (!Permessi.gestoVeroRecente(wc, GESTO_INCOLLA_MS)) return { ok: false, error: 'no_gesture' };
    const { clipboard } = require('electron');
    let testo = '';
    let immagine = '';
    try { testo = clipboard.readText() || ''; } catch (_) { testo = ''; }
    try {
      const img = clipboard.readImage();
      if (img && !img.isEmpty()) immagine = img.toDataURL();
    } catch (_) { immagine = ''; }
    return { ok: true, testo, immagine };
  });
};
