// #588.2 — nella finestra incognito uno scaricamento passa dallo stesso
// controllo della finestra normale: un programma si ferma e chiede dicendo da
// dove arriva, e la voce sta nell'elenco della SUA finestra. Non va su disco,
// la finestra normale non la vede, e alla chiusura dell'incognito sparisce.
//
// Senza il fix la sessione incognito non era seguita: il file andava al dialogo
// nativo (qui, senza dialogo possibile, non arriva nessuna voce) → rosso.

import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));
const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(2048));

async function apriServer() {
  const srv = createServer((req, res) => {
    const nome = String(req.url || '').split('?')[0].split('/').pop();
    if (!nome) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><body style="padding:40px">
        <a id="exe" href="/setup.exe">Scarica il programma</a>
        <a id="pdf" href="/report.pdf">Scarica il report</a></body></html>`);
      return;
    }
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
  return {
    base,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

async function trovaPagina(app, prova, tetto = 15000) {
  const fine = Date.now() + tetto;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) return p;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('pagina non trovata');
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const statoDi = async (shell, nome) => (await elenco(shell)).find((it) => it.filename === nome)?.state ?? null;
const contenuto = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
const suDisco = (app) => app.evaluate(async () => {
  const r = await globalThis.__filoStorage.get('downloads');
  return (r.downloads || []).map((d) => d.filename);
});

test('in incognito un programma chiede prima di scendere e la voce resta alla sua finestra', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);

    await shell.evaluate(() => window.filoShell.openIncognito());
    const incog = await trovaPagina(app, (u) => u.includes('incognito=1'));
    await incog.waitForFunction(() => document.documentElement.dataset.incognito === '1', null, { timeout: 10000 });

    await app.evaluate(({ BrowserWindow }, url) => {
      BrowserWindow.getAllWindows().find((w) => w._filoIncognito)._filoTabs.openTab(url);
    }, srv.base + '/');
    const page = await trovaPagina(app, (u) => u.startsWith(srv.base));
    await page.locator('#exe').waitFor({ timeout: 15000 });

    // Il passo della segnalazione: setup.exe da un sito qualunque.
    await page.locator('#exe').click();
    await expect.poll(() => statoDi(incog, 'setup.exe'), { timeout: 20000 }).toBe('pending');
    expect(contenuto(dir)).not.toContain('setup.exe');

    const avviso = incog.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: '«setup.exe»' });
    await expect(avviso).toBeVisible({ timeout: 10000 });
    await expect(avviso).toContainText('programma');
    await expect(avviso).toContainText('127.0.0.1');
    await incog.screenshot({ path: 'tests/.shots/downloads-incognito-domanda.png' });

    // La finestra normale non vede niente dell'incognito.
    expect(await statoDi(shell, 'setup.exe')).toBeNull();

    await avviso.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click();
    await expect.poll(() => statoDi(incog, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    await expect.poll(() => contenuto(dir), { timeout: 10000 }).toContain('setup.exe');

    // Anche un file qualsiasi entra nell'elenco della finestra, senza domande.
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(incog, 'report.pdf'), { timeout: 20000 }).toBe('completed');

    // Nessuna traccia: né nella finestra normale né nella cronologia su disco.
    expect(await statoDi(shell, 'setup.exe')).toBeNull();
    expect(await statoDi(shell, 'report.pdf')).toBeNull();
    const disco = await suDisco(app);
    expect(disco).not.toContain('setup.exe');
    expect(disco).not.toContain('report.pdf');

    // Un comando dalla finestra normale non raggiunge le voci dell'incognito.
    const id = (await elenco(incog)).find((it) => it.filename === 'setup.exe').id;
    const tolto = await shell.evaluate((x) => window.filoShell.downloads.remove(x), id);
    expect(tolto && tolto.ok).toBe(true);
    expect(await statoDi(incog, 'setup.exe')).toBe('completed');

    // Chiusa la finestra, le voci se ne vanno con lei; il file scaricato resta.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((w) => w._filoIncognito).close();
    });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w._filoIncognito)), { timeout: 10000 }).toBe(false);
    await shell.evaluate(() => window.filoShell.openIncognito());
    const incog2 = await trovaPagina(app, (u) => u.includes('incognito=1'));
    await incog2.waitForFunction(() => document.documentElement.dataset.incognito === '1', null, { timeout: 10000 });
    expect(await elenco(incog2)).toEqual([]);
    expect(contenuto(dir)).toContain('setup.exe');
  } finally {
    await srv.close();
  }
});
