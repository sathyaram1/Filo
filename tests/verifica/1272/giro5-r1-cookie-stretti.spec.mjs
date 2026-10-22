// Verifica #1272, giro 5: i byte di un'immagine che Filo scarica da solo per la pagina (Aiuto, menu) portano i cookie
// che il sito dell'immagine ha chiesto di mandare solo dal proprio sito (SameSite), che la pagina stessa non manda.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { nelMondoDiFilo } from '../../helpers/confirm.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('r1 la foto di un altro sito scaricata per la pagina non porta i cookie che quel sito riserva a sé', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const visti = [];
  const foto = createServer((req, res) => {
    visti.push({ percorso: req.url, cookie: String(req.headers.cookie || ''), origin: String(req.headers.origin || '') });
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store' });
    res.end(PNG);
  });
  await new Promise((r) => foto.listen(0, '127.0.0.1', r));
  const Q = foto.address().port;
  const src = `http://localhost:${Q}/foto.png`;
  try {
    const page = await openTab(testServer.html(`<title>p</title><img id="foto" src="${src}?dalla-pagina" width="40" height="40">`));
    await page.waitForFunction(() => { const i = document.getElementById('foto'); return i.complete && i.naturalWidth > 0; });
    // Il cookie del sito della foto, riservato al suo sito (come una sessione di posta o di banca).
    await app.evaluate(async ({ BrowserWindow }, url) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      const t = w._filoTabs.tabs.find((x) => /^http:\/\/127\.0\.0\.1/.test(x.view.webContents.getURL()));
      const ses = t.view.webContents.session;
      await ses.cookies.set({ url, name: 'stretto', value: 's1', sameSite: 'strict' });
      await ses.cookies.set({ url, name: 'medio', value: 'l1', sameSite: 'lax' });
    }, `http://localhost:${Q}/`);
    // Controprova: la pagina stessa che ricarica la foto non li manda.
    await page.evaluate((u) => new Promise((ok) => { const i = new Image(); i.onload = i.onerror = ok; i.src = u; }), `${src}?pagina-di-nuovo`);
    const dallaPagina = visti.find((v) => v.percorso.includes('pagina-di-nuovo'));
    expect(dallaPagina, 'la pagina ha richiesto la foto').toBeTruthy();
    expect(dallaPagina.cookie).toBe('');

    const host = new URL(testServer.origin).hostname;
    const letta = await nelMondoDiFilo(app, host,
      `SN_ACTIONS.scaricaImmagine(${JSON.stringify(src + '?per-filo')}, document.getElementById('foto')).then((d) => d.slice(0, 22), (e) => 'errore: ' + e.message)`);
    expect(letta).toBe('data:image/png;base64,');
    const dalMain = visti.filter((v) => v.percorso.includes('per-filo') && !v.origin);
    expect(dalMain.length).toBeGreaterThan(0);
    expect(dalMain.map((v) => v.cookie), 'Filo per la pagina manda quello che manderebbe la pagina').toEqual(dalMain.map(() => ''));
  } finally {
    try { foto.closeAllConnections(); } catch (_) {}
    await new Promise((r) => foto.close(r));
  }
});
