// I download nella home (carte a sinistra, «Download» in «altro») e nella pagina «Download»; nella fila in alto
// nessun tasto (#941, prima #1112), e il pannello si apre solo per una domanda sui programmi.

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

// #941 — accanto ai tasti della finestra non c'è un tasto dei download, su nessuna scheda: i download stanno
// nella home e nella pagina Download, l'avanzamento sull'icona nella barra delle applicazioni. Si cerca anche
// per nome, così un tasto rinato con un altro id resta rosso.
const tastoDownloadInAlto = (shell) => shell.locator('.tab-row #dl-indicator, .tab-row [data-tip="Download"], .tab-row [aria-label="Download"]');

test('nella fila in alto non c’è un tasto dei download, né su una pagina né nella home, e la pagina si chiama «Download»', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const page = await paginaConLink(srv, { openTab, testServer });
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(shell, 'report.pdf'), { timeout: 20_000 }).toBe('completed');
    await expect(shell.locator('.shell-notif-msg')).toContainText('Scaricato', { timeout: 8000 });
    await expect(tastoDownloadInAlto(shell)).toHaveCount(0);
    // Un file qualunque non apre niente sopra la pagina: il pannello è per le domande.
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await shell.locator('.tab-row').screenshot({ path: join(SHOTS, 'download-941-fila-pagina.png') });

    await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
    const home = await finestraCon(app, 'filo://newtab');
    await expect(tastoDownloadInAlto(shell)).toHaveCount(0);
    await expect(home.locator('.dash-carta[data-tipo="download"]', { hasText: 'report.pdf' })).toBeVisible({ timeout: 15_000 });
    const tessera = home.locator('#altro .dash-altro-app[data-id="scaricamenti"]');
    await expect(tessera).toHaveText('Download');
    await expect(home.getByText('Scaricamenti')).toHaveCount(0);
    await home.screenshot({ path: join(SHOTS, 'download-1112-home.png') });

    await tessera.click();
    const dl = await finestraCon(app, 'filo://downloads');
    await expect(dl.locator('h1')).toHaveText('Download');
    await expect(dl.locator('#search')).toHaveAttribute('placeholder', 'Cerca tra i download…');
    await expect(dl.locator('.dl-item', { hasText: 'report.pdf' })).toBeVisible({ timeout: 15_000 });
    await expect(shell.locator('#tabs .tab.active')).toContainText('Download');
    await expect(tastoDownloadInAlto(shell)).toHaveCount(0);
  } finally {
    await srv.close();
  }
});

test('una domanda su un programma apre il pannello da solo, la × lo chiude e la domanda resta nella carta della home', async ({ app, shell, openTab, testServer }) => {
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
    await expect(tastoDownloadInAlto(shell)).toHaveCount(0);
    const chiudi = shell.locator('#dl-panel #dl-panel-close');
    await expect(chiudi).toBeVisible();
    await expect(chiudi).toHaveAttribute('aria-label', 'Chiudi');
    await shell.locator('#dl-panel').screenshot({ path: join(SHOTS, 'download-941-pannello.png') });
    await shell.emulateMedia({ colorScheme: 'dark' });
    await shell.locator('#dl-panel').screenshot({ path: join(SHOTS, 'download-941-pannello-scuro.png') });
    await shell.emulateMedia({ colorScheme: 'light' });

    await chiudi.click();
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect(tastoDownloadInAlto(shell)).toHaveCount(0);
    // Chiudere non è rispondere: la domanda resta in sospeso, e nella home la dice la sua carta.
    expect(await statoDi(shell, 'setup.exe')).toBe('pending');
    await expect(home.locator('.dash-carta[data-tipo="download"]', { hasText: 'setup.exe' })).toContainText('aspetta il tuo sì', { timeout: 15_000 });
  } finally {
    await srv.close();
  }
});

