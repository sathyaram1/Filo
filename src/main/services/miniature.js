// Miniature di «Aperti per dopo»: ogni anteprima che entra nel file dei dati passa da qui e ne esce piccola (#839).
// Non tocca le catture a piena risoluzione (lo Screenshot del menu): vale solo per ciò che si conserva.
// La prova sta in tests/save-thumb-size.spec.mjs.

const { nativeImage } = require('electron');

const LARGHEZZA = 320;
// Il file dei dati si riscrive intero a ogni modifica: una miniatura oltre questa soglia la paga ogni scrittura.
const MAX_BYTE = 60 * 1024;
const QUALITA = [75, 60, 45];

function isDataImage(v) {
  return typeof v === 'string' && /^data:image\//i.test(v);
}

function byteDi(dataUrl) {
  const i = dataUrl.indexOf(',');
  return Math.floor((dataUrl.length - i - 1) * 3 / 4);
}

function grande(v) {
  return isDataImage(v) && byteDi(v) > MAX_BYTE;
}

// Quello che non si sa decodificare torna com'era: una miniatura persa non si ricattura.
function perLista(dataUrl) {
  if (!isDataImage(dataUrl)) return dataUrl || '';
  let img;
  try { img = nativeImage.createFromDataURL(dataUrl); } catch (_) { return dataUrl; }
  if (!img || img.isEmpty()) return dataUrl;
  const { width, height } = img.getSize();
  // La scheda (16:9, dall'alto) e la tessera della categoria (4:3) non mostrano altro: di una pagina lunga si tiene la cima.
  const altezzaMax = Math.round(width * 3 / 4);
  if (width <= LARGHEZZA && height <= altezzaMax && byteDi(dataUrl) <= MAX_BYTE) return dataUrl;
  if (height > altezzaMax) img = img.crop({ x: 0, y: 0, width, height: altezzaMax });
  if (width > LARGHEZZA) img = img.resize({ width: LARGHEZZA, quality: 'best' });
  let out = dataUrl;
  for (const q of QUALITA) {
    out = 'data:image/jpeg;base64,' + img.toJPEG(q).toString('base64');
    if (byteDi(out) <= MAX_BYTE) break;
  }
  return out;
}

// Le miniature grandi salvate prima di #839 (o arrivate da un backup): ognuna si rimpicciolisce una volta,
// perché dopo è piccola e la passata la salta. Si modificano le voci VIVE, così una pagina salvata o tolta
// mentre la passata lavora resta com'è.
async function rimpicciolisciSalvate() {
  const { STORAGE_KEYS } = globalThis.SN_CONST;
  const store = globalThis.chrome.storage.local;
  let fatte = 0;
  for (const [chiave, campo] of [[STORAGE_KEYS.SAVED_PAGES, 'thumbnail'], [STORAGE_KEYS.CATEGORIES, 'thumbnailUrl']]) {
    const prima = (await store.get(chiave))[chiave];
    if (!Array.isArray(prima)) continue;
    const nuove = new Map();
    for (const voce of prima) {
      const vecchia = voce && voce[campo];
      if (!grande(vecchia) || nuove.has(vecchia)) continue;
      // Una alla volta: decodificare una schermata intera ferma il processo principale per qualche decina di ms.
      await new Promise((r) => setImmediate(r));
      const piccola = perLista(vecchia);
      if (piccola !== vecchia) nuove.set(vecchia, piccola);
    }
    if (!nuove.size) continue;
    const ora = (await store.get(chiave))[chiave];
    if (!Array.isArray(ora)) continue;
    let cambiate = 0;
    for (const voce of ora) {
      if (voce && nuove.has(voce[campo])) { voce[campo] = nuove.get(voce[campo]); cambiate++; }
    }
    if (!cambiate) continue;
    await store.set({ [chiave]: ora });
    fatte += cambiate;
  }
  return fatte;
}

module.exports = { perLista, grande, rimpicciolisciSalvate, LARGHEZZA, MAX_BYTE };
