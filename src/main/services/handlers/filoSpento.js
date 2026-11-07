// Filo spento o riacceso su un sito dal tasto destro (#843): dal menu di Filo nella pagina e dal menu di riserva.
// Da un sito vale per il sito della sua scheda, che ricava il main, mai il messaggio; da Filo (l'avviso) `siti` dice quali.
// La riduzione dei nomi sta in src/shared/nomiSito.js; prove: tests/sito-escluso.spec.mjs.

const { daFilo } = require('./origine');
const N = require('../../../shared/nomiSito.js');

const hostDi = (url) => { try { return new URL(String(url || '')).hostname; } catch (_) { return ''; } };

// Il sito di un indirizzo web come lo salva l'elenco («www.Docs.Google.com» → «docs.google.com»); '' se non ce l'ha.
function sitoDi(url) {
  try {
    const u = new URL(String(url || ''));
    return u.protocol === 'http:' || u.protocol === 'https:' ? N.daScritto(u.hostname) : '';
  } catch (_) { return ''; }
}

// Le voci che spengono Filo su uno di questi indirizzi (la scheda, il riquadro cliccato), col confronto del content script.
function vociCheSpengono(elenco, indirizzi) {
  const host = (Array.isArray(indirizzi) ? indirizzi : []).map(hostDi).filter(Boolean);
  return (Array.isArray(elenco) ? elenco : []).filter((v) => host.some((h) => N.copre(v, h)));
}

let impostaDaFuori = null;

module.exports = function register(on, ctx) {
  const { MSG, winOf, applySettingsUpdate } = ctx;
  const Storage = globalThis.SN_STORAGE;

  const t = (chiave, ...args) => {
    try { return globalThis.SN_I18N.t(chiave, ...args); } catch (_) { return chiave; }
  };
  const leggibili = (siti) => siti.map((s) => N.leggibile(s) || s).join(', ');

  function avvisa(win, spento, cambiati) {
    if (!win || win.isDestroyed() || !cambiati.length) return;
    const testo = t(spento ? 'filo_spento_fatto' : 'filo_riacceso_fatto', leggibili(cambiati));
    const actions = [{ label: t('filo_spento_annulla'), filoSpento: { siti: cambiati, spento: !spento } }];
    try { win.webContents.send('shell:toast', { text: testo, opts: { durationSec: 12, key: 'filo-spento', tipo: 'filo_spento_sito', actions } }); } catch (_) {}
  }

  // `indirizzi`: la scheda (e il riquadro) di chi chiede; `siti`, se c'è, li nomina una superficie di Filo.
  async function imposta({ spento, indirizzi = [], siti = null, win = null, conAvviso = false }) {
    const prima = ((await Storage.getSettings()).blocklist || []).filter((x) => typeof x === 'string');
    let cambiati;
    if (Array.isArray(siti)) {
      const detti = [...new Set(siti.map((s) => N.daScritto(s)).filter(Boolean))];
      cambiati = spento ? detti.filter((s) => !prima.includes(s)) : detti.filter((s) => prima.includes(s));
    } else if (spento) {
      const sito = sitoDi(indirizzi[0]);
      if (!sito) return { ok: false, code: 'sito', error: 'Questa pagina non ha un sito su cui spegnere Filo' };
      cambiati = vociCheSpengono(prima, [indirizzi[0]]).length ? [] : [sito];
    } else {
      cambiati = vociCheSpengono(prima, indirizzi);
    }
    const dopo = spento ? prima.concat(cambiati) : prima.filter((x) => !cambiati.includes(x));
    if (cambiati.length) await applySettingsUpdate({ blocklist: dopo });
    if (conAvviso) avvisa(win, spento, cambiati);
    return { ok: true, sito: sitoDi(indirizzi[0]) || cambiati[0] || '', siti: dopo, cambiati };
  }

  impostaDaFuori = imposta;

  on(MSG.FILO_SPENTO_IMPOSTA, async (msg, sender, origin) => {
    const spento = !!(msg && msg.spento === true);
    const conAvviso = !!(msg && msg.avvisa === true);
    if (daFilo(origin, sender)) {
      const siti = Array.isArray(msg && msg.siti) ? msg.siti.filter((s) => typeof s === 'string').slice(0, 50) : [];
      return imposta({ spento, siti, win: winOf(sender), conAvviso });
    }
    let riquadro = '';
    try { riquadro = String((sender && sender.frame && sender.frame.url) || ''); } catch (_) { riquadro = ''; }
    const scheda = String((sender && sender.tab && sender.tab.url) || (sender && sender.url) || '');
    return imposta({ spento, indirizzi: [scheda, riquadro].filter(Boolean), win: winOf(sender), conAvviso });
  });
};

// Il menu di riserva sta fuori dagli handler: la sua voce «Riaccendi» passa da qui, con l'avviso.
module.exports.riaccendi = async (win, indirizzi) => {
  if (!impostaDaFuori) return { ok: false };
  return impostaDaFuori({ spento: false, indirizzi, win, conAvviso: true });
};
module.exports.sitoDi = sitoDi;
module.exports.vociCheSpengono = vociCheSpengono;
