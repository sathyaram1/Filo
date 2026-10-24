// Verifica #966 giro 1: la rotella porta un link accorciato sotto il puntatore fermo, e il controllo prima del clic
// non parte, nemmeno muovendo poi il puntatore dentro lo stesso link.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const CORTO = 'bit.ly';
const TRUFFA = 'conto-truffa966v.com';
test.use({ hostInPiu: [CORTO, TRUFFA] });

async function siti(t) {
  const visite = [];
  let porta = 0;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const u = new URL(req.url, 'http://x');
    visite.push(host + u.pathname);
    const html = (b) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(b); };
    if (host === CORTO) {
      res.writeHead(302, { Location: `http://${TRUFFA}:${porta}/accesso` });
      res.end();
      return;
    }
    if (host === TRUFFA) return html('<title>Accedi</title><p>Accedi</p>');
    html('<title>Pagina966v</title><body style="margin:0">'
      + '<div style="height:1200px;background:#fafafa">spazio</div>'
      + `<a id="corto" style="display:block;width:600px;height:80px;background:#eee" href="http://${CORTO}:${porta}/r5z">link corto</a>`
      + `<div style="height:${u.pathname === '/corta' ? 300 : 2000}px"></div></body>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  porta = server.address().port;
  t.after = () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); });
  return { porta, pagina: `http://sito-pubblico.test:${porta}/pagina`, corta: `http://sito-pubblico.test:${porta}/corta`, quante: (p) => visite.filter((v) => v.startsWith(p)).length };
}

const listaNera = (app) => app.evaluate((_e, truffa) => {
  globalThis.__gsb966v = [];
  globalThis.SN_SAFEBROWSE.setProviders({
    gsb: async (url, norm) => { globalThis.__gsb966v.push(url); return norm.host === truffa ? { listed: true, category: 'phishing' } : { listed: false }; },
    gsbPeek: () => undefined,
    rdap: null, ct: null, llm: null,
  });
}, TRUFFA);

test('scorrendo con la rotella fino a portare il link accorciato sotto il puntatore fermo, il controllo parte', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNera(app);
    const page = await openTab(s.pagina);
    await app.evaluate(() => globalThis.SN_SAFEBROWSE._settled());
    await page.mouse.move(300, 200);
    await page.waitForTimeout(1500);
    // Il link sta a 1200 px: la rotella lo porta sotto il puntatore, che non si muove.
    await page.mouse.wheel(0, 1040);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(1000);
    const sotto = await page.evaluate(() => { const el = document.elementFromPoint(300, 200); return el && el.id; });
    expect(sotto).toBe('corto');
    await page.waitForTimeout(2000);
    expect(s.quante(`${CORTO}/r5z`)).toBe(1);
  } finally {
    await t.after();
  }
});

test('dopo la rotella, muovere appena il puntatore dentro lo stesso link fa partire il controllo', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNera(app);
    const page = await openTab(s.pagina);
    await app.evaluate(() => globalThis.SN_SAFEBROWSE._settled());
    await page.mouse.move(300, 200);
    await page.waitForTimeout(1500);
    await page.mouse.wheel(0, 1040);
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 3000 }).toBeGreaterThan(1000);
    await page.waitForTimeout(300);
    // Il puntatore resta sul link: l'utente lo sposta di pochi pixel e lo tiene fermo.
    await page.mouse.move(310, 205, { steps: 3 });
    await page.waitForTimeout(2000);
    expect(s.quante(`${CORTO}/r5z`)).toBe(1);
  } finally {
    await t.after();
  }
});

test('col tasto Fine la pagina porta il link accorciato sotto il puntatore fermo, e il controllo parte', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNera(app);
    const page = await openTab(s.corta);
    await app.evaluate(() => globalThis.SN_SAFEBROWSE._settled());
    const y = await page.evaluate(() => 1200 - (document.documentElement.scrollHeight - innerHeight) + 40);
    await page.mouse.move(300, y);
    await page.waitForTimeout(1500);
    await page.keyboard.press('End');
    await expect.poll(() => page.evaluate((yy) => { const el = document.elementFromPoint(300, yy); return el && el.id; }, y), { timeout: 3000 }).toBe('corto');
    await page.waitForTimeout(2000);
    expect(s.quante(`${CORTO}/r5z`)).toBe(1);
  } finally {
    await t.after();
  }
});
