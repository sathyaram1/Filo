// #325 — la miniatura di «Salva per dopo» è solo la pagina: niente di Filo dentro (il menu ci finiva stampato, la barra
// laterale da cui si salva non deve). La pagina è tutta bianca: pixel scuri nella miniatura sono un pezzo di Filo.

import { test, expect } from './fixtures/electron.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';

test('la miniatura salvata dalla barra laterale non contiene niente di Filo', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(
    openTab,
    `<!doctype html><html><head><title>Pagina bianca</title></head>
     <body style="margin:0;height:100vh;background:#fff"></body></html>`,
  );

  await premiNellaBarra(app, 'saveForLater');
  // Attende che il salvataggio (cattura + persistenza) sia concluso. La tab
  // viene chiusa automaticamente ~600ms dopo il toast di conferma.
  await page.waitForTimeout(2000).catch(() => {});

  const home = await openTab('filo://home/home.html');
  await home.waitForLoadState('domcontentloaded');

  // Recupera la thumbnail persistita e la analizza pixel per pixel.
  const stats = await home.evaluate(async () => {
    const r = await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_SAVED_PAGES });
    const pages = (r && r.pages) || [];
    if (!pages.length) return { error: 'nessuna pagina salvata' };
    const thumb = pages[0].thumbnail || '';
    if (!thumb.startsWith('data:image/')) return { error: 'thumbnail assente', thumb: thumb.slice(0, 40) };
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = thumb; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0; let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (min < 200) dark++;
      if (min < 245) nonWhite++;
    }
    return { w: canvas.width, h: canvas.height, total: data.length / 4, dark, nonWhite };
  });

  expect(stats.error, stats.error || '').toBeUndefined();
  expect(stats.total).toBeGreaterThan(0);
  // Tolleranza minima per il rumore della codifica.
  expect(stats.dark, `pixel scuri nella miniatura: ${stats.dark}/${stats.total}`).toBeLessThan(50);
  // Anche un fondo beige e un'ombra di Filo, che scuri non sono.
  expect(stats.nonWhite / stats.total, `pixel non bianchi: ${stats.nonWhite}/${stats.total}`).toBeLessThan(0.005);
});
