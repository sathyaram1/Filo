// Verifica #966 giro 2: accorciatori che rimandano da pagina (meta, script), catene, link in un riquadro, link che si
// apre in una scheda nuova col clic normale, clic mentre il controllo è ancora in corso.

import { test, expect } from '../../fixtures/electron.mjs';
import { createServer } from 'node:http';

const CORTO = 'bit.ly';
const CORTO2 = 'tinyurl.com';
const TRUFFA = 'conto-truffa966g.com';
const ALTRO = 'riquadro966g.com';
test.use({ hostInPiu: [CORTO, CORTO2, TRUFFA, ALTRO] });

async function siti(t) {
  const visite = [];
  let porta = 0;
  const server = createServer((req, res) => {
    const host = String(req.headers.host || '').split(':')[0];
    const u = new URL(req.url, 'http://x');
    visite.push(host + u.pathname);
    const html = (b) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(b); };
    const dest = `http://${TRUFFA}:${porta}/accesso`;
    if (host === CORTO) {
      if (u.pathname === '/meta') return html(`<meta http-equiv="refresh" content="0;url=${dest}"><title>bitly</title>`);
      if (u.pathname === '/script') return html(`<title>bitly</title><script>location.replace(${JSON.stringify(dest)})</script>`);
      if (u.pathname === '/catena') { res.writeHead(301, { Location: `http://${CORTO2}:${porta}/abc` }); res.end(); return; }
      res.writeHead(302, { Location: dest });
      res.end();
      return;
    }
    if (host === CORTO2) { res.writeHead(301, { Location: dest }); res.end(); return; }
    if (host === TRUFFA) return html('<title>Accedi</title><p>Accedi</p>');
    if (host === ALTRO) {
      return html(`<body style="margin:0"><a id="dentro" style="display:block;width:300px;height:80px;background:#ddd" href="http://${CORTO}:${porta}/riq">corto nel riquadro</a></body>`);
    }
    const blocco = 'style="display:block;width:320px;height:50px;margin:8px 0;background:#eee"';
    html('<title>Pagina966g</title><body style="margin:0">'
      + `<a id="meta" ${blocco} href="http://${CORTO}:${porta}/meta">meta</a>`
      + `<a id="script" ${blocco} href="http://${CORTO}:${porta}/script">script</a>`
      + `<a id="catena" ${blocco} href="http://${CORTO}:${porta}/catena">catena</a>`
      + `<a id="nuova" ${blocco} target="_blank" href="http://${CORTO}:${porta}/nuova">nuova scheda</a>`
      + `<a id="corso" ${blocco} href="http://${CORTO}:${porta}/corso">in corso</a>`
      + `<iframe id="riq" style="width:340px;height:100px;border:0" src="http://${ALTRO}:${porta}/f"></iframe>`
      + '</body>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  porta = server.address().port;
  t.after = () => new Promise((r) => { try { server.closeAllConnections?.(); } catch (_) {} server.close(r); });
  return { porta, pagina: `http://sito-pubblico.test:${porta}/pagina`, quante: (p) => visite.filter((v) => v.startsWith(p)).length };
}

const listaNera = (app, ms = 4000) => app.evaluate((_e, [truffa, ritardo]) => {
  globalThis.__gsbG = [];
  const visti = new Map();
  globalThis.SN_SAFEBROWSE.setProviders({
    gsb: async (url, norm) => {
      globalThis.__gsbG.push(url);
      await new Promise((r) => setTimeout(r, ritardo));
      const v = norm.host === truffa ? { listed: true, category: 'phishing' } : { listed: false };
      visti.set(url, v);
      return v;
    },
    gsbPeek: (url) => visti.get(url),
    rdap: null, ct: null, llm: null,
  });
}, [TRUFFA, ms]);
const finito = (app) => app.evaluate(() => globalThis.SN_SAFEBROWSE._settled());

async function cliccaEMisura(app, page, sel, opzioni = {}) {
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.__clicG = Date.now();
    globalThis.__avvisoG = null;
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    clearInterval(globalThis.__guardaG);
    globalThis.__guardaG = setInterval(() => {
      const tab = win._filoTabs.tabs.find((x) => x.sbAvviso && x.sbAvviso.level === 'pericoloso');
      if (tab && globalThis.__avvisoG === null) globalThis.__avvisoG = Date.now() - globalThis.__clicG;
    }, 10);
  });
  if (typeof sel === 'function') await sel(); else await page.click(sel, opzioni);
  await expect.poll(() => app.evaluate(() => globalThis.__avvisoG), { timeout: 12_000 }).not.toBeNull();
  return app.evaluate(() => { clearInterval(globalThis.__guardaG); return globalThis.__avvisoG; });
}

for (const caso of ['meta', 'script', 'catena']) {
  test(`accorciatore che rimanda via ${caso}: fermo sopra, poi clic, l'avviso è già pronto`, async ({ app, openTab }) => {
    const t = {};
    const s = await siti(t);
    try {
      await listaNera(app);
      const page = await openTab(s.pagina);
      await finito(app);
      await page.hover(`#${caso}`);
      await expect.poll(() => s.quante(`${CORTO}/${caso}`), { timeout: 5_000 }).toBe(1);
      await finito(app);
      const v = await app.evaluate((_e, u) => { const x = globalThis.SN_SAFEBROWSE.preverdetto(u); return x && { d: x.destinazione, l: x.verdetto && x.verdetto.level }; }, `http://${CORTO}:${s.porta}/${caso}`);
      expect(v).toEqual({ d: `http://${TRUFFA}:${s.porta}/accesso`, l: 'pericoloso' });
      expect(s.quante(`${TRUFFA}/`)).toBe(0);
      const ms = await cliccaEMisura(app, page, `#${caso}`);
      expect(ms).toBeLessThan(2500);
    } finally {
      await t.after();
    }
  });
}

test('link con target _blank, clic normale: l\'avviso nella scheda nuova è già pronto', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNera(app);
    const page = await openTab(s.pagina);
    await finito(app);
    await page.hover('#nuova');
    await expect.poll(() => s.quante(`${CORTO}/nuova`), { timeout: 5_000 }).toBe(1);
    await finito(app);
    const ms = await cliccaEMisura(app, page, '#nuova');
    expect(ms).toBeLessThan(2500);
  } finally {
    await t.after();
  }
});

test('link accorciato dentro un riquadro di un altro sito: fermo sopra, il controllo parte', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNera(app);
    const page = await openTab(s.pagina);
    await finito(app);
    const box = await page.locator('#riq').boundingBox();
    await page.mouse.move(box.x + 100, box.y + 40, { steps: 4 });
    await page.waitForTimeout(1500);
    await finito(app);
    expect(s.quante(`${CORTO}/riq`)).toBe(1);
  } finally {
    await t.after();
  }
});

test('clic mentre il controllo prima del clic è ancora in corso: l\'avviso arriva quando il controllo finisce', async ({ app, openTab }) => {
  const t = {};
  const s = await siti(t);
  try {
    await listaNera(app);
    const page = await openTab(s.pagina);
    await finito(app);
    await page.hover('#corso');
    await page.waitForTimeout(1500);
    // La lista nera risponde 4 s dopo la sua domanda (partita circa 0,5 s dopo la sosta): al clic mancano ~3 s.
    const ms = await cliccaEMisura(app, page, '#corso');
    expect(ms).toBeLessThan(3500);
  } finally {
    await t.after();
  }
});
