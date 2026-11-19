// #2595 — a schermo intero una domanda che nasce sopra la pagina (scaricare un programma, un permesso del sito) si vede
// subito, senza portare il puntatore sul bordo alto: la pagina scende sotto la domanda finché non si risponde, poi torna
// a tutto schermo. Il pannello col solo elenco resta fuori (#2387: tests/schermo-intero-scaricamenti-2387.spec.mjs).

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
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

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return { schermoIntero: !!tm.contentFullscreen, visibili: tm.schedeInAlto.visibili, alto: t.view.getBounds().y };
});
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.setContentFullscreen(v);
}, on);
const statoDi = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (((r && r.items) || []).find((it) => it.filename === nome) || {}).state ?? null;
};

// La domanda è scoperta quando la vista della pagina comincia sotto il suo bordo basso.
async function scoperta(app, locator) {
  const box = await locator.boundingBox();
  if (!box) return false;
  return (await stato(app)).alto >= Math.floor(box.y + box.height);
}

async function foto(app, nome) {
  mkdirSync(SHOTS, { recursive: true });
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return (await w.webContents.capturePage()).toPNG().toString('base64');
  });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(SHOTS, nome), Buffer.from(b64, 'base64'));
}

test('a schermo intero «scaricarlo?» di un programma si vede senza cercare le schede, e risposto la pagina torna su', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><body style="margin:0;padding:40px;font:16px sans-serif;background:#f3ead8">
      <a id="exe" href="${srv.base}/setup.exe">Scarica il programma</a></body>`);
    await schermoIntero(app, true);
    await expect.poll(async () => (await stato(app)).alto).toBe(0);

    await page.mouse.move(300, 300);
    await page.locator('#exe').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');
    const riga = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: 'setup.exe' });
    await expect(riga).toBeVisible({ timeout: 10000 });
    await expect.poll(() => scoperta(app, riga), { timeout: 5000 }).toBe(true);
    expect((await stato(app)).visibili, 'nessuno ha portato il puntatore in alto').toBe(false);
    await foto(app, 'schermo-intero-domanda-2595-scarica.png');

    await riga.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click({ timeout: 10000 });
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect.poll(async () => (await stato(app)).alto, { timeout: 5000 }).toBe(0);
    expect((await stato(app)).schermoIntero).toBe(true);
  } finally {
    await srv.close();
  }
});

test('a schermo intero la domanda di un permesso del sito si vede subito, e risposta la pagina torna a tutto schermo', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  const page = await testServer.openReady(openTab, `<!doctype html><meta charset="utf-8"><title>Posta</title>
    <body style="margin:0;background:#f3ead8"><button id="attiva" style="position:fixed;top:200px;left:200px">Attiva le notifiche</button>
    <script>document.getElementById('attiva').addEventListener('click', () => Notification.requestPermission().then((x) => { document.title = 'esito:' + x; }));</script></body>`);
  await schermoIntero(app, true);
  await expect.poll(async () => (await stato(app)).alto).toBe(0);

  await page.locator('#attiva').click();
  const barra = shell.locator('#permesso-bar');
  await expect(barra).toBeVisible({ timeout: 10000 });
  await expect(barra).toContainText('vuole mandarti notifiche');
  await expect.poll(() => scoperta(app, barra), { timeout: 5000 }).toBe(true);
  expect((await stato(app)).visibili).toBe(false);
  await foto(app, 'schermo-intero-domanda-2595-permesso.png');

  await barra.getByRole('button', { name: 'Consenti', exact: true }).click({ timeout: 10000 });
  await expect.poll(() => page.title(), { timeout: 10000 }).toBe('esito:granted');
  await expect(barra).toBeHidden();
  await expect.poll(async () => (await stato(app)).alto, { timeout: 5000 }).toBe(0);
});
