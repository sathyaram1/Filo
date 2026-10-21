// #1311 — le due porte da cui un programma entrava nei Download senza la domanda di Filo:
//   1. «Salva immagine come» su un'immagine che il sito consegna col nome setup.exe;
//   2. i tipi che Windows avvia senza essere un .exe, come connessione.rdp.
// Si asserisce il successo per chi usa Filo: la domanda arriva prima che il file sia in cartella, «Non scaricare» non
// lascia niente su disco, «Scarica» lo porta dove serve con la marca «Programma», e «Apri file» chiede prima di eseguire.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { menuDi } from './helpers/menuContestuale.mjs';

// PNG 1×1 valido: l'immagine si vede nella pagina, il nome che il sito le dà è quello di un programma.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const RDP = Buffer.from('full address:s:attaccante.example\nredirectdrives:i:1\nredirectclipboard:i:1\n');

async function apriServer() {
  const srv = createServer((req, res) => {
    const p = String(req.url || '').split('?')[0];
    if (p === '/foto') {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': PNG.length,
        'Content-Disposition': 'inline; filename="setup.exe"',
      });
      res.end(PNG);
      return;
    }
    if (p === '/connessione.rdp') {
      res.writeHead(200, {
        'Content-Type': 'application/x-rdp',
        'Content-Length': RDP.length,
        'Content-Disposition': 'attachment; filename="connessione.rdp"',
      });
      res.end(RDP);
      return;
    }
    res.writeHead(404);
    res.end();
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

async function apriPagina(base, { openTab, testServer }) {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
    <img id="pic" src="${base}/foto" width="64" height="64">
    <a id="rdp" href="${base}/connessione.rdp">Collegati</a></body></html>`);
  await page.waitForFunction(() => {
    const i = document.getElementById('pic');
    return i && i.complete && i.naturalWidth > 0;
  });
  return page;
}

async function salvaImmagine(page) {
  await page.locator('#pic').click({ button: 'right' });
  const voce = menuDi(page).locator('.sn-menu button', { hasText: 'Salva immagine come' });
  await expect(voce).toBeVisible();
  await voce.click();
}

const voce = async (shell, nome) => {
  const r = await shell.evaluate(() => window.filoShell.downloads.list());
  return ((r && r.items) || []).find((it) => it.filename === nome) || null;
};
const statoDi = async (shell, nome) => (await voce(shell, nome))?.state ?? null;
const domanda = (shell, nome) => shell.locator('#dl-panel .dl-row[data-chiede="1"]')
  .filter({ has: shell.locator('.dl-row-ask-nome', { hasText: new RegExp(`^${nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
const risposta = (riga, testo) => riga.locator('.dl-row-btn', { hasText: testo });
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
async function cartelle(app) {
  const env = await app.evaluate(() => ({ dl: process.env.FILO_DOWNLOAD_DIR, dati: process.env.FILO_USER_DATA }));
  return { dl: env.dl, quarantena: join(env.dati, 'quarantena') };
}
async function spiaApertura(app) {
  await app.evaluate(({ shell }) => {
    globalThis.__aperti = [];
    shell.openPath = (p) => { globalThis.__aperti.push(p); return Promise.resolve(''); };
  });
  return () => app.evaluate(() => globalThis.__aperti.slice());
}

// «Apri file» dal pannello: la marca a vista, e la seconda domanda invece dell'esecuzione.
async function apriChiede(shell, aperti, nome) {
  const riga = shell.locator('#dl-panel .dl-row', { hasText: nome });
  await expect(riga).toBeVisible({ timeout: 10000 });
  await expect(riga.locator('.dl-row-tag')).toHaveText('Programma');
  await riga.locator('.dl-row-btn', { hasText: 'Apri file' }).click();
  await expect(domanda(shell, nome).filter({ hasText: 'eseguirlo' })).toBeVisible({ timeout: 10000 });
  expect(await aperti()).toEqual([]);
}

test('«Salva immagine come» su un’immagine che il sito chiama setup.exe chiede prima, e «Non scaricare» non lascia niente', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const { dl, quarantena } = await cartelle(app);
    const page = await apriPagina(srv.base, { openTab, testServer });
    await salvaImmagine(page);

    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('pending');
    const avviso = domanda(shell, 'setup.exe');
    await expect(avviso).toBeVisible({ timeout: 10000 });
    await expect(avviso).toContainText('programma');
    await expect(avviso).toContainText('127.0.0.1');
    await expect(risposta(avviso, /^Scarica$/)).toBeVisible();
    expect(contenuto(dl)).not.toContain('setup.exe');

    await risposta(avviso, 'Non scaricare').click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 10000 }).toBe('cancelled');
    // Né il programma né il suo pezzo restano: in cartella e in quarantena non c'è niente.
    await expect.poll(() => [...contenuto(dl), ...contenuto(quarantena)], { timeout: 10000 }).toEqual([]);
    await page.waitForTimeout(500);
    await expect(page.locator('.sn-toast', { hasText: 'Immagine salvata' })).toHaveCount(0);
  } finally {
    await srv.close();
  }
});

test('«Scarica» porta l’immagine-programma in cartella con la marca «Programma», e «Apri file» chiede', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const { dl } = await cartelle(app);
    const aperti = await spiaApertura(app);
    const page = await apriPagina(srv.base, { openTab, testServer });
    await salvaImmagine(page);

    const avviso = domanda(shell, 'setup.exe');
    await expect(avviso).toBeVisible({ timeout: 20000 });
    expect(contenuto(dl)).not.toContain('setup.exe');
    await risposta(avviso, /^Scarica$/).click();

    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    expect(readFileSync(join(dl, 'setup.exe')).equals(PNG)).toBe(true);
    const rec = await voce(shell, 'setup.exe');
    expect(rec.exe).toBe(true);
    expect(rec.savePath).toBe(join(dl, 'setup.exe'));
    await expect(page.locator('.sn-toast')).toContainText('Immagine salvata');

    const primo = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(primo.needsConfirm).toBe(true);
    await apriChiede(shell, aperti, 'setup.exe');
  } finally {
    await srv.close();
  }
});

test('connessione.rdp da un sito si ferma alla domanda, porta la marca «Programma» e «Apri file» chiede (#588.6)', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const { dl } = await cartelle(app);
    const aperti = await spiaApertura(app);
    const page = await apriPagina(srv.base, { openTab, testServer });
    await page.locator('#rdp').click();

    await expect.poll(() => statoDi(shell, 'connessione.rdp'), { timeout: 20000 }).toBe('pending');
    const avviso = domanda(shell, 'connessione.rdp');
    await expect(avviso).toBeVisible({ timeout: 10000 });
    await expect(avviso).toContainText('programma');
    await expect(avviso).toContainText('127.0.0.1');
    expect(contenuto(dl)).not.toContain('connessione.rdp');

    await risposta(avviso, /^Scarica$/).click();
    await expect.poll(() => statoDi(shell, 'connessione.rdp'), { timeout: 20000 }).toBe('completed');
    await expect.poll(() => contenuto(dl), { timeout: 10000 }).toContain('connessione.rdp');
    const rec = await voce(shell, 'connessione.rdp');
    expect(rec.exe).toBe(true);
    const primo = await shell.evaluate((id) => window.filoShell.downloads.openFile(id), rec.id);
    expect(primo.needsConfirm).toBe(true);
    expect(primo.text).toContain('connessione.rdp');
    await apriChiede(shell, aperti, 'connessione.rdp');
  } finally {
    await srv.close();
  }
});
