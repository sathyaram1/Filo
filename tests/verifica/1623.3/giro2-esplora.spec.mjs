// Verifica #1623.3 giro 2, esplorazione: altri tasti d'incolla e altri tempi mentre il riquadro sopra il sito nasce.

import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, paginaDelloStrato, conta, nelMondoDiFilo, neiRiquadri } from '../../helpers/riquadri.mjs';

const allegatiAiuto = (app, p) => neiRiquadri(app, p, () => (globalThis.__filoSidebarTest?.allegati?.() || []).length);

const PAGINA = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p>Pagina che ascolta gli incolla.</p><input id="campo"><script>window.__visti = [];
  window.addEventListener('paste', (e) => { let f = 0, t = ''; try { f = e.clipboardData.files.length; t = e.clipboardData.getData('text/plain'); } catch (_) {} window.__visti.push(f + ':' + t); }, true);
  </script></body></html>`;

async function immagine(app) {
  await app.evaluate(async ({ clipboard, ClipboardItem, nativeImage }) => {
    const px = Buffer.alloc(48 * 32 * 4);
    for (let i = 0; i < 48 * 32; i++) px.set([0, 0, 255, 255], i * 4);
    const png = nativeImage.createFromBitmap(px, { width: 48, height: 32 }).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
  });
}

const focoAllaScheda = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents.focus();
}, url);

const apriFeedback = (app, url) => app.evaluate(({ BrowserWindow }, u) => {
  const tab = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u);
  tab.view.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: 'globalThis.SN_FEEDBACK_UI.open()' }]);
}, url);

// Tasti sulla scheda dopo `ms`, come li manda l'utente.
async function tasti(app, url, ms, eventi) {
  return app.evaluate(async ({ BrowserWindow }, { u, ms: d, ev }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    const wc = win._filoTabs.tabs.find((t) => t.view.webContents.getURL() === u).view.webContents;
    await new Promise((r) => setTimeout(r, d));
    const s = win._filoTabs.riquadri?.strati?.get(wc);
    const gia = !!(s && s.pronta && s.visibile);
    for (const e of ev) wc.sendInputEvent(e);
    return gia;
  }, { u: url, ms, ev: eventi });
}
const CTRL_V = [{ type: 'keyDown', keyCode: 'V', modifiers: ['control'] }, { type: 'char', keyCode: 'v', modifiers: ['control'] }, { type: 'keyUp', keyCode: 'V', modifiers: ['control'] }];
const SHIFT_INS = [{ type: 'keyDown', keyCode: 'Insert', modifiers: ['shift'] }, { type: 'keyUp', keyCode: 'Insert', modifiers: ['shift'] }];
const CTRL_SHIFT_V = [{ type: 'keyDown', keyCode: 'V', modifiers: ['control', 'shift'] }, { type: 'char', keyCode: 'V', modifiers: ['control', 'shift'] }, { type: 'keyUp', keyCode: 'V', modifiers: ['control', 'shift'] }];

for (const [nome, ev] of [['Maiusc+Ins', SHIFT_INS], ['Ctrl+Maiusc+V', CTRL_SHIFT_V], ['due Ctrl+V', [...CTRL_V, ...CTRL_V]]]) {
  test(`feedback: ${nome} mentre nasce`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const p = await testServer.openReady(openTab, PAGINA);
    await immagine(app);
    await focoAllaScheda(app, p.url());
    await apriFeedback(app, p.url());
    expect(await tasti(app, p.url(), 60, ev)).toBe(false);
    await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
    await p.waitForTimeout(1500);
    console.log(nome, 'sito:', JSON.stringify(await p.evaluate(() => window.__visti)), 'allegati:', await conta(app, p, '.sn-fb-thumb'));
  });
}

test('feedback: testo negli appunti, Ctrl+V mentre nasce', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const p = await testServer.openReady(openTab, PAGINA);
  await app.evaluate(({ clipboard }) => clipboard.writeText('testo segreto incollato'));
  await focoAllaScheda(app, p.url());
  await apriFeedback(app, p.url());
  expect(await tasti(app, p.url(), 60, CTRL_V)).toBe(false);
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
  await p.waitForTimeout(1500);
  console.log('testo', 'sito:', JSON.stringify(await p.evaluate(() => window.__visti)), 'casella:', JSON.stringify((await statoDi(app, p, '.sn-fb-text')).valore));
});

const lettera = (c) => [{ type: 'keyDown', keyCode: c.toUpperCase() }, { type: 'char', keyCode: c }, { type: 'keyUp', keyCode: c.toUpperCase() }];
for (const [nome, ev, atteso] of [
  ['incolla poi lettere', [...CTRL_V, ...lettera('a'), ...lettera('b')], 'XYZab'],
  ['lettere poi incolla', [...lettera('a'), ...lettera('b'), ...CTRL_V], 'abXYZ'],
  ['lettera incolla lettera', [...lettera('a'), ...CTRL_V, ...lettera('b')], 'aXYZb'],
]) {
  test(`feedback ordine: ${nome}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    const p = await testServer.openReady(openTab, PAGINA);
    await app.evaluate(({ clipboard }) => clipboard.writeText('XYZ'));
    await focoAllaScheda(app, p.url());
    await apriFeedback(app, p.url());
    expect(await tasti(app, p.url(), 60, ev)).toBe(false);
    await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
    await p.waitForTimeout(1500);
    console.log(nome, 'casella:', JSON.stringify((await statoDi(app, p, '.sn-fb-text')).valore), 'atteso', atteso, 'sito:', JSON.stringify(await p.evaluate(() => [window.__visti, document.querySelector('#campo').value])));
  });
}

