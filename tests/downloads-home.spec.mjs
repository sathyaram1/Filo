// #1112 — nella home i download si vedono già (carte a sinistra, «Download» in «altro»): lì l'indicatore in alto
// non c'è, nelle altre schede sì, e compare solo col suo pannello aperto. La pagina si chiama «Download» ovunque.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'tests', '.shots');

const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(2048));
const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));

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
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

async function finestraCon(app, prefisso) {
  const scadenza = Date.now() + 15_000;
  while (Date.now() < scadenza) {
    const w = app.windows().find((x) => { try { return x.url().startsWith(prefisso); } catch (_) { return false; } });
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`nessuna finestra su ${prefisso}`);
}

const statoDi = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return (((r && r.items) || []).find((it) => it.filename === nome) || {}).state ?? null;
};

const paginaConLink = (srv, { openTab, testServer }) => testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
  <a id="pdf" href="${srv.base}/report.pdf">Scarica il report</a>
  <a id="exe" href="${srv.base}/setup.exe">Scarica il programma</a></body></html>`);

test('nella home l’indicatore dei download non c’è, nelle altre schede sì, e la pagina si chiama «Download»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await paginaConLink(srv, { openTab, testServer });
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(shell, 'report.pdf'), { timeout: 20_000 }).toBe('completed');
    const indicatore = shell.locator('#dl-indicator');
    await expect(indicatore).toBeVisible();
    await expect(indicatore).toHaveAttribute('data-tip', 'Download');

    await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
    const home = await finestraCon(app, 'filo://newtab');
    await expect(indicatore).toBeHidden();
    await expect(home.locator('.dash-carta[data-tipo="download"]', { hasText: 'report.pdf' })).toBeVisible({ timeout: 15_000 });
    const tessera = home.locator('#altro .dash-altro-app[data-id="scaricamenti"]');
    await expect(tessera).toHaveText('Download');
    await expect(home.getByText('Scaricamenti')).toHaveCount(0);
    await shell.screenshot({ path: join(SHOTS, 'download-1112-barra-home.png') });

    // Tornando alla pagina l'indicatore torna: fuori dalla home è l'unico posto che mostra i download.
    await shell.locator('#tabs .tab', { hasText: 'Pagina' }).or(shell.locator('#tabs .tab:not(.active)').last()).first().click();
    await expect(indicatore).toBeVisible();

    await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
    await expect(indicatore).toBeHidden();
    await tessera.click();
    const dl = await finestraCon(app, 'filo://downloads');
    await expect(dl.locator('h1')).toHaveText('Download');
    await expect(dl.locator('#search')).toHaveAttribute('placeholder', 'Cerca tra i download…');
    await expect(shell.locator('#tabs .tab.active')).toContainText('Download');
    await expect(indicatore).toBeVisible();
    await indicatore.click();
    await expect(shell.locator('#dl-panel .dl-panel-title')).toHaveText('Download');

    // Il pannello aperto a mano non si perde passando alla home: l'indicatore resta finché lo chiudi.
    await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
    await expect(shell.locator('#tabs .tab.active')).toContainText('Home');
    await expect(shell.locator('#dl-panel')).toBeVisible();
    await expect(indicatore).toBeVisible();
    await indicatore.click();
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect(indicatore).toBeHidden();
  } finally {
    await srv.close();
  }
});

test('nella home una domanda su un programma apre il pannello con l’indicatore, che se ne va quando lo chiudi', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await paginaConLink(srv, { openTab, testServer });
    await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
    const home = await finestraCon(app, 'filo://newtab');
    await expect(shell.locator('#tabs .tab.active')).toContainText('Home');

    // La scheda in secondo piano fa partire un programma mentre si guarda la home.
    await page.evaluate(() => document.getElementById('exe').click());
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20_000 }).toBe('pending');
    const domanda = shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: '«setup.exe»' });
    await expect(domanda).toBeVisible({ timeout: 10_000 });
    const indicatore = shell.locator('#dl-indicator');
    await expect(indicatore).toBeVisible();
    await expect(indicatore.locator('#dl-ind-count')).toHaveText('1');

    await indicatore.click();
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect(indicatore).toBeHidden();
    // La domanda resta in sospeso, e nella home la dice la sua carta.
    expect(await statoDi(shell, 'setup.exe')).toBe('pending');
    await expect(home.locator('.dash-carta[data-tipo="download"]', { hasText: 'setup.exe' })).toContainText('aspetta il tuo sì', { timeout: 15_000 });
  } finally {
    await srv.close();
  }
});
