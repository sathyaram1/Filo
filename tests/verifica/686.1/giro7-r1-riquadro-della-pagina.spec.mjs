// #686.1 — giro 7, rilievo 1: il riquadro con la percentuale vive ancora nel
// documento della pagina, e la pagina ne decide fuoco, posto in cima e stile.
// Qui si fa quello che fa l'utente e si guarda cosa vede e cosa ottiene.

import { test, expect } from '../../fixtures/electron.mjs';

async function percentOf(app, page) {
  const url = await page.evaluate(() => location.href);
  const f = await app.evaluate(({ webContents }, u) => {
    for (const wc of webContents.getAllWebContents()) {
      let here = '';
      try { here = wc.getURL(); } catch (_) {}
      if (here === u) return wc.getZoomFactor();
    }
    return null;
  }, url);
  return f == null ? null : Math.round(f * 100);
}

async function cliccaIlNumero(page) {
  const box = await page.locator('#__filo-zoom-percent').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test('il sito porta il fuoco in un suo riquadro mentre si batte il numero: il numero battuto vale lo stesso', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>un sito</h1>
    <iframe id=f srcdoc="<input id=i>" style="width:300px;height:80px"></iframe><script>
    addEventListener('focusin', (e) => {
      if (e.target.id !== '__filo-zoom-percent') return;
      setTimeout(() => { const f = document.getElementById('f'); f.contentWindow.focus(); f.contentDocument.getElementById('i').focus(); }, 0);
    }, true);
    </script></body></html>`);
  await page.waitForTimeout(800);
  await page.mouse.click(600, 400, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  await cliccaIlNumero(page);
  await page.waitForTimeout(300);
  await page.keyboard.type('150');
  await page.keyboard.press('Enter');
  await expect.poll(async () => percentOf(app, page), { timeout: 3000 }).toBe(150);
});

test('un livello in primo piano del sito aperto dopo il riquadro non lo copre', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="height:4000px"><h1>sito con notifica</h1>
    <div id=t popover=manual style="position:fixed;inset:auto;top:8px;right:8px;margin:0;width:320px;padding:16px;background:#335;color:#fff">Nuovo messaggio</div></body></html>`);
  await page.waitForTimeout(600);
  await page.mouse.click(600, 500, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  // Una notifica del sito che arriva mentre l'utente sta zoomando.
  await page.evaluate(() => document.getElementById('t').showPopover());
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(300);
  const visto = await page.evaluate(() => {
    const b = document.getElementById('__filo-zoom-badge');
    const r = b.getBoundingClientRect();
    const sopra = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!(sopra && b.contains(sopra));
  });
  expect(visto, 'al posto del riquadro si vede la notifica del sito').toBe(true);
});

test('dentro un dialogo modale il riquadro non prende lo stile del testo del sito', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><style>
    dialog { text-transform: uppercase; letter-spacing: 3px; text-shadow: 0 0 2px red; }
  </style></head><body style="height:4000px"><h1>sito con avviso</h1><dialog id=d><p>Accetti i cookie?</p><button>Sì</button></dialog>
  <script>document.getElementById('d').showModal();</script></body></html>`);
  await page.waitForTimeout(600);
  await page.mouse.click(600, 700, { button: 'middle' });
  await expect(page.locator('#__filo-zoom-badge')).toBeVisible();
  const stile = await page.evaluate(() => {
    const s = getComputedStyle(document.getElementById('__filo-zoom-badge'));
    return { textTransform: s.textTransform, letterSpacing: s.letterSpacing, textShadow: s.textShadow };
  });
  expect(stile).toEqual({ textTransform: 'none', letterSpacing: 'normal', textShadow: 'none' });
});
