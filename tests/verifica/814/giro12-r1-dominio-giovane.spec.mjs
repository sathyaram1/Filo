// #814 giro 12 (riallineamento): un file travestito da documento su un dominio di due giorni chiedeva «confermo»
// (pericoloso) prima del riallineamento; ora l'avviso che lo ferma prima che scenda deve restare pericoloso.

import { test, expect } from '../../fixtures/electron.mjs';

const EXE = 'MZ finto eseguibile di prova\n' + 'z'.repeat(2048);

async function servi(app, pagine, { eta = {} } = {}) {
  await app.evaluate(async ({ session, net }, { pg, eta, exe }) => {
    const nostri = new Set(Object.keys(pg).map((k) => k.split('/')[0]));
    const risposta = (req) => {
      const u = new URL(req.url);
      const html = pg[u.hostname + u.pathname];
      if (html) return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      if (/\.exe$/i.test(u.pathname)) {
        const nome = decodeURIComponent(u.pathname.split('/').pop());
        return new Response(exe, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${nome}"` } });
      }
      if (nostri.has(u.hostname)) return new Response('', { status: 404 });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    };
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({
      gsb: null, ct: null, sandbox: null,
      rdap: async (reg) => (reg in eta ? eta[reg] : null),
      llm: async () => ({ suspicious: false, reason: null }),
    });
  }, { pg: pagine, eta, exe: EXE });
}

const avvisi = (app) => app.evaluate(({ BrowserWindow }) => {
  const out = [];
  for (const w of BrowserWindow.getAllWindows()) for (const t of (w._filoTabs && w._filoTabs.tabs) || []) {
    const m = t.sbAvviso && t.sbAvviso.message;
    if (m) out.push({ url: t.sbAvviso.url, level: t.sbAvviso.level, title: m.title, body: m.body });
  }
  return out;
});

const scaricamenti = async (shell) => ((await shell.evaluate(() => window.filoShell.downloads.list())) || {}).items || [];

test('r1 aprire da Filo un fattura.pdf.exe su un dominio di due giorni: l\'avviso è pericoloso', async ({ app, shell, openTab }) => {
  await servi(app, { 'fatture-nuove.it/': '<p>Fatture</p>' }, { eta: { 'fatture-nuove.it': 2 } });
  const home = await openTab('filo://newtab/');
  const giovane = 'https://fatture-nuove.it/scarica/fattura.pdf.exe';
  const r = await home.evaluate((u) => new Promise((ok) => chrome.runtime.sendMessage(
    { type: 'filo_run_action', action: { type: 'NAVIGA', url: u }, parole: ['aprimi la fattura'] }, ok)), giovane);
  expect(r && r.opened).toBe(true);
  await expect.poll(async () => ((await avvisi(app)).find((x) => x.url === giovane) || {}).level || null, { timeout: 8000 }).not.toBeNull();
  // Il tempo per l'età del dominio, che arriva per conto suo.
  await home.waitForTimeout(3000);
  const a = (await avvisi(app)).find((x) => x.url === giovane) || {};
  console.log('avviso', JSON.stringify(a), 'scaricamenti', JSON.stringify((await scaricamenti(shell)).map((x) => [x.filename, x.state])));
  expect(a.level).toBe('pericoloso');
});

test('r1 sospetto confermato con «Continua» su un dominio di due giorni: dopo, il file scende senza altro avviso?', async ({ app, shell, openTab }) => {
  await servi(app, { 'fatture-nuove.it/': '<p>Fatture</p>' }, { eta: { 'fatture-nuove.it': 2 } });
  const home = await openTab('filo://newtab/');
  const giovane = 'https://fatture-nuove.it/scarica/fattura.pdf.exe';
  await home.evaluate((u) => new Promise((ok) => chrome.runtime.sendMessage(
    { type: 'filo_run_action', action: { type: 'NAVIGA', url: u }, parole: ['aprimi la fattura'] }, ok)), giovane);
  await expect.poll(async () => ((await avvisi(app)).find((x) => x.url === giovane) || {}).level || null, { timeout: 8000 }).not.toBeNull();
  const vista = () => app.windows().find((w) => { try { return w.url().startsWith('filo://shell/avviso-sito.html'); } catch (_) { return false; } });
  await expect.poll(() => !!vista(), { timeout: 8000 }).toBe(true);
  const continua = vista().getByRole('button', { name: 'Continua' });
  if (await continua.count()) {
    await expect(continua).toBeEnabled({ timeout: 5000 });
    await continua.click();
  }
  await home.waitForTimeout(4000);
  console.log('dopo continua', JSON.stringify(await avvisi(app)), JSON.stringify((await scaricamenti(shell)).map((x) => [x.filename, x.state])));
  const dopo = (await avvisi(app)).find((x) => /fatture-nuove/.test(x.url)) || {};
  expect(dopo.level).toBe('pericoloso');
});
