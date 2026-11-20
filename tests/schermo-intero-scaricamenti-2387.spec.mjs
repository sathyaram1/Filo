// #2387 — a schermo intero, chi porta il puntatore in alto per vedere le schede trova le schede: un pannello dei
// download rimasto aperto col solo elenco non fa scendere la pagina sotto un riquadro vuoto. Una domanda sui
// programmi invece resta, e appena risposta la pagina torna sotto le sole schede.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));
const SHOTS = join(process.cwd(), 'tests', '.shots');

async function apriServer() {
  const srv = createServer((req, res) => {
    const nome = String(req.url || '').split('?')[0].split('/').pop() || 'setup.exe';
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': EXE.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

const pagina = (base) => `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px;background:#f3ead8">
  <h1>Pagina a schermo intero</h1><a id="exe" href="${base}/setup.exe">Scarica il programma</a>
  <a id="exe2" href="${base}/installa.exe">Un altro programma</a></body></html>`;

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return {
    schermoIntero: !!tm.contentFullscreen,
    visibili: tm.schedeInAlto.visibili,
    alto: t.view.getBounds().y,
    fila: tm.chromeCompact ? tm.tabRowHeight : tm.shellHeight,
  };
});
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.setContentFullscreen(v);
}, on);
const statoDi = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (((r && r.items) || []).find((it) => it.filename === nome) || {}).state ?? null;
};
const domanda = (shell, nome) => shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: nome });

// Quello che l'utente vede: la shell con sopra la vista della scheda attiva dove sta.
async function foto(app, nome) {
  const b64 = await app.evaluate(async ({ BrowserWindow, nativeImage }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    const base = await w.webContents.capturePage();
    const { width, height } = base.getSize();
    const buf = Buffer.from(base.toBitmap());
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const b = t.view.getBounds();
    const img = (await t.view.webContents.capturePage()).resize({ width: b.width, height: b.height });
    const src = img.toBitmap();
    for (let y = 0; y < b.height && b.y + y < height; y++) {
      const da = y * b.width * 4;
      src.copy(buf, ((b.y + y) * width + b.x) * 4, da, da + Math.min(b.width, width - b.x) * 4);
    }
    return nativeImage.createFromBitmap(buf, { width, height }).toPNG().toString('base64');
  });
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, nome), Buffer.from(b64, 'base64'));
}

async function scopriSchede(app, page) {
  await page.mouse.move(400, 300);
  await page.mouse.move(400, 0);
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(true);
}
async function nascondiSchede(app, page) {
  await page.mouse.move(400, 300);
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 4000 }).toBe(false);
}

test('a schermo intero le schede scoperte non portano giù il pannello dei download rimasto aperto col solo elenco', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, pagina(srv.base));
    // Il pannello si apre da solo con la domanda, e risposta resta aperto con l'elenco.
    await page.locator('#exe').click();
    await expect(domanda(shell, 'setup.exe')).toBeVisible({ timeout: 20000 });
    await domanda(shell, 'setup.exe').locator('.dl-row-btn', { hasText: /^Scarica$/ }).click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    await expect(shell.locator('#dl-panel')).toBeVisible();
    const fuori = await stato(app);
    expect(fuori.alto, 'fuori dallo schermo intero il pannello fa ancora spazio sopra la pagina').toBeGreaterThan(fuori.fila);

    await schermoIntero(app, true);
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    await scopriSchede(app, page);
    const s = await stato(app);
    await foto(app, 'schermo-intero-scaricamenti-2387-schede.png');
    expect(s.alto, 'sotto le schede c’è subito la pagina, non un riquadro vuoto col pannello').toBe(s.fila);
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect(shell.locator('.tab').first()).toBeVisible();

    // Ancora uno sguardo, e uscendo dallo schermo intero il pannello non ricompare.
    await nascondiSchede(app, page);
    await scopriSchede(app, page);
    expect((await stato(app)).alto).toBe((await stato(app)).fila);
    await schermoIntero(app, false);
    await expect.poll(async () => (await stato(app)).schermoIntero).toBe(false);
    await expect.poll(async () => { const x = await stato(app); return x.alto === x.fila; }).toBe(true);
    await expect(shell.locator('#dl-panel')).toBeHidden();
  } finally {
    await srv.close();
  }
});

test('a schermo intero una domanda su un programma resta nel pannello, e risposta la pagina torna sotto le sole schede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, pagina(srv.base));
    await schermoIntero(app, true);
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    await page.locator('#exe2').click();
    await expect.poll(() => statoDi(shell, 'installa.exe'), { timeout: 20000 }).toBe('pending');

    await scopriSchede(app, page);
    const riga = domanda(shell, 'installa.exe');
    await expect(riga).toBeVisible({ timeout: 10000 });
    const s = await stato(app);
    await foto(app, 'schermo-intero-scaricamenti-2387-domanda.png');
    expect(s.alto, 'la domanda sta sopra la pagina, non sotto').toBeGreaterThan(s.fila);

    await shell.mouse.move(200, 10);
    await riga.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click({ timeout: 10000 });
    await expect.poll(() => statoDi(shell, 'installa.exe'), { timeout: 20000 }).toBe('completed');
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect.poll(async () => { const x = await stato(app); return !x.visibili || x.alto === x.fila; }).toBe(true);
  } finally {
    await srv.close();
  }
});
