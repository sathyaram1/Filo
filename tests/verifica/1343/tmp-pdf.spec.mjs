// Esplorazione giro 13: le altre azioni sulla pagina su un PDF e su pagine interne.
import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { barraPage, comandaBarra, pannelloFermo } from '../../helpers/barra.mjs';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const SITO = '<!doctype html><html><head><title>Prima</title></head><body><h1>Prima</h1></body></html>';
const naviga = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
  tm.navigate(tm.activeId, url);
}, u);
const salvate = (app) => app.evaluate(async () => {
  const r = await globalThis.chrome.storage.local.get('savedPages');
  return (r.savedPages || []).map((p) => p.url);
});
async function icona(app, id) {
  const barra = await barraPage(app);
  await comandaBarra(app, 'clic');
  await pannelloFermo(barra);
  const ico = barra.locator(`#nav .ico[data-id="${id}"]`);
  if (!(await ico.count())) await barra.locator('#nav [data-altro]').click();
  return ico;
}
async function foto(app, nome) {
  mkdirSync('tests/.shots', { recursive: true });
  const b64 = await app.evaluate(async ({ BrowserWindow }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
    const t = tm.tabs.find((x) => x.id === tm.activeId);
    return (await t.view.webContents.capturePage()).toPNG().toString('base64');
  });
  writeFileSync(`tests/.shots/g13-${nome}.png`, Buffer.from(b64, 'base64'));
}
const stato = async (ico) => ({ dis: await ico.getAttribute('aria-disabled'), sugg: await ico.getAttribute('data-sugg') });

test('esplora PDF', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await testServer.openReady(openTab, SITO);
  const pdf = testServer.asset(readFileSync('tests/fixtures/documenti/documento-con-testo.pdf'), 'application/pdf');
  await naviga(app, pdf);
  await pausa(4000);
  for (const id of ['translate']) {
    const ico = await icona(app, id);
    console.log('PDF', id, JSON.stringify(await stato(ico)));
    if ((await ico.getAttribute('aria-disabled')) === 'true') continue;
    await ico.click();
    for (const ms of [300, 800, 1500, 3000]) { await pausa(ms); await foto(app, `pdf-${id}-${ms}`); }
    console.log('pagina', JSON.stringify(await app.evaluate(async ({ BrowserWindow }) => {
      const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito)._filoTabs;
      const t = tm.tabs.find((x) => x.id === tm.activeId);
      const fr = t.view.webContents.mainFrame.framesInSubtree.map((f) => f.url);
      return { url: t.view.webContents.getURL(), fr };
    })));
    await comandaBarra(app, 'chiudi');
    await pausa(500);
  }
  console.log('salvate', JSON.stringify(await salvate(app)));
});

test('esplora pagine interne', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await testServer.openReady(openTab, SITO);
  for (const u of ['filo://options/options.html', 'filo://history/history.html', 'filo://editor/editor.html', 'about:blank']) {
    await naviga(app, u);
    await pausa(2500);
    const out = [];
    for (const id of ['translate', 'screenshot', 'share', 'saveForLater', 'qrCode']) {
      const ico = await icona(app, id);
      out.push(`${id}:${JSON.stringify(await stato(ico))}`);
    }
    console.log(u, out.join(' '));
  }
});
