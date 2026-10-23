import { test, expect } from './fixtures/electron.mjs';
import { execSync } from 'node:child_process';
import { nelMondoDiFilo, statoDi } from './helpers/riquadri.mjs';

const pagina = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif;background:#f4efe6">'
  + '<h1>Un sito qualunque</h1><p style="font-size:20px">Il <span id="parola">gatto</span> dorme sul tetto della casa.</p>'
  + '<textarea id="campo" style="margin-top:120px;width:420px;height:90px">Testo da modificare</textarea></body></html>';

const foto = (n) => execSync(`import -window root tests/.shots/strato-${n}.png`, { env: process.env });

test('foto dello strato dei riquadri', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, streamComplete: async ({ onDelta }) => { const t = 'Il **gatto** è un felino domestico.'; onDelta(t); return { text: t, usage: {} }; } };
  });
  const p = await testServer.openReady(openTab, pagina);
  await p.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs); globalThis.__filoShortcuts.dispatch('translate-selection', win); });
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15000 }).toContain('felino');
  await p.waitForTimeout(500);
  foto('1-risposta');
  console.log('SEL', JSON.stringify(await p.evaluate(() => { const r = getSelection().getRangeAt(0).getBoundingClientRect(); return [r.left, r.top, r.bottom, devicePixelRatio, innerWidth, innerHeight]; })));
  console.log('POP', JSON.stringify(await statoDi(app, p, '.sn-popup')));
  console.log('STATO', JSON.stringify(await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; const t = tm.tabs.find((x) => x.id === tm.activeId); return tm.riquadri.stato(t.view.webContents); })));
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open({ testo: 'Una prova' }));
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  await p.waitForTimeout(600);
  foto('2-feedback');
  const shell = app.windows().find((w) => w.url().startsWith('filo://shell'));
  console.log('DIM', await shell.evaluate(() => document.documentElement.dataset.feedbackDim || 'no'));
  console.log('STATO', JSON.stringify(await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; const t = tm.tabs.find((x) => x.id === tm.activeId); return tm.riquadri.stato(t.view.webContents); })));
});
