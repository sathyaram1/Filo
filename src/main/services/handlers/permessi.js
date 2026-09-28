// Handler di dominio: i permessi che i siti chiedono. Le porte che decidono per un sito passano da soloFilo;
// PERMESSO_FILO è l'unica aperta ai content script (vedi src/shared/messages.js).

const Permessi = require('../permessiSiti');
const { soloFilo } = require('./origine');

module.exports = function register(on, ctx) {
  const { MSG, broadcastToFiloPages } = ctx;

  Permessi.alCambio(() => broadcastToFiloPages({ type: MSG.SITE_PERMISSIONS_UPDATED }));

  // Con una scheda si parla del suo ambito (una finestra incognito ha il suo), senza di quello di chi chiede.
  function sessione(msg, sender) {
    if (msg && msg.tabId != null) {
      const s = Permessi.schedaPerId(msg.tabId);
      const wc = s && s.tab && s.tab.view && s.tab.view.webContents;
      return wc && !wc.isDestroyed() ? { ses: wc.session, wc } : null;
    }
    const wc = sender && sender.wc;
    return { ses: wc && !wc.isDestroyed() ? wc.session : null, wc: null };
  }

  on(MSG.SITE_PERMISSIONS_LIST, soloFilo(async (msg, sender) => {
    await Permessi.carica();
    const s = sessione(msg, sender);
    if (!s) return { ok: false, error: 'tab_not_found' };
    return { ok: true, siti: Permessi.elenco(s.ses) };
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

  on(MSG.SITE_PERMISSION_ANSWER, soloFilo(async (msg) => Permessi.rispondi(msg && msg.id, msg && msg.scelta)));

  on(MSG.PERMESSO_FILO, async (msg, sender) => {
    const ok = Permessi.concediAFilo(sender && sender.wc, String((msg && msg.tipo) || ''));
    return ok ? { ok: true } : { ok: false, error: 'bad_request' };
  });
};
