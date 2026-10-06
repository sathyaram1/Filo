// #871 giro 7 — esplorazione: aspetto in chiaro e scuro, Indietro sopra l'avviso del sito pericoloso, stress della scorciatoia.
import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi } from '../../helpers/barra.mjs';

const OUT = 'tests/.shots/871-giro7';
mkdirSync(OUT, { recursive: true });
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function fotoBarra(app, nome) {
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const tm = w._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    const sotto = (tm.vistaSottoIlVuoto() || t.view);
    const a = await sotto.webContents.capturePage();
    const b = await tm.barra.vista.webContents.capturePage();
    return { pagina: a.toPNG().toString('base64'), barra: b.toPNG().toString('base64') };
  });
  const fs = await import('node:fs');
  fs.writeFileSync(`${OUT}/${nome}-pagina.png`, Buffer.from(png.pagina, 'base64'));
  fs.writeFileSync(`${OUT}/${nome}-barra.png`, Buffer.from(png.barra, 'base64'));
}

const SITO = `<!doctype html><html><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px;background:#fff">
  <h1>Pagina di prova</h1><p>Testo.</p></body></html>`;

test('aspetto: barra aperta su un sito e sulla home, chiaro e scuro', async ({ app, shell, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await fotoBarra(app, 'sito-chiaro');
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'dark' } }));
  await pausa(1200);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await fotoBarra(app, 'sito-scuro');
  const home = await openTab('filo://newtab/');
  await home.waitForLoadState('domcontentloaded');
  await pausa(1500);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await fotoBarra(app, 'home-scuro');
  await shell.evaluate(() => window.filoShell.message({ type: 'update_settings', settings: { theme: 'light' } }));
  await pausa(1200);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await fotoBarra(app, 'home-chiaro');
});

const SEGNALATA = '<title>Accedi</title><body style="margin:0"><button style="position:fixed;inset:0">Accedi</button></body>';

test('sopra l\'avviso del sito pericoloso, arrivato da un link, Indietro della barra riporta alla pagina di prima', async ({ app, shell, openTab, testServer }) => {
  const a = testServer.html('<!doctype html><title>A</title><body><h1>A</h1></body>');
  await app.evaluate(async ({ session, net }, html) => {
    const risposta = (req) => (new URL(req.url).hostname === 'conto-paypa1.com'
      ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      : net.fetch(req, { bypassCustomProtocolHandlers: true }));
    for (const s of ['http', 'https']) {
      try { session.defaultSession.protocol.unhandle(s); } catch (_) {}
      session.defaultSession.protocol.handle(s, risposta);
    }
    globalThis.SN_SAFEBROWSE.setProviders({ gsb: async () => ({ listed: true, category: 'phishing' }), rdap: null, ct: null, sandbox: null, llm: async () => ({ suspicious: false }) });
  }, SEGNALATA);
  const page = await openTab(a);
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await page.evaluate(() => { location.href = 'https://conto-paypa1.com/login'; });
  const coperta = () => app.evaluate(({ BrowserWindow }) => !!BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.avvisoSito.coperta());
  await expect.poll(coperta, { timeout: 15_000 }).toBe(true);
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await fotoBarra(app, 'avviso');
  const back = barra.locator('#nav .ico[data-id="back"]');
  await expect(back).toHaveAttribute('aria-disabled', 'false');
  await back.click();
  await expect.poll(coperta, { timeout: 10_000 }).toBe(false);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    return tm.tabs.find((x) => x.id === tm.activeId).url;
  })).toBe(a);
});

test('scorciatoia premuta molte volte di fila: lo stato finale è coerente col numero di pressioni', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO);
  const barra = await barraPage(app);
  for (let i = 0; i < 9; i++) await premi(app, 'scheda', 'B', ['control', 'shift']);
  await pausa(800);
  expect((await statoBarra(app)).aperta).toBe(true);
  await premi(app, 'barra', 'B', ['control', 'shift']);
  await pausa(800);
  const s = await statoBarra(app);
  expect(s.aperta).toBe(false);
  expect(s.bounds.width).toBe(s.chiusa);
  await expect(barra.locator('#pannello')).toBeHidden();
});