// #941.1 — Un file grosso che scende da una pagina: fuori dalla home un avviso breve dice che è partito, e quello di
// fine prende il suo posto; con la home davanti nessun avviso, lì lo scaricamento si vede già.
const GROSSO = 4 * 1024 * 1024;
async function apriServerLento() {
  const inCorso = [];
  const srv = createServer((req, res) => {
    const nome = (String(req.url || '').split('?')[0].split('/').pop()) || 'grosso.bin';
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': GROSSO,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.write(Buffer.alloc(64 * 1024, 1));
    inCorso.push(res);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    finisci() { for (const res of inCorso.splice(0)) res.end(Buffer.alloc(GROSSO - 64 * 1024, 1)); },
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

const avvisoDiVia = (dove, nome) => dove.locator('.shell-notif-msg', { hasText: `Scaricamento avviato: ${nome}` });

test('un file grosso scaricato da una pagina lo dice subito, porta alla home, e a fine corsa l’avviso diventa «Scaricato»', async ({ app, shell, openTab, testServer, avvisi }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina col file</title></head><body style="padding:40px">
      <a id="grosso" href="${srv.base}/grosso.bin">Scarica il file grosso</a></body></html>`);
    await page.locator('#grosso').click();
    await expect.poll(() => statoDi(shell, 'grosso.bin'), { timeout: 20_000 }).toBe('progressing');

    const vista = await avvisi();
    await expect(avvisoDiVia(vista, 'grosso.bin')).toBeVisible({ timeout: 10_000 });
    await expect(shell.locator('#dl-panel')).toBeHidden();
    await expect(tastoDownloadInAlto(shell)).toHaveCount(0);
    await vista.locator('.shell-notif').screenshot({ path: join(SHOTS, 'download-941.1-avviso.png') });

    await vista.locator('.shell-notif-action', { hasText: 'Vedi nella home' }).click();
    await expect(shell.locator('#tabs .tab.active')).toContainText('Home');
    const home = await finestraCon(app, 'filo://newtab');
    await expect(home.locator('.dash-carta[data-tipo="download"]', { hasText: 'grosso.bin' })).toBeVisible({ timeout: 15_000 });
    // La scheda della pagina resta: la home si apre accanto, non al suo posto.
    await expect(shell.locator('#tabs .tab', { hasText: 'Pagina col file' })).toHaveCount(1);

    srv.finisci();
    await expect.poll(() => statoDi(shell, 'grosso.bin'), { timeout: 20_000 }).toBe('completed');
    await expect(shell.locator('.shell-notif-msg', { hasText: 'Scaricato: grosso.bin' })).toHaveCount(1, { timeout: 8000 });
    await expect(avvisoDiVia(shell, 'grosso.bin')).toHaveCount(0, { timeout: 4000 });
  } finally {
    await srv.close();
  }
});

test('con la home davanti uno scaricamento partito da una scheda dietro non porta l’avviso di via', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServerLento();
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Pagina col file</title></head><body style="padding:40px">
      <a id="grosso" href="${srv.base}/dietro.bin">Scarica il file grosso</a></body></html>`);
    await shell.locator('#tabs .tab', { hasText: 'Home' }).click();
    const home = await finestraCon(app, 'filo://newtab');
    await expect(shell.locator('#tabs .tab.active')).toContainText('Home');

    await page.evaluate(() => document.getElementById('grosso').click());
    await expect.poll(() => statoDi(shell, 'dietro.bin'), { timeout: 20_000 }).toBe('progressing');
    await expect(home.locator('.dash-carta[data-tipo="download"]', { hasText: 'dietro.bin' })).toBeVisible({ timeout: 15_000 });
    // L'avviso nascerebbe dopo una frazione di secondo: si guarda ben oltre.
    await page.waitForTimeout(2000);
    await expect(avvisoDiVia(shell, 'dietro.bin')).toHaveCount(0);
    expect(await statoDi(shell, 'dietro.bin')).toBe('progressing');
  } finally {
    await srv.close();
  }
});
