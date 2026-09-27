// Verifica #588.2 giro 1: uno scaricamento dalla finestra incognito passa dal
// controllo di Filo (domanda sui programmi, elenco) e non tocca la cronologia.
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PDF = Buffer.from('%PDF-1.4\n' + 'x'.repeat(2048));
const EXE = Buffer.from('MZ finto\n' + 'z'.repeat(2048));

async function apriServer() {
  const srv = createServer((req, res) => {
    const u = String(req.url || '').split('?')[0];
    if (u.startsWith('/pagina')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><body style="padding:40px">
        <a id="exe" href="/f/setup.exe">programma</a>
        <a id="pdf" href="/f/report.pdf">pdf</a>
        <a id="blank" href="/f/altro.exe" target="_blank">nuova scheda</a>
        <a id="due" href="/f/secondo.exe">secondo</a></body>`);
      return;
    }
    const nome = u.split('/').pop();
    const exe = !nome.endsWith('.pdf');
    res.writeHead(200, {
      'Content-Type': exe ? 'application/octet-stream' : 'application/pdf',
      'Content-Length': (exe ? EXE : PDF).length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(exe ? EXE : PDF);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { porta: srv.address().port, close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) };
}

async function apriIncognito(app, shell) {
  await shell.evaluate(() => window.filoShell.openIncognito());
  let win = null;
  const fine = Date.now() + 15000;
  while (Date.now() < fine && !win) {
    win = app.windows().find((w) => /incognito=1/.test(w.url()));
    if (!win) await new Promise((r) => setTimeout(r, 100));
  }
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => !!window.filoShell?.tabs, null, { timeout: 10000 });
  return win;
}

async function paginaIn(app, shellWin, url) {
  await shellWin.evaluate((u) => window.filoShell.tabs.open(u), url);
  const host = new URL(url).host;
  const fine = Date.now() + 10000;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return new URL(w.url()).host === host; } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded').catch(() => {}); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}

const voci = async (s) => ((await s.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const statoDi = async (s, nome) => (await voci(s)).find((i) => i.filename === nome)?.state ?? null;
const cartella = (d) => (existsSync(d) ? readdirSync(d) : []);

test('incognito: il programma chiede, dice il sito, entra nell’elenco solo di quella finestra', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    const inc = await apriIncognito(app, shell);
    // "localhost": l'host distingue la pagina incognito da ogni altra.
    const page = await paginaIn(app, inc, `http://localhost:${srv.porta}/pagina`);
    const nellaIncognito = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
      return w._filoTabs.tabs.some((t) => /localhost/.test(t.view.webContents.getURL()));
    });
    expect(nellaIncognito).toBe(true);

    await page.locator('#exe').click();
    await expect.poll(() => statoDi(inc, 'setup.exe'), { timeout: 20000 }).toBe('pending');
    const domanda = inc.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: '«setup.exe»' });
    await expect(domanda).toBeVisible({ timeout: 10000 });
    await expect(domanda).toContainText('programma');
    await expect(domanda).toContainText('localhost');
    expect(cartella(dir)).not.toContain('setup.exe');
    await inc.screenshot({ path: 'tests/.shots/588-2-incognito-domanda.png' });

    // La finestra normale non vede la voce.
    expect((await voci(shell)).map((v) => v.filename)).not.toContain('setup.exe');

    await domanda.locator('.dl-row-btn', { hasText: /^Scarica$/ }).click();
    await expect.poll(() => statoDi(inc, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    await expect.poll(() => cartella(dir), { timeout: 10000 }).toContain('setup.exe');

    // Un file qualunque scende senza domande ed entra nell'elenco incognito.
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(inc, 'report.pdf'), { timeout: 20000 }).toBe('completed');
    expect((await voci(shell)).map((v) => v.filename)).not.toContain('report.pdf');

    // Niente di incognito arriva al disco della cronologia.
    await new Promise((r) => setTimeout(r, 1500));
    const ud = await app.evaluate(() => process.env.FILO_USER_DATA);
    const f = join(ud, 'storage.json');
    if (existsSync(f)) {
      const testo = readFileSync(f, 'utf8');
      expect(testo).not.toContain('setup.exe');
      expect(testo).not.toContain('report.pdf');
    }
  } finally { await srv.close(); }
});

test('incognito: link «scarica» in nuova scheda e «Salva file» passano dallo stesso controllo', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    const inc = await apriIncognito(app, shell);
    const page = await paginaIn(app, inc, `http://localhost:${srv.porta}/pagina`);

    await page.locator('#blank').click();
    await expect.poll(() => statoDi(inc, 'altro.exe'), { timeout: 20000 }).toBe('pending');
    expect(cartella(dir)).not.toContain('altro.exe');
    expect((await voci(shell)).map((v) => v.filename)).not.toContain('altro.exe');

    // «Salva file» dal tasto destro: download nativo della scheda.
    await app.evaluate(({ BrowserWindow }, porta) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => /localhost/.test(x.view.webContents.getURL()));
      t.view.webContents.downloadURL(`http://localhost:${porta}/f/menu.exe`);
    }, srv.porta);
    await expect.poll(() => statoDi(inc, 'menu.exe'), { timeout: 20000 }).toBe('pending');
    expect(cartella(dir)).not.toContain('menu.exe');
  } finally { await srv.close(); }
});

test('incognito: chiudere la finestra con un programma in attesa non lo lascia su disco', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const dir = await app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
    const inc = await apriIncognito(app, shell);
    const page = await paginaIn(app, inc, `http://localhost:${srv.porta}/pagina`);
    await page.locator('#due').click();
    await expect.poll(() => statoDi(inc, 'secondo.exe'), { timeout: 20000 }).toBe('pending');
    const q = join(await app.evaluate(() => process.env.FILO_USER_DATA), 'quarantena');
    await expect.poll(() => cartella(q).length, { timeout: 10000 }).toBeGreaterThan(0);

    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoIncognito).close(); });
    await expect.poll(() => cartella(q), { timeout: 10000 }).toEqual([]);
    expect(cartella(dir)).not.toContain('secondo.exe');
    expect((await voci(shell)).map((v) => v.filename)).not.toContain('secondo.exe');
  } finally { await srv.close(); }
});

test('due finestre incognito: ciascuna vede solo i suoi scaricamenti', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const srv = await apriServer();
  try {
    const a = await apriIncognito(app, shell);
    const pa = await paginaIn(app, a, `http://localhost:${srv.porta}/pagina`);
    await pa.locator('#pdf').click();
    await expect.poll(() => statoDi(a, 'report.pdf'), { timeout: 20000 }).toBe('completed');

    await shell.evaluate(() => window.filoShell.openIncognito());
    let b = null;
    const fine = Date.now() + 15000;
    while (Date.now() < fine && !b) {
      b = app.windows().find((w) => /incognito=1/.test(w.url()) && w !== a);
      if (!b) await new Promise((r) => setTimeout(r, 100));
    }
    await b.waitForFunction(() => !!window.filoShell?.downloads, null, { timeout: 10000 });
    expect((await voci(b)).map((v) => v.filename)).not.toContain('report.pdf');
  } finally { await srv.close(); }
});
