// Miniature di «Aperti per dopo»: nel file dei dati entra solo un'anteprima piccola (JPEG ~320 px, #839).
// Il processo principale non decodifica immagini che non ha prodotto lui: le catture le ha in mano come bitmap,
// i dati vecchi e i backup li rimpicciolisce una finestra nascosta e isolata. Prove: tests/save-thumb-size.spec.mjs.

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

// Alla porta dei dati: un'anteprima arrivata come testo passa solo se è già piccola.
function accettabile(v) {
  return isDataImage(v) && !grande(v) ? v : '';
}

// La scheda (16:9, dall'alto) e la tessera della categoria (4:3) non mostrano altro: di una pagina lunga si tiene la cima.
function daCattura(img) {
  if (!img || img.isEmpty()) return '';
  const { width, height } = img.getSize();
  const altezzaMax = Math.round(width * 3 / 4);
  if (height > altezzaMax) img = img.crop({ x: 0, y: 0, width, height: altezzaMax });
  if (width > LARGHEZZA) img = img.resize({ width: LARGHEZZA, quality: 'best' });
  for (const q of QUALITA) {
    const out = 'data:image/jpeg;base64,' + img.toJPEG(q).toString('base64');
    if (byteDi(out) <= MAX_BYTE) return out;
  }
  return '';
}

// Stesso taglio di daCattura, ma col canvas della pagina isolata.
const CODICE_PAGINA = (src) => `(async (src) => {
  const img = new Image(); img.src = src; await img.decode();
  const w = img.naturalWidth, h = img.naturalHeight;
  const hSrc = Math.min(h, Math.round(w * 3 / 4));
  const W = Math.min(${LARGHEZZA}, w), H = Math.max(1, Math.round(hSrc * W / w));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, hSrc, 0, 0, W, H);
  let out = '';
  for (const q of ${JSON.stringify(QUALITA.map((q) => q / 100))}) {
    out = c.toDataURL('image/jpeg', q);
    if ((out.length - out.indexOf(',') - 1) * 3 / 4 <= ${MAX_BYTE}) break;
  }
  return out;
})(${JSON.stringify(src)})`;

function entro(promessa, ms) {
  let timer;
  const scadenza = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([promessa, scadenza]).finally(() => clearTimeout(timer));
}

async function conPaginaIsolata(lavoro) {
  const { BrowserWindow } = require('electron');
  const win = new BrowserWindow({
    show: false, width: 64, height: 64, skipTaskbar: true, focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'filo-miniature' },
  });
  try {
    await entro(win.loadURL('data:text/html;charset=utf-8,'), 15000);
    return await lavoro(async (src) => {
      const out = await entro(win.webContents.executeJavaScript(CODICE_PAGINA(src)), 15000);
      return typeof out === 'string' && out.startsWith('data:image/jpeg;base64,') && !grande(out) ? out : '';
    });
  } finally {
    try { win.destroy(); } catch (_) {}
  }
}

// Le miniature grandi salvate prima di #839 (o arrivate da un backup): ognuna si rimpicciolisce una volta,
// perché dopo è piccola e la passata la salta. Quella che non si decodifica resta com'era: non si ricattura.
// Si modificano le voci VIVE, così una pagina salvata o tolta mentre la passata lavora resta com'è.
async function rimpicciolisciSalvate() {
  const { STORAGE_KEYS } = globalThis.SN_CONST;
  const store = globalThis.chrome.storage.local;
  const campi = [[STORAGE_KEYS.SAVED_PAGES, 'thumbnail'], [STORAGE_KEYS.CATEGORIES, 'thumbnailUrl']];
  const daFare = new Set();
  for (const [chiave, campo] of campi) {
    const voci = (await store.get(chiave))[chiave];
    if (Array.isArray(voci)) for (const v of voci) if (v && grande(v[campo])) daFare.add(v[campo]);
  }
  if (!daFare.size) return 0;
  const nuove = new Map();
  await conPaginaIsolata(async (rimpicciolisci) => {
    for (const vecchia of daFare) {
      try {
        const piccola = await rimpicciolisci(vecchia);
        if (piccola) nuove.set(vecchia, piccola);
      } catch (_) { /* illeggibile: resta com'era */ }
    }
  });
  let fatte = 0;
  for (const [chiave, campo] of campi) {
    const ora = (await store.get(chiave))[chiave];
    if (!Array.isArray(ora)) continue;
    let cambiate = 0;
    for (const v of ora) {
      if (v && nuove.has(v[campo])) { v[campo] = nuove.get(v[campo]); cambiate++; }
    }
    if (!cambiate) continue;
    await store.set({ [chiave]: ora });
    fatte += cambiate;
  }
  return fatte;
}

module.exports = { daCattura, accettabile, grande, rimpicciolisciSalvate, LARGHEZZA, MAX_BYTE };
