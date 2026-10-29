// Esplorazione del giro 6 di #1509.1: strade intorno ai riquadri nello strato sopra la scheda.

import fs from 'node:fs';
import { test, expect } from '../../fixtures/electron.mjs';
import { nelMondoDiFilo, statoDi, clicca, conta, paginaDelloStrato } from '../../helpers/riquadri.mjs';

const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p style="font-size:20px">Il <span id="parola">gatto</span> dorme sul <span id="altra">divano</span>.</p>${corpo}`
  + `<script>window.__sopra=0;document.addEventListener('mouseover',(e)=>{if(e.target.id==='zona')window.__sopra++;});</script></body></html>`;

async function modelloFinto(app, risposta) {
  await app.evaluate(async (_e, r) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_SELECTION || 'explain']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: r, usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(r); return { text: r, usage: {} }; },
    };
  }, risposta);
}

const comando = (app, nome) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch(c, win);
}, nome);

const strato = (app, u) => app.evaluate(({ BrowserWindow }, url) => {
  const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
  const tab = tm.tabs.find((t) => t.view?.webContents?.getURL() === url);
  const s = tab && tm.riquadri.strati.get(tab.view.webContents);
  if (!s) return null;
  return { visibile: s.vista.getVisible(), b: s.vista.getBounds(), tab: tab.view.getBounds(), attiva: tm.activeId === tab.id };
}, u);

async function traduci(app, p, testo = 'The cat sleeps.') {
  await p.locator('#parola').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain(testo);
}

test('link nella risposta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dest = testServer.html('<h1>destinazione</h1>');
  await modelloFinto(app, `The cat. Vedi [la pagina](${dest}).`);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p, 'The cat');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body a'))?.testo || '').toContain('la pagina');
  await clicca(app, p, '.sn-popup-body a');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
    .find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.view.webContents.getURL())), { timeout: 8000 }).toContain(dest);
});

test('cambio scheda, ridimensiona, barra laterale', async ({ app, openTab, testServer }) => {
  test.setTimeout(120_000);
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const u = p.url();
  let st = await strato(app, u);
  console.log('aperto', JSON.stringify(st));
  expect(st.visibile).toBe(true);
  const altra = await testServer.openReady(openTab, '<h1>altra</h1>');
  await expect.poll(async () => (await strato(app, u)).visibile).toBe(false);
  await app.evaluate(({ BrowserWindow }, url) => {
    const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs;
    tm.activate(tm.tabs.find((t) => t.view.webContents.getURL() === url).id);
  }, u);
  await expect.poll(async () => (await strato(app, u)).visibile).toBe(true);
  st = await strato(app, u);
  console.log('tornato', JSON.stringify(st));
  expect(st.b).toEqual(st.tab);
  expect(await conta(app, p, '.sn-popup')).toBe(1);

  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const [a, b] = w.getSize(); w.setSize(a - 200, b - 100); });
  await p.waitForTimeout(800);
  st = await strato(app, u);
  console.log('ridimensionata', JSON.stringify(st));
  expect(st.b).toEqual(st.tab);

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.barra.commuta('tasto'); });
  await p.waitForTimeout(1200);
  st = await strato(app, u);
  console.log('barra', JSON.stringify(st));
  expect(st.b).toEqual(st.tab);
  void altra;
});

test('con la risposta aperta: passaggio sopra, doppio clic su un\'altra parola, seconda traduzione', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina('<div id="zona" style="margin-top:300px;width:300px;height:100px;background:#eee">zona</div>'));
  await traduci(app, p);
  const sopra = await paginaDelloStrato(app, p);
  const z = await p.locator('#zona').boundingBox();
  await sopra.mouse.move(z.x + 10, z.y + 10);
  await sopra.mouse.move(z.x + 40, z.y + 40);
  await expect.poll(() => p.evaluate(() => window.__sopra)).toBeGreaterThan(0);
  const a = await p.locator('#altra').boundingBox();
  await sopra.mouse.dblclick(a.x + a.width / 2, a.y + a.height / 2);
  await expect.poll(() => p.evaluate(() => String(getSelection()).trim())).toBe('divano');
  await comando(app, 'translate-selection');
  await p.waitForTimeout(1500);
  console.log('popup', await conta(app, p, '.sn-popup'));
  const shot = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w._filoTabs).capturePage()).toPNG().toString('base64'));
  fs.mkdirSync('tests/.shots', { recursive: true });
  fs.writeFileSync('tests/.shots/1509-giro6-due.png', Buffer.from(shot, 'base64'));
});

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await modelloFinto(app, 'The cat sleeps on the sofa. **Gatto** is a common noun.');
    await app.evaluate((_e, t) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: t } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }), tema);
    const p = await testServer.openReady(openTab, pagina('<p>Testo della pagina, un paragrafo qualunque per vedere cosa sta sotto.</p>'));
    await traduci(app, p, 'The cat');
    await p.waitForTimeout(800);
    const sopra = await paginaDelloStrato(app, p);
    await p.screenshot({ path: `tests/.shots/1509-g6-${tema}-pagina.png` });
    await sopra.screenshot({ path: `tests/.shots/1509-g6-${tema}-strato.png`, omitBackground: true });
    await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
    await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
    await p.waitForTimeout(800);
    await sopra.screenshot({ path: `tests/.shots/1509-g6-${tema}-fb-strato.png`, omitBackground: true });
  });
}

test('tasto destro sulla risposta: il menu di Filo e Copia', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const { menuDelloStratoAperto } = await import('../../helpers/menuContestuale.mjs');
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const sopra = await paginaDelloStrato(app, p);
  const b = await statoDi(app, p, '.sn-popup-body');
  await sopra.mouse.dblclick(b.x + 30, b.y + 25);
  console.log('selezione nello strato', await sopra.evaluate(() => String(getSelection())));
  await sopra.mouse.click(b.x + 30, b.y + 25, { button: 'right' });
  let m = null;
  await new Promise((r) => setTimeout(r, 1500));
  console.log('menu nello strato dei riquadri', await sopra.locator('.sn-menu').count(), 'via _test', await conta(app, p, '.sn-menu'));
  console.log('finestre', JSON.stringify(app.windows().map((w) => w.url())));
  await sopra.screenshot({ path: 'tests/.shots/1509-g6-destro.png', omitBackground: true });
  await app.evaluate(({ clipboard }) => clipboard.writeText('vuoto'));
  await sopra.locator('.sn-menu-item', { hasText: 'Copia' }).first().click();
  await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('The');
  void m; void menuDelloStratoAperto;
});

test('con la risposta aperta la scheda va alla Home', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const id = await app.evaluate(({ BrowserWindow }) => { const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; return tm.activeId; });
  await app.evaluate(({ BrowserWindow }, i) => { const tm = BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs; tm.navigate ? tm.navigate(i, 'filo://newtab/') : tm.loadUrl(i, 'filo://newtab/'); }, id);
  await new Promise((r) => setTimeout(r, 2500));
  const r = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); const tm = w._filoTabs;
    const viste = w.contentView.children.map((v) => { try { return { u: v.webContents.getURL(), vis: v.getVisible(), b: v.getBounds() }; } catch (_) { return null; } });
    return { url: tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getURL(), strati: tm.riquadri.strati.size, viste };
  });
  console.log(JSON.stringify(r));
  expect(r.viste.filter((v) => v && String(v.u).startsWith('filo://riquadri/') && v.vis)).toEqual([]);
});

test('traduco una parola nel mio campo, Esc, continuo a scrivere nel campo', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina('<textarea id="campo" style="width:400px;height:80px">il gatto dorme</textarea>'));
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await p.locator('#campo').click();
  await p.evaluate(() => { const t = document.querySelector('#campo'); t.setSelectionRange(3, 8); });
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  await expect.poll(() => app.evaluate(({ webContents }) => String(webContents.getFocusedWebContents()?.getURL() || ''))).toMatch(/^filo:\/\/riquadri\//);
  await app.evaluate(({ webContents }) => {
    const f = webContents.getFocusedWebContents();
    f.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    f.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  });
  await expect.poll(() => conta(app, p, '.sn-popup')).toBe(0);
  const dove = await app.evaluate(({ webContents }) => String(webContents.getFocusedWebContents()?.getURL() || ''));
  console.log('tastiera dopo Esc:', dove, 'attivo:', await p.evaluate(() => document.activeElement && document.activeElement.id));
  await app.evaluate(({ webContents }) => {
    const f = webContents.getFocusedWebContents();
    f.sendInputEvent({ type: 'char', keyCode: 'X' });
  });
  await p.waitForTimeout(300);
  console.log('campo:', await p.locator('#campo').inputValue());
  expect(await p.locator('#campo').inputValue()).toContain('X');
});

test('feedback aperto, Ctrl+Tab dallo strato: la tastiera va alla scheda nuova', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const b = await testServer.openReady(openTab, '<h1>B</h1><textarea id="tb"></textarea><script>document.querySelector("#tb").focus()</script>');
  const p = await testServer.openReady(openTab, pagina());
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  await expect.poll(() => app.evaluate(({ webContents }) => String(webContents.getFocusedWebContents()?.getURL() || ''))).toMatch(/^filo:\/\/riquadri\//);
  await app.evaluate(({ webContents }) => {
    const f = webContents.getFocusedWebContents();
    f.sendInputEvent({ type: 'keyDown', keyCode: 'Tab', modifiers: ['control', 'shift'] });
    f.sendInputEvent({ type: 'keyUp', keyCode: 'Tab', modifiers: ['control', 'shift'] });
  });
  await new Promise((r) => setTimeout(r, 800));
  const st = await app.evaluate(({ BrowserWindow, webContents }) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    return { attiva: tm.tabs.find((t) => t.id === tm.activeId).view.webContents.getURL(), fuoco: String(webContents.getFocusedWebContents()?.getURL() || '') };
  });
  console.log('dopo Ctrl+Shift+Tab', JSON.stringify(st), 'B', b.url());
  await app.evaluate(({ webContents }) => { webContents.getFocusedWebContents().sendInputEvent({ type: 'char', keyCode: 'Q' }); });
  await new Promise((r) => setTimeout(r, 300));
  console.log('tb:', await b.locator('#tb').inputValue(), 'fb:', (await statoDi(app, p, '.sn-fb-text'))?.valore);
  expect(st.fuoco).toBe(b.url());
});

test('zoom della pagina 150%: la risposta accanto alla parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina('<div style="height:300px"></div><p style="font-size:20px">Un altro <span id="giu">cane</span> qui.</p>'));
  await app.evaluate(({ BrowserWindow }, u) => {
    const tm = BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs;
    tm.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.setZoomFactor(1.5);
  }, p.url());
  await p.waitForTimeout(500);
  await p.locator('#giu').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  const r = await statoDi(app, p, '.sn-popup');
  const w = await p.locator('#giu').boundingBox();
  // la parola in px della vista: px CSS * zoom
  const z = 1.5;
  console.log('parola vista', w.x * z, w.y * z, (w.y + w.height) * z, 'riquadro', r.left, r.top, r.bottom);
  expect(r.top >= (w.y + w.height) * z - 2 || r.bottom <= w.y * z + 2).toBe(true);
  expect(Math.abs(r.top - (w.y + w.height) * z) < 60 || Math.abs(r.bottom - w.y * z) < 60).toBe(true);
});

test('feedback inviato da un sito: il grazie si vede', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => {
    globalThis.SN_FEEDBACK.submit = async (payload) => ({ id: 'test_' + (payload && payload.submissionId), failed: [] });
  });
  const p = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  const sopra = await paginaDelloStrato(app, p);
  await clicca(app, p, '.sn-fb-text');
  await sopra.keyboard.insertText('una prova di invio dal sito');
  await clicca(app, p, '.sn-fb-send');
  await expect.poll(() => conta(app, p, '.sn-fb-modal'), { timeout: 15_000 }).toBe(0);
  let visto = '';
  await expect.poll(async () => (visto = await sopra.evaluate(() => document.documentElement.innerText || '')), { timeout: 8000 }).toMatch(/inviato|Inviato|partir|coda/);
  console.log('testo nello strato:', visto.slice(0, 200));
  const st = await strato(app, p.url());
  console.log('strato', JSON.stringify(st));
  await p.waitForTimeout(300);
  await sopra.screenshot({ path: 'tests/.shots/1509-g6-grazie.png', omitBackground: true });
  expect(st.visibile).toBe(true);
});

test('un avviso della barra in basso a destra: l\'avviso di un riquadro sopra un sito non ci finisce sotto', async ({ app, shell, testServer, avvisi, openTab }) => {
  test.setTimeout(90_000);
  const { nelloStrato } = await import('../../helpers/riquadri.mjs');
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  await shell.evaluate(() => window.filoNotify('Scaricato: report.pdf', { durationSec: 0, actions: [{ label: 'Apri file', onClick: () => {} }] }));
  const vista = await avvisi();
  await expect.poll(() => vista.locator('.shell-notif.show').count()).toBeGreaterThan(0);
  await p.waitForTimeout(800);
  console.log('avvisi:', JSON.stringify(await vista.locator('.shell-notif.show').allTextContents()));
  const av = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const v = w.contentView.children.find((c) => { try { return c.webContents.getURL().includes('avvisi.html'); } catch (_) { return false; } });
    return v.getBounds();
  });
  // Lo stesso avviso, nella pagina e nello strato.
  await nelMondoDiFilo(app, p, () => { globalThis.SN_POPUP.showToast('avviso nella pagina', { duration: 20000 }); return 1; });
  await nelloStrato(app, p, () => { globalThis.SN_POPUP.showToast('avviso nello strato', { duration: 20000 }); return 1; });
  await p.waitForTimeout(800);
  const TOAST = () => { const T = globalThis.SN_FILO_UI && globalThis.SN_FILO_UI._test; const el = T ? T.trova('.sn-toast') : document.querySelector('.sn-toast'); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, t: el.textContent }; };
  const inPagina = await nelMondoDiFilo(app, p, TOAST);
  const inStrato = await nelloStrato(app, p, TOAST);
  const st = await strato(app, p.url());
  console.log('avvisi barra', JSON.stringify(av), 'pagina', JSON.stringify(inPagina), 'strato', JSON.stringify(inStrato), 'offset strato', JSON.stringify(st.b));
  await vista.screenshot({ path: 'tests/.shots/1509-g6-avvisi.png', omitBackground: true });
  const fondoStrato = inStrato.bottom + st.b.y;
  const destraStrato = inStrato.right + st.b.x;
  expect(fondoStrato <= av.y || destraStrato <= av.x, 'l\'avviso nello strato finisce sotto la vista degli avvisi della barra').toBe(true);
});

test('schermo intero con la risposta aperta: lo strato segue la scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app, 'The cat sleeps.');
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.setContentFullscreen(true); });
  await new Promise((r) => setTimeout(r, 1500));
  let st = await strato(app, p.url());
  console.log('schermo intero', JSON.stringify(st));
  expect(st.b).toEqual(st.tab);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find((x) => x._filoTabs)._filoTabs.setContentFullscreen(false); });
  await new Promise((r) => setTimeout(r, 1500));
  st = await strato(app, p.url());
  console.log('uscito', JSON.stringify(st));
  expect(st.b).toEqual(st.tab);
});