test('risposta su una parola del campo del sito: Ctrl+V e lettere mentre nasce', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, streamComplete: async ({ onDelta }) => { onDelta('The cat.'); return { text: 'The cat.', usage: {} }; } };
  });
  const p = await testServer.openReady(openTab, PAGINA.replace('<input id="campo">', '<textarea id="campo">gatto</textarea>'));
  await app.evaluate(({ clipboard }) => clipboard.writeText('XYZ'));
  await p.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.setSelectionRange(0, 5); });
  await focoAllaScheda(app, p.url());
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs); globalThis.__filoShortcuts.dispatch('translate-selection', win); });
  const gia = await tasti(app, p.url(), 30, [...lettera('a'), ...CTRL_V]);
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  await p.waitForTimeout(1200);
  console.log('risposta', gia, 'campo del sito:', JSON.stringify(await p.evaluate(() => document.querySelector('#campo').value)), 'casella:', JSON.stringify((await statoDi(app, p, '.sn-popup-input'))?.valore));
});

test('feedback riaperto (strato caldo): Ctrl+V subito', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const p = await testServer.openReady(openTab, PAGINA);
  await focoAllaScheda(app, p.url());
  await apriFeedback(app, p.url());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
  await nelMondoDiFilo(app, p, () => true);
  const strato = await paginaDelloStrato(app, p);
  await strato.keyboard.press('Escape');
  await expect.poll(() => conta(app, p, '.sn-fb-overlay'), { timeout: 5000 }).toBe(0);
  await immagine(app);
  await focoAllaScheda(app, p.url());
  await apriFeedback(app, p.url());
  const gia = await tasti(app, p.url(), 0, CTRL_V);
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
  await p.waitForTimeout(1500);
  console.log('caldo', gia, 'sito:', JSON.stringify(await p.evaluate(() => window.__visti)), 'allegati:', await conta(app, p, '.sn-fb-thumb'));
});

test('controllo caldo: Aiuto e feedback già a schermo, Ctrl+V e Ctrl+Maiusc+V nella casella', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const p = await testServer.openReady(openTab, PAGINA);
  await immagine(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await focoAllaScheda(app, p.url());
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const strato = await paginaDelloStrato(app, p);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });
  await p.waitForTimeout(800);
  await strato.click('.sn-sidebar-input textarea');
  await strato.keyboard.press('Control+V');
  await p.waitForTimeout(1200);
  console.log('aiuto caldo Ctrl+V allegati:', await allegatiAiuto(app, p), 'sito:', JSON.stringify(await p.evaluate(() => window.__visti)));
  await apriFeedback(app, p.url());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text'), { timeout: 10_000 }).not.toBeNull();
  await p.waitForTimeout(800);
  await strato.click('.sn-fb-text');
  await strato.keyboard.press('Control+Shift+V');
  await p.waitForTimeout(1200);
  console.log('feedback caldo Ctrl+Maiusc+V allegati:', await conta(app, p, '.sn-fb-thumb'));
});

test('Aiuto: Ctrl+V mentre nasce, l\'immagine va fra gli allegati dell\'Aiuto', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  const p = await testServer.openReady(openTab, PAGINA);
  await immagine(app);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await focoAllaScheda(app, p.url());
  shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  expect(await tasti(app, p.url(), 60, CTRL_V)).toBe(false);
  const strato = await paginaDelloStrato(app, p);
  await strato.waitForSelector('.sn-sidebar-input textarea', { timeout: 10_000 });
  await p.waitForTimeout(1500);
  const n = await allegatiAiuto(app, p);
  const n2 = '';
  console.log('aiuto', 'sito:', JSON.stringify(await p.evaluate(() => window.__visti)), 'allegati:', n, n2);
});
