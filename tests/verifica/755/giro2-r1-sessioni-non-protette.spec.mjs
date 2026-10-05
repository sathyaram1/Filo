// Verifica #755 giro 2: la finestra incognito non riceve le protezioni della modalità cookie.
// Gli embed YouTube ripartono verso youtube.com (il doppio caricamento della segnalazione),
// i tracker non sono bloccati e il segnale di non-tracciamento non parte: una causa sola, tre porte.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const embedYT = (u) => /^https?:\/\/(www\.|m\.)?youtube\.com\/embed/i.test(u);

// Server proprio: serve la pagina E registra se la richiesta portava Sec-GPC.
async function apriServer() {
  const visti = [];
  const srv = createServer((req, res) => {
    visti.push({ url: req.url, gpc: req.headers['sec-gpc'] || null });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><body>
      <iframe id="a" src="https://www.youtube.com/embed/AAA111?start=30" allowfullscreen></iframe>
      <div style="height:3000px"></div>
      <iframe id="b" data-src="https://www.youtube.com/embed/BBB222?start=5"></iframe>
      <iframe id="t" src="https://www.google-analytics.com/analytics.js"></iframe>
      <script>addEventListener('scroll', () => { const f = document.getElementById('b');
        if (!f.getAttribute('src') && scrollY > 1000) f.setAttribute('src', f.getAttribute('data-src')); });</script>
      </body></html>`);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  return {
    visti,
    url: (n) => `http://127.0.0.1:${port}/${n}`,
    async close() { try { srv.closeAllConnections?.(); } catch (_) {} await new Promise((r) => srv.close(r)); },
  };
}

async function registra(app) {
  await app.evaluate(({ app: a, session }) => {
    globalThis.__reg755 = { usciti: [], esiti: [] };
    const aggancia = (ses) => {
      if (!ses || ses.__reg755) return;
      ses.__reg755 = true;
      const segna = (d) => {
        if (d.resourceType === 'subFrame') globalThis.__reg755.usciti.push(d.url);
        globalThis.__reg755.esiti.push([d.url, d.error || ('ok ' + d.statusCode)]);
      };
      ses.webRequest.onCompleted(segna);
      ses.webRequest.onErrorOccurred(segna);
    };
    aggancia(session.defaultSession);
    a.on('session-created', aggancia);
  });
}
const leggi = (app) => app.evaluate(() => globalThis.__reg755);

async function trovaPagina(app, prova, tetto = 15_000) {
  const fine = Date.now() + tetto;
  while (Date.now() < fine) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) return p;
    await sleep(150);
  }
  throw new Error('pagina non trovata');
}

test('in incognito gli embed YouTube, il blocco tracker e il segnale di non-tracciamento valgono come nella finestra normale', async ({ app, shell }) => {
  test.setTimeout(150_000);
  const srv = await apriServer();
  try {
    await registra(app);

    // Riferimento: nella finestra normale (modalità Automatico, la predefinita) tutte e tre valgono.
    await shell.evaluate((u) => window.filoShell.tabs.open(u), srv.url('normale'));
    const normale = await trovaPagina(app, (u) => u.includes('/normale'));
    await normale.waitForLoadState('load').catch(() => {});
    await normale.evaluate(() => window.scrollTo(0, 2500));
    await sleep(5000);
    const rifA = await leggi(app);
    expect(rifA.usciti.filter(embedYT), 'riferimento: nella finestra normale niente esce verso youtube.com').toEqual([]);
    expect(rifA.esiti.find(([u]) => u.includes('google-analytics'))?.[1], 'riferimento: il tracker è bloccato').toBe('net::ERR_BLOCKED_BY_CLIENT');
    expect(srv.visti.find((v) => v.url === '/normale')?.gpc, 'riferimento: la pagina riceve Sec-GPC').toBe('1');

    // Stessa pagina in una finestra incognito.
    await shell.evaluate(() => window.filoShell.openIncognito());
    const incog = await trovaPagina(app, (u) => u.includes('incognito=1'));
    await incog.waitForFunction(() => document.documentElement.dataset.incognito === '1', null, { timeout: 10_000 });
    await incog.evaluate((u) => window.filoShell.tabs.open(u), srv.url('incognito'));
    const page = await trovaPagina(app, (u) => u.includes('/incognito'));
    await page.waitForLoadState('load').catch(() => {});
    await page.evaluate(() => window.scrollTo(0, 2500));
    await sleep(6000);

    const reg = await leggi(app);
    const dopo = reg.esiti.filter(([u]) => u.includes('google-analytics')).slice(1);
    expect.soft(reg.usciti.filter(embedYT), 'in incognito un embed YouTube esce ancora verso youtube.com: parte coi cookie e il video si ricarica').toEqual([]);
    expect.soft(dopo.map(([, e]) => e), 'in incognito il tracker non viene bloccato').toEqual(['net::ERR_BLOCKED_BY_CLIENT']);
    expect.soft(srv.visti.find((v) => v.url === '/incognito')?.gpc, 'in incognito la pagina non riceve il segnale di non-tracciamento').toBe('1');
  } finally {
    await srv.close();
  }
});
