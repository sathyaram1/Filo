// Esplorazione del giro 2 di #1509.1: altre porte della stessa causa e altri tasti del browser.
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, scrivi, conta, paginaDelloStrato } from '../../helpers/riquadri.mjs';

const SPIA = `<script>
  window.__letti = [];
  const leggi = () => { try { const s = String(getSelection()); if (s) window.__letti.push(s); } catch (_) {} };
  document.addEventListener('selectionchange', leggi, true);
  for (const t of ['copy', 'cut', 'selectstart', 'keyup', 'keydown', 'mouseup', 'input', 'beforeinput']) window.addEventListener(t, (e) => { leggi(); if (e.data) window.__letti.push(e.data); if (e.key && e.key.length === 1) window.__letti.push(e.key); }, true);
  setInterval(leggi, 50);
  window.trova = (s) => { try { getSelection().removeAllRanges(); } catch (_) {} return window.find(s, false, false, true); };
  window.cosaHaVisto = () => window.__letti.join('');
</script>`;
const pagina = `<!doctype html><html><head><meta charset="utf-8"></head><body style="padding:40px;font:20px sans-serif"><p>Il <span id="parola">gatto</span> dorme.</p>${SPIA}</body></html>`;

async function modelloFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, streamComplete: async ({ onDelta }) => { onDelta('The cat sleeps.'); return { text: 'The cat sleeps.', usage: {} }; } };
  });
}

test('aiuto: scritto e selezionato, il sito lo legge?', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina);
  await nelMondoDiFilo(app, p, () => globalThis.SN_SIDEBAR.open());
  await expect.poll(() => statoDi(app, p, '.sn-sidebar-input textarea')).not.toBeNull();
  const st = await statoDi(app, p, '.sn-sidebar-input textarea');
  console.log('AIUTO nello strato?', !!st.nelloStrato);
  const dove = await scrivi(app, p, '.sn-sidebar-input textarea', 'quaderno-privato-1509 password');
  await dove.keyboard.press('ControlOrMeta+A');
  await dove.keyboard.press('ControlOrMeta+C');
  await p.waitForTimeout(500);
  console.log('AIUTO il sito ha visto:', JSON.stringify((await p.evaluate(() => window.cosaHaVisto())).slice(0, 300)));
  console.log('AIUTO trova:', await p.evaluate(() => window.trova('quaderno')));
});

const premi = (app, k, m) => app.evaluate(async ({ webContents }, { k: kk, m: mm }) => {
  const f = webContents.getFocusedWebContents();
  const dove = f.getURL();
  f.sendInputEvent({ type: 'keyDown', keyCode: kk, modifiers: mm });
  try { f.sendInputEvent({ type: 'keyUp', keyCode: kk, modifiers: mm }); } catch (_) {}
  await new Promise((ok) => setTimeout(ok, 1000));
  return dove;
}, { k, m });

const stato = (app) => app.evaluate(({ BrowserWindow, webContents }) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tm = w._filoTabs;
  const f = webContents.getFocusedWebContents();
  return { schede: tm.tabs.map((t) => t.view.webContents.getURL()), attiva: tm.activeId, attivaUrl: tm.tabs.find((t) => t.id === tm.activeId)?.view.webContents.getURL(), fuoco: f && f.getURL(), zoom: tm.tabs.find((t) => t.id === tm.activeId)?.view.webContents.getZoomFactor() };
});

async function traduci(app, p) {
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await p.locator('#parola').dblclick();
  await app.evaluate(({ BrowserWindow }) => globalThis.__filoShortcuts.dispatch('translate-selection', BrowserWindow.getAllWindows().find((w) => w._filoTabs)));
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  await expect.poll(() => app.evaluate(({ webContents }) => String(webContents.getFocusedWebContents()?.getURL() || ''))).toMatch(/^filo:\/\/riquadri\//);
}

for (const [nome, k, m] of [
  ['ctrl+L', 'L', ['control']], ['ctrl+R', 'R', ['control']], ['F5', 'F5', []], ['ctrl+T', 'T', ['control']],
  ['ctrl+Tab', 'Tab', ['control']], ['alt+2', '2', ['alt']], ['ctrl+2', '2', ['control']], ['ctrl+plus', '=', ['control']],
  ['ctrl+F', 'F', ['control']], ['ctrl+shift+T', 'T', ['control', 'shift']], ['ctrl+N', 'N', ['control']], ['ctrl+D', 'D', ['control']],
]) {
  test(`tasto ${nome} con la risposta aperta`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await modelloFinto(app);
    await testServer.openReady(openTab, '<h1>altra</h1>');
    const p = await testServer.openReady(openTab, pagina);
    await traduci(app, p);
    const prima = await stato(app);
    const dove = await premi(app, k, m);
    const dopo = await stato(app);
    console.log(`TASTO ${nome} da ${dove}\n  prima ${JSON.stringify(prima)}\n  dopo  ${JSON.stringify(dopo)}\n  popup ${await conta(app, p, '.sn-popup').catch(() => 'x')}`);
  });
  test(`tasto ${nome} sulla pagina senza riquadro`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await testServer.openReady(openTab, '<h1>altra</h1>');
    const p = await testServer.openReady(openTab, pagina);
    await app.evaluate(({ BrowserWindow }, u) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
      w.show(); w.focus();
      w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
    }, p.url());
    const prima = await stato(app);
    const dove = await premi(app, k, m);
    const dopo = await stato(app);
    console.log(`PAGINA ${nome} da ${dove}\n  prima ${JSON.stringify(prima)}\n  dopo  ${JSON.stringify(dopo)}`);
  });
}

test('cambio scheda e ritorno con la risposta aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const altra = await testServer.openReady(openTab, '<h1>altra</h1>');
  const p = await testServer.openReady(openTab, pagina);
  await traduci(app, p);
  const ids = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.tabs.map((t) => t.id));
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activate(id), ids[ids.length - 2]);
  await p.waitForTimeout(500);
  const sv = await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs; return [...tm.riquadri.strati.values()].map((s) => s.visibile); });
  console.log('CAMBIO strato visibile su altra scheda:', JSON.stringify(sv));
  await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.activate(id), ids[ids.length - 1]);
  await p.waitForTimeout(500);
  const sv2 = await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs; return [...tm.riquadri.strati.values()].map((s) => s.visibile); });
  console.log('CAMBIO strato visibile al ritorno:', JSON.stringify(sv2), 'popup', await conta(app, p, '.sn-popup'));
  const strato = await paginaDelloStrato(app, p);
  await strato.screenshot({ path: 'tests/.shots/1509-giro2-ritorno.png' });
  void altra;
});
