// Verifica #588, giro 6: esplorazione (strade equivalenti, stress, aspetto).
import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';

const EXE = Buffer.from('MZ finto eseguibile di prova\n' + 'z'.repeat(2048));
const PDF = Buffer.from('%PDF-1.4\n' + 'x'.repeat(2048));

async function server(pagine) {
  const srv = createServer((req, res) => {
    const p = String(req.url || '').split('?')[0];
    if (pagine[p]) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(pagine[p]); return; }
    const nome = decodeURIComponent(p.split('/').pop() || 'x.exe');
    const pdf = nome.endsWith('.pdf');
    res.writeHead(200, {
      'Content-Type': pdf ? 'application/pdf' : 'application/octet-stream',
      'Content-Length': (pdf ? PDF : EXE).length,
      'Content-Disposition': `attachment; filename="${nome}"`,
    });
    res.end(pdf ? PDF : EXE);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;
  return { porta, base: `http://127.0.0.1:${porta}`, async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); } };
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const voce = async (shell, nome) => (await elenco(shell)).find((x) => x.filename === nome) || null;
const statoDi = async (shell, nome) => (await voce(shell, nome))?.state ?? null;
const domanda = (shell, nome) => shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: `«${nome}»` });
const risposta = (riga, t) => riga.locator('.dl-row-btn', { hasText: t });
const dirDl = (app) => app.evaluate(() => process.env.FILO_DOWNLOAD_DIR);
const contenuto = (d) => (existsSync(d) ? readdirSync(d) : []);

async function sopraLaPagina(app, loc) {
  const box = await loc.boundingBox();
  const vista = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const tm = w && w._filoTabs;
    const t = tm && tm.tabs.find((x) => x.id === tm.activeId);
    if (!t || (t.view.getVisible && !t.view.getVisible())) return null;
    return t.view.getBounds();
  });
  if (!box) return false;
  if (!vista) return true;
  return !(box.x < vista.x + vista.width && vista.x < box.x + box.width
    && box.y < vista.y + vista.height && vista.y < box.y + box.height);
}

test('E1 avviso «Scaricato» di un programma confermato e di un pdf: si vede sopra la pagina?', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const pagine = {};
  const srv = await server(pagine);
  try {
    pagine['/p.html'] = '<!doctype html><body style="padding:40px"><a id="pdf" href="/r.pdf">pdf</a> <a id="exe" href="/setup.exe">exe</a></body>';
    const page = await openTab(`${srv.base}/p.html`);
    await page.locator('#pdf').click();
    await expect.poll(() => statoDi(shell, 'r.pdf'), { timeout: 20000 }).toBe('completed');
    const tp = shell.locator('.shell-notif', { hasText: 'Scaricato: r.pdf' });
    await expect(tp).toHaveCount(1, { timeout: 5000 });
    const pdfSopra = await sopraLaPagina(app, tp);

    await page.locator('#exe').click();
    const d = domanda(shell, 'setup.exe');
    await expect(risposta(d, /^Scarica$/)).toBeEnabled({ timeout: 10000 });
    await risposta(d, /^Scarica$/).click();
    await expect.poll(() => statoDi(shell, 'setup.exe'), { timeout: 20000 }).toBe('completed');
    const te = shell.locator('.shell-notif', { hasText: 'Scaricato: setup.exe' });
    await expect(te).toHaveCount(1, { timeout: 5000 });
    const exeSopra = await sopraLaPagina(app, te);
    console.log('E1 toast sopra la pagina: pdf', pdfSopra, 'exe', exeSopra, 'pannello aperto', await shell.locator('#dl-panel').isVisible());
  } finally { await srv.close(); }
});

test('E2 due programmi insieme: rispondo al secondo, il primo resta in attesa', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const pagine = {};
  const srv = await server(pagine);
  try {
    const dir = await dirDl(app);
    pagine['/p.html'] = '<!doctype html><body style="padding:40px"><a id="a" href="/uno.exe">1</a> <a id="b" href="/due.msi">2</a></body>';
    const page = await openTab(`${srv.base}/p.html`);
    await page.locator('#a').click();
    await expect(domanda(shell, 'uno.exe')).toBeVisible({ timeout: 10000 });
    await page.locator('#b').click({ force: true }).catch(() => page.evaluate(() => document.getElementById('b').click()));
    const due = domanda(shell, 'due.msi');
    await expect(due).toBeVisible({ timeout: 10000 });
    await expect(risposta(due, /^Scarica$/)).toBeEnabled({ timeout: 5000 });
    await risposta(due, /^Scarica$/).click();
    await expect.poll(() => statoDi(shell, 'due.msi'), { timeout: 20000 }).toBe('completed');
    expect(await statoDi(shell, 'uno.exe')).toBe('pending');
    await expect(domanda(shell, 'uno.exe')).toBeVisible();
    expect(contenuto(dir)).toContain('due.msi');
    expect(contenuto(dir)).not.toContain('uno.exe');
  } finally { await srv.close(); }
});

