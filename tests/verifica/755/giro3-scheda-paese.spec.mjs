// Verifica #755 giro 3: la porta del giro 2 che nessuno aveva provato. Una scheda col paese cambiato
// tiene le protezioni dei cookie: embed YouTube deviati, tracker fermati, segnale di non-tracciamento.
// Il «fornitore» del paese è un proxy locale che registra cosa gli arriva: è lì che si vede cosa esce.

import { test, expect } from '../../fixtures/electron.mjs';
import http from 'node:http';

async function fornitore() {
  const connessi = [];
  const chiari = [];
  const proxy = http.createServer((req, res) => {
    chiari.push({ url: req.url, gpc: req.headers['sec-gpc'] || null });
    res.writeHead(200, { 'content-type': 'image/gif' });
    res.end();
  });
  proxy.on('connect', (req, sock) => { if (/youtube|google-analytics/.test(req.url)) connessi.push(req.url); sock.end('HTTP/1.1 502 No\r\n\r\n'); });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  return { connessi, chiari, porta: proxy.address().port, chiudi: () => proxy.close() };
}

async function setMode(openTab, mode) {
  const sec = await openTab('filo://security/');
  await sec.waitForSelector('input[name="cookie-mode"]', { timeout: 8_000 });
  await sec.locator(`input[name="cookie-mode"][value="${mode}"]`).check();
  await expect(sec.locator('#savedHint')).toHaveClass(/sn-show/, { timeout: 4_000 });
}

async function apriDaAltroPaese(app, shell, openTab, testServer, f, tag) {
  await app.evaluate((_e, porta) => { process.env.FILO_PROXY_DATACENTER = `http://127.0.0.1:${porta}`; }, f.porta);
  await openTab(testServer.html(`<title>PAESE</title>
    <iframe src="https://www.youtube.com/embed/AAA111?start=30" allowfullscreen></iframe>
    <script src="https://www.google-analytics.com/analytics.js"></script>
    <img src="http://gpc-check.test/${tag}.gif">`));
  const id = (await shell.evaluate(() => window.filoShell.tabs.snapshot())).activeId;
  const esito = await app.evaluate(async ({ BrowserWindow }, tabId) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && x._filoTabs.tabs.some((t) => t.id === tabId));
    return w._filoTabs.setTabProxy(tabId, 'us');
  }, id);
  expect(esito.ok, JSON.stringify(esito)).toBe(true);
  await expect.poll(() => f.chiari.filter((c) => c.url.includes(`/${tag}.gif`)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 2000));
}

test('Automatico: la scheda col paese cambiato devia gli embed, ferma i tracker e dice «non profilarmi»', async ({ app, shell, openTab, testServer }) => {
  const f = await fornitore();
  try {
    await apriDaAltroPaese(app, shell, openTab, testServer, f, 'auto');
    expect(f.connessi, 'un embed di YouTube o un tracker escono dalla scheda col paese cambiato').toEqual(['www.youtube-nocookie.com:443']);
    expect(f.chiari.find((c) => c.url.includes('/auto.gif')).gpc).toBe('1');
  } finally { f.chiudi(); }
});

test('Manuale: la scheda col paese cambiato non tocca niente', async ({ app, shell, openTab, testServer }) => {
  const f = await fornitore();
  try {
    await setMode(openTab, 'manual');
    await apriDaAltroPaese(app, shell, openTab, testServer, f, 'man');
    expect(f.connessi.sort()).toEqual(['www.google-analytics.com:443', 'www.youtube.com:443']);
    expect(f.chiari.find((c) => c.url.includes('/man.gif')).gpc).toBeNull();
  } finally { f.chiudi(); }
});
