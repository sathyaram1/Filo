// #941 — fra le schede, accanto ai tasti della finestra, non c'è un tasto dei download: i download stanno nella
// home (carte a sinistra, «Download» in «altro») e nella pagina «Download» (#1112). Il pannello in alto si apre
// solo per una domanda su un programma e si chiude con la sua ×.

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

const paginaConLink = (srv, { openTab, testServer }) => testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina con link</title></head><body style="padding:40px">
  <a id="pdf" href="${srv.base}/report.pdf">Scarica il report</a>
  <a id="exe" href="${srv.base}/setup.exe">Scarica il programma</a></body></html>`);

// Ogni elemento della fila delle schede, fuori dalle schede stesse (una si può chiamare «Download»), che parli di
// download: nascosto o no, con il tasto tolto non ne resta nessuno.
const tastiDownload = (shell) => shell.evaluate(() => Array.from(document.querySelectorAll('.tab-row *'))
  .filter((el) => !el.closest('#tabs'))
  .filter((el) => /download|scaricament/i.test([el.id, el.getAttribute('class'), el.getAttribute('data-tip'),
    el.getAttribute('aria-label'), el.children.length ? '' : el.textContent].join(' ')))
  .map((el) => el.id || el.getAttribute('class')));

test('fra le schede non c’è un tasto dei download, e i download si trovano nella home e nella pagina «Download»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await paginaConLink(srv, { openTab, testServer });
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(shell, 'report.pdf'), { timeout: 20_000 }).toBe('completed');
    // Il clic ha avuto la sua risposta: l'avviso di fine scaricamento.
    await expect(shell.locator('.shell-notif-msg', { hasText: 'Scaricato: report.pdf' })).not.toHaveCount(0, { timeout: 8_000 });
    expect(await tastiDownload(shell)).toEqual([]);
    await expect(shell.locator('#dl-panel')).toHaveCount(0);
    // Accanto ai tasti della finestra resta solo la fila: l'ultimo elemento visibile prima di loro non è un tasto.
    const primaDeiTasti = await shell.evaluate(() => {
      const fila = document.querySelector('.tab-row');
      const tasti = fila.querySelector('.window-controls');
      const prima = Array.from(fila.children).filter((el) => el !== tasti && el.offsetParent !== null).pop();
      return prima ? prima.className : null;
    });
    expect(primaDeiTasti).toBe('tab-drag-spacer');
    await shell.screenshot({ path: join(SHOTS, 'download-941-fila.png') });

    await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
    const home = await finestraCon(app, 'filo://newtab');
    await expect(home.locator('.dash-carta[data-tipo="download"]', { hasText: 'report.pdf' })).toBeVisible({ timeout: 15_000 });
    expect(await tastiDownload(shell)).toEqual([]);
    const tessera = home.locator('#altro .dash-altro-app[data-id="scaricamenti"]');
    await expect(tessera).toHaveText('Download');
    await expect(home.getByText('Scaricamenti')).toHaveCount(0);
    await home.screenshot({ path: join(SHOTS, 'download-941-home.png') });

    await tessera.click();
    const dl = await finestraCon(app, 'filo://downloads');
    await expect(dl.locator('h1')).toHaveText('Download');
    await expect(dl.locator('#search')).toHaveAttribute('placeholder', 'Cerca tra i download…');
    await expect(shell.locator('#tabs .tab.active')).toContainText('Download');
    await expect(dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'report.pdf' }) })).toBeVisible({ timeout: 15_000 });
    expect(await tastiDownload(shell)).toEqual([]);
  } finally {
    await srv.close();
  }
});

test('nella home una domanda su un programma apre il pannello, che si chiude con la sua × e lascia la domanda alla carta', async ({ app, shell, openTab, testServer }) => {
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
    const domanda = shell.locator('#dl-panel .dl-row[data-chiede="1"]').filter({ has: shell.locator('.dl-row-ask-nome', { hasText: /^setup\.exe$/ }) });
    await expect(domanda).toBeVisible({ timeout: 10_000 });
    expect(await tastiDownload(shell)).toEqual([]);
    const chiudi = shell.locator('#dl-panel .dl-panel-chiudi');
    await expect(chiudi).toBeVisible();
    await chiudi.hover();
    await shell.screenshot({ path: join(SHOTS, 'download-941-pannello.png') });

    await chiudi.click();
    await expect(shell.locator('#dl-panel')).toBeHidden();
    // La domanda resta in sospeso, e nella home la dice la sua carta.
    expect(await statoDi(shell, 'setup.exe')).toBe('pending');
    await expect(home.locator('.dash-carta[data-tipo="download"]', { hasText: 'setup.exe' })).toContainText('aspetta il tuo sì', { timeout: 15_000 });
  } finally {
    await srv.close();
  }
});
