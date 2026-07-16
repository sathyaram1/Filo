// "Salva per dopo" dal menu del tasto destro: la miniatura salvata NON deve
// contenere il menu di Filo (#325). Il menu veniva rimosso dal DOM in modo
// sincrono al click, ma la cattura fotografava il frame del compositor non
// ancora ridisegnato: il menu finiva "stampato" dentro la thumbnail persistita.
//
// Strategia di assert deterministica: la pagina di test è COMPLETAMENTE
// bianca. Se la miniatura salvata contiene pixel scuri (testo/icone/bordi del
// menu), il menu è finito nella cattura → rosso. Senza il fix questo test
// fallisce (migliaia di pixel scuri); col fix la miniatura è bianca.

import { test, expect } from './fixtures/electron.mjs';

test('la miniatura salvata dal menu tasto destro non contiene il menu', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(
    openTab,
    `<!doctype html><html><head><title>Pagina bianca</title></head>
     <body style="margin:0;height:100vh;background:#fff"></body></html>`,
  );

  // Apre il menu del tasto destro al centro della pagina e salva con l'icona
  // "Salva per dopo" nella fila in alto (il cammino principale dell'utente).
  await page.click('body', { button: 'right', position: { x: 400, y: 300 } });
  const btn = page.locator('.sn-menu [data-sn-icon-id="saveForLater"]');
  await expect(btn).toBeVisible();
  await btn.click();
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
  // La pagina è bianca: pixel scuri = menu (testo, icone, bordi) dentro la
  // miniatura. Tolleranza minima per rumore di encoding.
  expect(stats.dark, `pixel scuri nella miniatura: ${stats.dark}/${stats.total}`).toBeLessThan(50);
  // Anche il fondo beige del menu e la sua ombra devono essere assenti:
  // la quota di pixel non-bianchi deve restare trascurabile (<0.5%).
  expect(stats.nonWhite / stats.total, `pixel non bianchi: ${stats.nonWhite}/${stats.total}`).toBeLessThan(0.005);
});
