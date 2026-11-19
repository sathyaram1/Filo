// #1684.1 — «Riprova» ripresenta la pagina di provenienza del primo tentativo: un sito che dà il file solo a chi arriva
// dalla sua pagina non lo rifiuta, né per un link né per «Salva immagine come…».
import { test, expect } from './fixtures/electron.mjs';
import { createServer } from 'node:http';
import { menuDi } from './helpers/menuContestuale.mjs';

const PDF = Buffer.from('%PDF-1.4\n% finto pdf di prova\n' + 'x'.repeat(4096));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function ascolta(fn) {
  const srv = createServer(fn);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return {
    base: `http://127.0.0.1:${srv.address().port}`,
    async close() {
      try { srv.closeAllConnections?.(); } catch (_) {}
      await new Promise((r) => srv.close(r));
    },
  };
}

const elenco = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];
const voce = async (shell, prova) => (await elenco(shell)).find(prova) || null;

async function riprovaDallaPagina(openTab, nome) {
  const dl = await openTab('filo://downloads/downloads.html');
  const riga = dl.locator('.dl-item', { has: dl.locator('.dl-name', { hasText: nome }) });
  await riga.locator('.dl-btn', { hasText: 'Riprova' }).click();
  return { dl, riga };
}

test('«Riprova» su un link protetto presenta la pagina da cui partiva il clic, e il file arriva', async ({ shell, openTab }) => {
  test.setTimeout(60_000);
  const visti = [];
  let pagina = '';
  let buoni = 0;
  const srv = await ascolta((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/pagina') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html><body style="padding:40px"><a id="l" download href="/protetto/bolletta.pdf">bolletta</a></body></html>');
      return;
    }
    if (!u.pathname.startsWith('/protetto/')) { res.writeHead(404); res.end(); return; }
    const ref = String(req.headers.referer || '');
    visti.push(ref);
    if (ref !== pagina) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('solo dalla pagina'); return; }
    if (++buoni === 1) { res.writeHead(503, { 'Content-Type': 'text/plain' }); res.end('occupato'); return; }
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': PDF.length, 'Content-Disposition': 'attachment; filename="bolletta.pdf"' });
    res.end(PDF);
  });
  try {
    pagina = `${srv.base}/pagina`;
    const page = await openTab(pagina);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8000 });
    await page.locator('#l').click();
    let primo = null;
    await expect.poll(async () => {
      primo = await voce(shell, (x) => x.url.endsWith('/protetto/bolletta.pdf'));
      return primo && primo.state;
    }, { timeout: 30000 }).toBe('interrupted');
    const { riga } = await riprovaDallaPagina(openTab, 'bolletta.pdf');
    await expect(riga.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible({ timeout: 20000 });
    expect((await voce(shell, (x) => x.id === primo.id))?.state).toBe('completed');
    expect(visti.length).toBeGreaterThanOrEqual(2);
    expect(visti[visti.length - 1]).toBe(pagina);
  } finally { await srv.close(); }
});

test('«Riprova» su un «Salva immagine come…» caduto a metà presenta la pagina di provenienza, e l’immagine arriva', async ({ shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const visti = [];
  let richieste = 0;
  const img = await ascolta((req, res) => {
    const ref = String(req.headers.referer || '');
    visti.push(ref);
    console.log('DEBUG2', req.method, req.url, JSON.stringify(req.headers));
    if (!ref.startsWith(testServer.origin)) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('hotlink'); return; }
    // La prima richiesta la mostra nella pagina; il primo salvataggio cade a metà, dopo le intestazioni: la riga nasce e
    // resta «non riuscita».
    if (++richieste === 2) {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length * 10 });
      res.write(PNG);
      setTimeout(() => res.destroy(), 100);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': PNG.length, 'Cache-Control': 'no-store' });
    res.end(PNG);
  });
  try {
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:40px">
      <img id="pic" src="${img.base}/foto-protetta.png" width="64" height="64"></body></html>`);
    await page.waitForFunction(() => { const i = document.getElementById('pic'); return i && i.complete && i.naturalWidth > 0; });
    await page.locator('#pic').click({ button: 'right' });
    await menuDi(page).locator('.sn-menu button', { hasText: 'Salva immagine come' }).click();
    let primo = null;
    await expect.poll(async () => {
      primo = await voce(shell, (x) => x.url.endsWith('/foto-protetta.png'));
      return primo && primo.state;
    }, { timeout: 30000 }).toBe('interrupted');
    const { riga } = await riprovaDallaPagina(openTab, 'foto-protetta.png');
    await expect(riga.locator('.dl-btn', { hasText: 'Apri file' })).toBeVisible({ timeout: 20000 });
    expect((await voce(shell, (x) => x.id === primo.id))?.state).toBe('completed');
    expect(richieste).toBeGreaterThanOrEqual(3);
    expect(visti[visti.length - 1].startsWith(testServer.origin)).toBe(true);
  } finally { await img.close(); }
});
