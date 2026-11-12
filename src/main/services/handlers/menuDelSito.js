// Handler del menu che un sito si disegna da sé (#975). Aperti ai siti di proposito: da un sito il sito lo ricava il
// main dal frame che parla, mai dal messaggio; un altro sito lo nomina solo una superficie di Filo (la proposta).
// Regole: src/main/services/menuDelSito.js.

const { daFilo } = require('./origine');
const M = require('../menuDelSito');
const NomiSito = require('../../../shared/nomiSito.js');

module.exports = function register(on, ctx) {
  const { MSG, winOf, applySettingsUpdate } = ctx;
  const Storage = globalThis.SN_STORAGE;

  const t = (chiave, ...args) => {
    try { return globalThis.SN_I18N.t(chiave, ...args); } catch (_) { return chiave; }
  };
  const maiusc = () => {
    try { return globalThis.SN_TASTI.etichetta('Shift'); } catch (_) { return 'Shift'; }
  };
  const leggibile = (sito) => {
    try { return NomiSito.leggibile(sito) || sito; } catch (_) { return sito; }
  };

  function sitoDelMittente(sender) {
    let url = '';
    try { url = (sender && sender.frame && sender.frame.url) || (sender && sender.url) || ''; } catch (_) { url = ''; }
    return M.sitoDi(url);
  }

  function avvisa(sender, testo, actions) {
    const win = winOf(sender);
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('shell:toast', { text: testo, opts: { durationSec: 20, key: 'menu-del-sito', tipo: 'menu_del_sito', actions } }); } catch (_) {}
  }

  async function sitiAdesso() {
    try { return (await Storage.getSettings())?.menuDelSito?.siti; } catch (_) { return []; }
  }

  on(MSG.MENU_DEL_SITO_SCELTO, async (msg, sender, origin) => {
    if (daFilo(origin, sender)) return { ok: false, code: 'sito' };
    const sito = sitoDelMittente(sender);
    if (!sito) return { ok: false, code: 'sito' };
    const proposto = await M.registraScelta(sito, { giaPrimo: M.nellElenco(await sitiAdesso(), sito) });
    if (proposto) {
      avvisa(sender, t('menu_del_sito_proposta', leggibile(sito), maiusc()), [
        { label: t('menu_del_sito_si'), menuDelSito: { sito, attivo: true } },
        { label: t('menu_del_sito_no') },
      ]);
    }
    return { ok: true, proposto };
  });

  on(MSG.MENU_DEL_SITO_IMPOSTA, async (msg, sender, origin) => {
    const sito = daFilo(origin, sender) ? M.normalizza(msg && msg.sito) : sitoDelMittente(sender);
    if (!sito) return { ok: false, code: 'sito', error: 'Questa pagina non ha un sito a cui legare la scelta' };
    const attivo = !!(msg && msg.attivo === true);
    const prima = await sitiAdesso();
    const siti = M.elencoNuovo(prima, sito, attivo);
    const uguale = Array.isArray(prima) && prima.length === siti.length && prima.every((x, i) => x === siti[i]);
    if (!uguale) await applySettingsUpdate({ menuDelSito: { siti } });
    if (msg && msg.avvisa === true) {
      if (attivo) {
        avvisa(sender, t('menu_del_sito_fatto', leggibile(sito), maiusc()), [
          { label: t('menu_del_sito_annulla'), menuDelSito: { sito, attivo: false } },
        ]);
      } else {
        avvisa(sender, t('menu_del_sito_tolto', leggibile(sito)), []);
      }
    }
    return { ok: true, sito, siti };
  });
};
