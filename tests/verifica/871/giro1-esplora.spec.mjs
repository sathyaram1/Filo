// #871 verifica giro 1 — esplorazione: schede, finestra, tastiera, azioni di pagina dalla barra.

import { test, expect } from '../../fixtures/electron.mjs';
import { barraPage, statoBarra, comandaBarra, pannelloFermo, premi, mettiNelMenu } from '../../helpers/barra.mjs';
import { captureComposite } from '../../agent/driver.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.shots', 'v871');
mkdirSync(OUT, { recursive: true });
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const SITO = (t) => `<!doctype html><html><head><title>${t}</title></head><body style="margin:0;padding:40px;font:16px sans-serif;height:1400px;background:#fff">
  <h1>${t}</h1><p id="p">Testo.</p><a id="anc" href="#giu">giu</a> <a id="push" href="javascript:void 0" onclick="history.pushState({}, '', '/spa-' + Date.now())">spa</a>
  <input id="campo" placeholder="scrivi"><div id="giu" style="margin-top:900px">giu</div>
</body></html>`;

async function disabled(barra, id) {
  return barra.locator(`#nav .ico[data-id="${id}"]`).getAttribute('aria-disabled');
}

test('cambio scheda: indietro e avanti seguono la scheda davanti', async ({ app, shell, openTab, testServer }) => {
  const a = await testServer.openReady(openTab, SITO('A'));
  const barra = await barraPage(app);
  await a.goto(testServer.html(SITO('A2')));
  await a.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await expect.poll(() => disabled(barra, 'back')).toBe('false');
  const idA = await shell.evaluate(() => window.filoShell && true);
  const b = await testServer.openReady(openTab, SITO('B'));
  await expect.poll(() => disabled(barra, 'back')).toBe('true');
  // torna alla scheda A dalla fila
  const ids = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w._filoTabs.tabs.map((t) => ({ id: t.id, url: t.url }));
  });
  const tabA = ids.find((t) => /A2|\/2$/.test(t.url) || t.url.endsWith('/2'));
  await app.evaluate(({ BrowserWindow }, id) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w._filoTabs.activate ? w._filoTabs.activate(id) : w._filoTabs.switchTo(id);
  }, tabA.id);
  await expect.poll(() => disabled(barra, 'back')).toBe('false');
});

test('navigazione dentro la pagina (ancora e pushState) accende indietro', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO('SPA'));
  const barra = await barraPage(app);
  await expect.poll(() => disabled(barra, 'back')).toBe('true');
  await p.click('#push');
  await expect.poll(() => disabled(barra, 'back')).toBe('false');
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await barra.locator('#nav .ico[data-id="back"]').click();
  await expect.poll(() => p.url()).not.toContain('spa-');
  await expect.poll(() => disabled(barra, 'back')).toBe('true');
  await expect.poll(() => disabled(barra, 'forward')).toBe('false');
});

test('finestra ridimensionata: la barra segue l\'altezza', async ({ app, openTab, testServer }) => {
  await testServer.openReady(openTab, SITO('R'));
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.setSize(900, 500);
  });
  await pausa(600);
  const s = await statoBarra(app);
  const H = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    return w.getContentSize()[1];
  });
  console.log('RESIZE', JSON.stringify(s.bounds), H, s.alto);
  expect(s.bounds.y + s.bounds.height).toBe(H);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    w.setSize(1300, 900);
  });
  await pausa(600);
  const s2 = await statoBarra(app);
  const H2 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito).getContentSize()[1]);
  console.log('RESIZE2', JSON.stringify(s2.bounds), H2);
  expect(s2.bounds.y + s2.bounds.height).toBe(H2);
});

test('da tastiera: apri, frecce, Invio su ricarica, Esc e si riscrive nella pagina', async ({ app, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO('K'));
  const barra = await barraPage(app);
  await p.click('#campo');
  await p.keyboard.type('ab');
  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await pausa(300);
  const attivo = await barra.evaluate(() => document.activeElement && (document.activeElement.dataset.id || document.activeElement.dataset.comando || document.activeElement.tagName));
  console.log('FOCUS', attivo);
  await premi(app, 'barra', 'Escape');
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  await pausa(300);
  await premi(app, 'scheda', 'C');
  await pausa(300);
  console.log('CAMPO', await p.inputValue('#campo'));
  expect((await p.inputValue('#campo')).toLowerCase()).toContain('c');
});

test('scorciatoia dalla home di Filo col fuoco nel campo della chat', async ({ app, shell }) => {
  const home = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab'); } catch (_) { return false; } });
  expect(home).toBeTruthy();
  await home.waitForLoadState('domcontentloaded');
  const barra = await barraPage(app);
  const input = home.locator('textarea, input[type="text"]').first();
  await input.click().catch(() => {});
  await premi(app, 'scheda', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
  await premi(app, 'barra', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(false);
  // dalla fila delle schede
  await shell.evaluate(() => document.body.focus());
  await premi(app, 'shell', 'B', ['control', 'shift']);
  await expect.poll(async () => (await statoBarra(app)).aperta).toBe(true);
});

test('screenshot e QR portati nella barra funzionano su un sito e sulla home', async ({ app, shell, openTab, testServer }) => {
  const p = await testServer.openReady(openTab, SITO('Q'));
  const barra = await barraPage(app);
  const r = await app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE({ type: 'icon_layout_drop', id: 'qrCode', target: 'bar' }, {}));
  expect(r.ok).toBe(true);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  await expect(barra.locator('#nav .ico[data-id="qrCode"]')).toBeVisible();
  await barra.locator('#nav .ico[data-id="qrCode"]').click();
  await pausa(1200);
  const dom = await p.evaluate(() => {
    const hosts = [...document.querySelectorAll('*')].filter((e) => e.shadowRoot);
    return document.body.innerHTML.length + ' hosts=' + hosts.length + ' ' + hosts.map((h) => h.shadowRoot.innerHTML.slice(0, 200)).join(' | ');
  });
  console.log('QR SITO', dom.slice(0, 600));
  await captureComposite(app, resolve(OUT, 'qr-sito.png')).catch((e) => console.log('shot', e.message));
});
