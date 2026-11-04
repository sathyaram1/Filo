// Le voci scelte in un menu a comparsa, contate per chi usa Filo (#1129): la più usata si prepara all'apertura del menu.
// Non prepara niente da sé (src/main/tabs.js, preparaDalMenu); l'incognito non conta. Prova: tests/unit/vociMenuUsate.test.mjs.

// La più scelta fra `candidati`; a pari conto vince `predefinita`, poi l'ordine del menu.
function scegli(conti, candidati, predefinita = '') {
  const voci = (Array.isArray(candidati) ? candidati : []).filter((u) => typeof u === 'string' && u);
  if (!voci.length) return '';
  const n = (u) => {
    const v = conti && Object.prototype.hasOwnProperty.call(conti, u) ? Number(conti[u]) : 0;
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  const prima = voci.includes(predefinita) ? predefinita : voci[0];
  let migliore = prima;
  for (const u of voci) if (n(u) > n(migliore)) migliore = u;
  return migliore;
}

function crea({ leggi, scrivi } = {}) {
  // In memoria, così l'apertura del menu sceglie senza aspettare il disco; la tengono fresca le scritture di qui e
  // `dimentica` (un backup importato).
  let tutti = null;
  let carica = null;

  const valido = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

  function carica_() {
    if (tutti) return Promise.resolve(tutti);
    if (!carica) {
      carica = Promise.resolve().then(() => leggi()).then((v) => { if (!tutti) tutti = valido(v); return tutti; }, () => {
        if (!tutti) tutti = {};
        return tutti;
      }).finally(() => { carica = null; });
    }
    return carica;
  }

  function piuUsata(menu, candidati, predefinita) {
    return scegli(tutti ? valido(tutti[menu]) : {}, candidati, predefinita);
  }

  async function conta(menu, url) {
    if (!menu || typeof url !== 'string' || !url) return;
    await carica_();
    const voci = { ...valido(tutti[menu]) };
    voci[url] = (Number(voci[url]) || 0) + 1;
    tutti = { ...tutti, [menu]: voci };
    try { await scrivi(tutti); } catch (_) {}
  }

  function dimentica() { tutti = null; return carica_(); }

  return { carica: carica_, piuUsata, conta, dimentica };
}

let predefinito = null;
// Quello dell'app, sul disco del profilo normale: anche una finestra in incognito sceglie dalle abitudini di sempre.
function servizio() {
  if (predefinito) return predefinito;
  const DiskStorage = require('../shim/storage');
  const chiave = () => globalThis.SN_CONST.STORAGE_KEYS.VOCI_MENU_USATE;
  predefinito = crea({
    leggi: () => DiskStorage.runNormale(() => DiskStorage.get(chiave())).then((r) => r && r[chiave()]),
    scrivi: (v) => DiskStorage.runNormale(() => DiskStorage.set({ [chiave()]: v })),
  });
  DiskStorage.onChanged((changes) => {
    const k = chiave();
    if (changes && changes[k] && changes[k].newValue !== predefinito._ultima) predefinito.dimentica();
  });
  const conta = predefinito.conta;
  predefinito.conta = async (menu, url) => {
    await conta(menu, url);
  };
  return predefinito;
}

module.exports = { scegli, crea, servizio };
