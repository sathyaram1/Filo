// Le immagini nate su una pagina delicata (#1274): screenshot e copie fermati lì restano fuori dal modello che descrive
// anche incollati su un altro sito, perché conta la pagina da cui vengono. Su disco solo l'impronta dei pixel, mai
// l'immagine, e dall'incognito niente. Prove: tests/unit/immaginiDelicate.test.mjs, tests/pagine-delicate.spec.mjs.
'use strict';

// Dieci volte la cronologia appunti: oltre, si dimentica la più vecchia, che non sta più né lì né negli appunti.
const MAX = 500;
const ESADECIMALE = /^[0-9a-f]{64}$/;

/** `impronta(dataUrl | Buffer)` → '' se non si decodifica; `storage` { getRaw, setRaw }; `appunti()` → byte o null. */
function crea({ impronta, storage, appunti, chiave = 'filo_immagini_delicate' }) {
  const viste = new Set();
  // Quelle da tenere dopo un riavvio, dalla più vecchia.
  let salvate = [];
  let caricate = null;
  let lette = false;
  let coda = Promise.resolve();

  function carica() {
    if (!caricate) {
      caricate = Promise.resolve().then(async () => {
        const lista = await storage().getRaw(chiave, []);
        salvate = (Array.isArray(lista) ? lista : []).filter((k) => typeof k === 'string' && ESADECIMALE.test(k));
        for (const k of salvate) viste.add(k);
        lette = true;
      }).catch(() => { caricate = null; });
    }
    return caricate;
  }

  const di = (x) => { try { return (x && impronta(x)) || ''; } catch (_) { return ''; } };

  // L'immagine e quella negli appunti in quel momento: gli appunti di sistema la ricodificano, e su Windows i pixel
  // trasparenti tornano diversi. Se negli appunti c'è altro, resta fuori anche quello: si sbaglia dalla parte giusta.
  async function segna(dataUrl, { incognito = false } = {}) {
    let negliAppunti = null;
    try { negliAppunti = await appunti(); } catch (_) { negliAppunti = null; }
    const nuove = [...new Set([di(dataUrl), di(negliAppunti)])].filter((k) => k && !viste.has(k));
    if (!nuove.length) return;
    for (const k of nuove) viste.add(k);
    if (incognito) return;
    await carica();
    // Senza aver letto quelle già salvate, scrivere le cancellerebbe.
    if (!lette) return;
    salvate = [...salvate.filter((k) => !nuove.includes(k)), ...nuove].slice(-MAX);
    const dati = salvate.slice();
    coda = coda.then(() => storage().setRaw(chiave, dati)).catch(() => {});
    await coda;
  }

  async function daDelicata(dataUrl) {
    await carica();
    if (!viste.size) return false;
    const k = di(dataUrl);
    return Boolean(k) && viste.has(k);
  }

  return { segna, daDelicata };
}

let diFilo = null;
function perFilo() {
  if (diFilo) return diFilo;
  diFilo = crea({
    impronta: require('./improntaPixel').impronta,
    storage: () => globalThis.SN_STORAGE,
    appunti: () => require('./appuntiTolti').immagineNegliAppunti(),
    chiave: (globalThis.SN_CONST && globalThis.SN_CONST.STORAGE_KEYS.IMMAGINI_DELICATE) || 'filo_immagini_delicate',
  });
  return diFilo;
}

module.exports = { crea, perFilo, MAX };