test('E3 link target=_blank a un programma: la scheda vuota si chiude e la domanda arriva', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const pagine = {};
  const srv = await server(pagine);
  try {
    const dir = await dirDl(app);
    pagine['/p.html'] = '<!doctype html><body style="padding:40px"><a id="a" target="_blank" href="/blank.exe">1</a></body>';
    const page = await openTab(`${srv.base}/p.html`);
    const prima = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.length);
    await page.locator('#a').click();
    const d = domanda(shell, 'blank.exe');
    await expect(d).toBeVisible({ timeout: 10000 });
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.length), { timeout: 10000 }).toBe(prima);
    await expect(d).toContainText('127.0.0.1');
    await expect.poll(() => sopraLaPagina(app, d), { timeout: 5000 }).toBe(true);
    expect(contenuto(dir)).not.toContain('blank.exe');
  } finally { await srv.close(); }
});

test('E4 «Ri-scarica» di un programma rifiutato torna alla domanda', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const pagine = {};
  const srv = await server(pagine);
  try {
    const dir = await dirDl(app);
    pagine['/p.html'] = '<!doctype html><body style="padding:40px"><a id="a" href="/ri.exe">1</a></body>';
    const page = await openTab(`${srv.base}/p.html`);
    await page.locator('#a').click();
    const d = domanda(shell, 'ri.exe');
    await expect(d).toBeVisible({ timeout: 10000 });
    await risposta(d, 'Non scaricare').click();
    await expect.poll(() => statoDi(shell, 'ri.exe'), { timeout: 10000 }).toBe('cancelled');
    const dl = await openTab('filo://downloads/downloads.html');
    const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: 'ri.exe' }) });
    await expect(riga).toBeVisible({ timeout: 10000 });
    await riga.locator('.dl-btn', { hasText: 'Ri-scarica' }).click();
    await expect.poll(async () => (await elenco(shell)).filter((x) => x.filename === 'ri.exe' && x.state === 'pending').length, { timeout: 15000 }).toBe(1);
    await expect.poll(() => shell.locator('#dl-panel .dl-row[data-chiede="1"]', { hasText: '«ri.exe»' }).count(), { timeout: 10000 }).toBe(1);
    expect(contenuto(dir)).not.toContain('ri.exe');
  } finally { await srv.close(); }
});

test('E5 aspetto: pannello con la domanda, tema chiaro e scuro, e pagina Scaricamenti', async ({ app, shell, openTab }) => {
  test.setTimeout(150_000);
  mkdirSync('tests/.shots', { recursive: true });
  const pagine = {};
  const srv = await server(pagine);
  try {
    pagine['/p.html'] = '<!doctype html><body style="padding:40px;background:#fff"><a id="a" href="/Installer_Programma.exe">1</a> <a id="b" href="/r.pdf">2</a></body>';
    const page = await openTab(`${srv.base}/p.html`);
    await page.locator('#b').click();
    await expect.poll(() => statoDi(shell, 'r.pdf'), { timeout: 20000 }).toBe('completed');
    await page.locator('#a').click();
    const d = domanda(shell, 'Installer_Programma.exe');
    await expect(risposta(d, /^Scarica$/)).toBeEnabled({ timeout: 10000 });
    await shell.screenshot({ path: 'tests/.shots/588-g6-chiaro.png' });
    const dl = await openTab('filo://downloads/downloads.html');
    await expect(dl.locator('.dl-item[data-state="pending"]')).toBeVisible({ timeout: 10000 });
    await dl.screenshot({ path: 'tests/.shots/588-g6-pagina-chiaro.png' });
    await dl.evaluate(() => window.SN_STORAGE.updateSettings ? window.SN_STORAGE.updateSettings({ theme: 'dark' }) : window.SN_STORAGE.setSettings({ theme: 'dark' }));
    await dl.waitForTimeout(1500);
    await dl.screenshot({ path: 'tests/.shots/588-g6-pagina-scuro.png' });
    await shell.locator('#dl-indicator').click();
    await shell.waitForTimeout(300);
    if (!(await shell.locator('#dl-panel').isVisible())) await shell.locator('#dl-indicator').click();
    await shell.waitForTimeout(1300);
    await shell.screenshot({ path: 'tests/.shots/588-g6-scuro.png' });
  } finally { await srv.close(); }
});

test('E7 chiusa la scheda che l’ha fatto partire, «Scarica» porta il programma in cartella', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  const pagine = {};
  const srv = await server(pagine);
  try {
    const dir = await dirDl(app);
    pagine['/p.html'] = '<!doctype html><body style="padding:40px"><a id="a" href="/orfano.exe">1</a></body>';
    const page = await openTab(`${srv.base}/p.html`);
    await page.locator('#a').click();
    const d = domanda(shell, 'orfano.exe');
    await expect(d).toBeVisible({ timeout: 10000 });
    await app.evaluate(({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
      tm.closeTab(tm.activeId);
    });
    await expect(risposta(d, /^Scarica$/)).toBeEnabled({ timeout: 10000 });
    await risposta(d, /^Scarica$/).click();
    await expect.poll(() => statoDi(shell, 'orfano.exe'), { timeout: 20000 }).toBe('completed');
    expect(contenuto(dir)).toContain('orfano.exe');
  } finally { await srv.close(); }
});
