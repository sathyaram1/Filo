// Verifica #2387 giro 1: a schermo intero, scoprendo le schede dopo uno scaricamento, la pagina sta subito sotto la
// fila e il pannello dei download non c'è; una domanda sui programmi invece si vede e, risposta, se ne va.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { premi } from '../../helpers/barra.mjs';

const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));
const PDF = Buffer.from('%PDF-1.4\n% finto\n' + 'x'.repeat(2048));

async function apriServer() {
  const srv = createServer((req, res) => {
    const nome = (String(req.url || '').split('?')[0].split('/').pop()) || 'file.pdf';
    const exe = !nome.endsWith('.pdf');
    res.writeHead(200, {
      'Content-Type': exe ? 'application/octet-stream' : 'application/pdf',
      'Content-Length': exe ? EXE.length : PDF.length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(exe ? EXE : PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { base, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const pagina = (base) => `<!doctype html><html><body style="margin:0;padding:80px 40px;height:1400px;font:16px sans-serif">
  <a id="exe" href="${base}/neoforge-installer.jar">Scarica il programma</a>
  <a id="exe2" href="${base}/altro-setup.exe">Scarica un altro programma</a>
  <a id="pdf" href="${base}/report.pdf">Scarica il report</a></body></html>`;

const stato = (app) => app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
  const tm = w._filoTabs;
  const t = tm.tabs.find((x) => x.id === tm.activeId);
  return { schermoIntero: !!tm.contentFullscreen, visibili: tm.schedeInAlto.visibili, alto: t.view.getBounds().y, fila: tm.chromeCompact ? tm.tabRowHeight : tm.shellHeight };
});
const schermoIntero = (app, on) => app.evaluate(({ BrowserWindow }, v) => {
  BrowserWindow.getAllWindows().find((w) => w._filoTabs && !w._filoIncognito)._filoTabs.setContentFullscreen(v);
}, on);
const statoDi = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (((r && r.items) || []).find((it) => it.filename === nome) || {}).state ?? null;
};
const domanda = (shell, nome) => shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: nome });

async function scopriSchede(app, page) {
  await page.mouse.move(400, 300);
  await page.mouse.move(400, 0);
  await expect.poll(async () => (await stato(app)).visibili, { timeout: 5000 }).toBe(true);
}

test('dopo un programma scaricato, a schermo intero le schede scoperte non portano giù la pagina sotto il pannello', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, pagina(srv.base));
    await page.locator('#exe').click();
    const d = domanda(shell, 'neoforge-installer.jar');
    await expect(d).toBeVisible({ timeout: 15000 });
    await d.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click();
    await expect.poll(() => statoDi(shell, 'neoforge-installer.jar'), { timeout: 20000 }).toBe('completed');

    // Il passo dell'utente: schermo intero con la scorciatoia, poi il puntatore in alto per vedere le schede.
    await premi(app, 'shell', 'F11');
    await expect.poll(async () => (await stato(app)).schermoIntero, { timeout: 5000 }).toBe(true);
    await scopriSchede(app, page);
    const s = await stato(app);
    expect(s.alto, 'la pagina sta subito sotto la fila delle schede').toBe(s.fila);
    await expect(shell.locator('#dl-panel')).toBeHidden();

    // Uscito dallo schermo intero non resta spazio vuoto sopra la pagina.
    await schermoIntero(app, false);
    await expect.poll(async () => { const x = await stato(app); return x.alto - x.fila; }, { timeout: 5000 }).toBe(0);
  } finally {
    await srv.close();
  }
});

test('a schermo intero una domanda su un programma si vede scoprendo le schede, e risposta la pagina risale', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, pagina(srv.base));
    await schermoIntero(app, true);
    await expect.poll(async () => (await stato(app)).alto).toBe(0);
    await page.locator('#exe2').click();
    await expect.poll(() => statoDi(shell, 'altro-setup.exe'), { timeout: 20000 }).toBe('pending');

    await scopriSchede(app, page);
    const d = domanda(shell, 'altro-setup.exe');
    await expect(d).toBeVisible({ timeout: 10000 });
    const s = await stato(app);
    expect(s.alto, 'la domanda fa scendere la pagina per non restarle sotto').toBeGreaterThan(s.fila);

    await d.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click();
    await expect.poll(() => statoDi(shell, 'altro-setup.exe'), { timeout: 20000 }).toBe('completed');
    await expect(shell.locator('#dl-panel')).toBeHidden({ timeout: 5000 });
    await expect.poll(async () => { const x = await stato(app); return x.alto - (x.visibili ? x.fila : 0); }, { timeout: 5000 }).toBe(0);

    // Un PDF scaricato dopo non riapre niente.
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(shell, 'report.pdf'), { timeout: 20000 }).toBe('completed');
    await scopriSchede(app, page);
    const s2 = await stato(app);
    expect(s2.alto).toBe(s2.fila);
    await expect(shell.locator('#dl-panel')).toBeHidden();
  } finally {
    await srv.close();
  }
});

test('esplora: a schermo intero, senza scoprire le schede, la domanda su un programma sta sopra la pagina', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, pagina(srv.base));
    await schermoIntero(app, true);
    await page.mouse.move(400, 400);
    await page.locator('#exe2').click();
    await expect.poll(() => statoDi(shell, 'altro-setup.exe'), { timeout: 20000 }).toBe('pending');
    await expect(domanda(shell, 'altro-setup.exe')).toBeVisible({ timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1500));
    const s = await stato(app);
    expect(s.alto, 'la pagina lascia scoperta la domanda').toBeGreaterThan(0);
  } finally {
    await srv.close();
  }
});

test('entrando e uscendo di fretta dallo schermo intero col pannello aperto la pagina non resta sotto uno spazio vuoto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await testServer.openReady(openTab, pagina(srv.base));
    await page.locator('#exe').click();
    const d = domanda(shell, 'neoforge-installer.jar');
    await expect(d).toBeVisible({ timeout: 15000 });
    await d.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click();
    await expect.poll(() => statoDi(shell, 'neoforge-installer.jar'), { timeout: 20000 }).toBe('completed');
    for (let i = 0; i < 4; i++) { await schermoIntero(app, true); await schermoIntero(app, false); }
    await schermoIntero(app, true);
    await scopriSchede(app, page);
    const s = await stato(app);
    expect(s.alto).toBe(s.fila);
    await schermoIntero(app, false);
    await expect.poll(async () => { const x = await stato(app); return x.alto - x.fila; }, { timeout: 5000 }).toBe(0);
  } finally {
    await srv.close();
  }
});
