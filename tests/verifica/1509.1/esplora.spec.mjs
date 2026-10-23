// Esplorazione del giro 3 (#1509.1): si cancella prima della critica.
import { test, expect } from '../../fixtures/electron.mjs';
import { statoDi, conta, paginaDelloStrato, nelMondoDiFilo } from '../../helpers/riquadri.mjs';

const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p style="font-size:20px">Il <span id="parola">gatto</span> dorme.</p>${corpo}</body></html>`;

let RISPOSTA = 'The cat sleeps.';
async function modelloFinto(app, testo) {
  await app.evaluate(async (_e, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: 'ok', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta(t); return { text: t, usage: {} }; },
    };
  }, testo || RISPOSTA);
}
const comando = (app, nome) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch(c, win);
}, nome);
const statoStrato = (app, u) => app.evaluate(({ BrowserWindow, webContents }, url) => {
  const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
  const tab = w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === url);
  const st = w._filoTabs.riquadri.stato(tab.view.webContents);
  const f = webContents.getFocusedWebContents();
  return { st, tab: tab.view.getBounds(), fuoco: f ? String(f.getURL()) : null, attiva: w._filoTabs.activeId === tab.id };
}, u);

async function traduci(app, p) {
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await p.locator('#parola').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).not.toBe('');
}

test('cambio scheda e ritorno', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  console.log('A aperta', JSON.stringify(await statoStrato(app, p.url())));
  const q = await testServer.openReady(openTab, pagina());
  await p.waitForTimeout(500);
  console.log('A dietro', JSON.stringify(await statoStrato(app, p.url())));
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.view?.webContents?.getURL() === u);
    w._filoTabs.activate(t.id);
  }, p.url());
  await p.waitForTimeout(800);
  console.log('A tornata', JSON.stringify(await statoStrato(app, p.url())), await conta(app, p, '.sn-popup'));
  // finestra ridimensionata
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w.setSize(900, 600); });
  await p.waitForTimeout(800);
  console.log('A ridimensionata', JSON.stringify(await statoStrato(app, p.url())));
  void q;
});

test('selezione e fuoco dopo Esc', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<input id="campo">'));
  await traduci(app, p);
  console.log('prima Esc', JSON.stringify(await statoStrato(app, p.url())), await p.evaluate(() => String(getSelection())));
  const strato = await paginaDelloStrato(app, p);
  await strato.keyboard.press('Escape');
  await expect.poll(() => conta(app, p, '.sn-popup')).toBe(0);
  await p.waitForTimeout(500);
  console.log('dopo Esc', JSON.stringify(await statoStrato(app, p.url())), 'sel=', await p.evaluate(() => String(getSelection())));
});

test('collegamento nella risposta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const dest = testServer.html('<h1>destinazione</h1>');
  await modelloFinto(app, `Vedi [la pagina](${dest}) qui.`);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const a = await statoDi(app, p, 'a.filo-md-link');
  console.log('link', JSON.stringify(a));
  const strato = await paginaDelloStrato(app, p);
  await strato.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
  await p.waitForTimeout(2000);
  const urls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.view.webContents.getURL()));
  console.log('schede', JSON.stringify(urls), dest);
});

test('navigazione dalla pagina con la risposta aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const dest = testServer.html('<h1>altrove</h1>');
  const p = await testServer.openReady(openTab, pagina(`<p><a id="vai" href="${dest}" style="font-size:30px">vai</a></p>`));
  await traduci(app, p);
  const b = await p.locator('#vai').boundingBox();
  const strato = await paginaDelloStrato(app, p);
  console.log('vai box', JSON.stringify(b), JSON.stringify(await statoStrato(app, p.url())));
  await strato.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await p.waitForTimeout(2000);
  const urls = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.view.webContents.getURL()));
  console.log('dopo clic', JSON.stringify(urls), dest, p.url());
  await expect.poll(() => p.url(), { timeout: 5000 }).toBe(dest);
  await p.waitForTimeout(800);
  console.log('dopo navigazione', JSON.stringify(await statoStrato(app, p.url())), await conta(app, p, '.sn-popup'));
});

test('zoom 150% posa accanto alla parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.setZoomFactor(1.5);
  }, p.url());
  await p.waitForTimeout(500);
  await traduci(app, p);
  const r = await p.locator('#parola').evaluate((el) => { const b = el.getBoundingClientRect(); return { x: b.x * 1.5, y: b.y * 1.5, b: b.bottom * 1.5 }; });
  const pop = await statoDi(app, p, '.sn-popup');
  console.log('parola(vista)', JSON.stringify(r), 'popup', JSON.stringify({ l: pop.left, t: pop.top, b: pop.bottom }));
});

test('feedback aperto due volte', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => conta(app, p, '.sn-fb-overlay')).toBe(1);
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await p.waitForTimeout(800);
  console.log('feedback overlay', await conta(app, p, '.sn-fb-overlay'));
});

test('feedback con screenshot, invio fallito: la tastiera resta al feedback', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => conta(app, p, '.sn-fb-overlay')).toBe(1);
  const { neiRiquadri, clicca } = await import('../../helpers/riquadri.mjs');
  await neiRiquadri(app, p, () => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => (m && m.type === 'submit_feedback' ? Promise.resolve({ ok: false, error: 'rete giù' }) : orig(m, ...r));
    return true;
  });
  const strato = await clicca(app, p, '.sn-fb-text');
  await strato.keyboard.insertText('primo pezzo');
  await clicca(app, p, '.sn-fb-clear');
  console.log('prima invio', JSON.stringify(await statoStrato(app, p.url())));
  await clicca(app, p, '.sn-fb-send');
  await p.waitForTimeout(2500);
  console.log('dopo invio', JSON.stringify(await statoStrato(app, p.url())), JSON.stringify(await statoDi(app, p, '.sn-fb-status')));
  await strato.keyboard.insertText(' secondo');
  await app.evaluate(({ webContents }) => { const f = webContents.getFocusedWebContents(); if (f) { f.sendInputEvent({ type: 'char', keyCode: 'x' }); } });
  await p.waitForTimeout(500);
  console.log('testo feedback', JSON.stringify((await statoDi(app, p, '.sn-fb-text'))?.valore));
});

test('tasto destro sul testo della risposta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  await traduci(app, p);
  const r = await statoDi(app, p, '.sn-popup-body');
  const strato = await paginaDelloStrato(app, p);
  await strato.mouse.click(r.x + 20, r.y + 8, { button: 'right' });
  await p.waitForTimeout(1500);
  const menu = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => String(w.getURL())).filter((u) => /menu|riquadri/.test(u)));
  console.log('viste', JSON.stringify(menu));
  console.log('menu nello strato riquadri', await conta(app, p, '.sn-menu'));
  const voci = await nelMondoDiFilo(app, p, () => 0);
  void voci;
});

test('Modifica su un contenteditable', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = { ...orig, complete: async () => ({ text: 'Testo riscritto per bene.', usage: {} }) };
  });
  const p = await testServer.openReady(openTab, pagina('<div id="ed" contenteditable="true" style="width:400px;min-height:60px;border:1px solid #999">Un testo con un erore.</div>'));
  await p.evaluate(() => { const d = document.querySelector('#ed'); d.focus(); const r = document.createRange(); r.selectNodeContents(d); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  const { menuDi } = await import('../../helpers/menuContestuale.mjs');
  const { clicca } = await import('../../helpers/riquadri.mjs');
  await p.locator('#ed').click({ button: 'right' });
  await expect(menuDi(p).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await menuDi(p).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, p, '.sn-editbox-instruction')).not.toBeNull();
  const strato = await clicca(app, p, '.sn-editbox-instruction');
  await strato.keyboard.insertText('correggi');
  await strato.keyboard.press('Enter');
  await expect.poll(async () => (await statoDi(app, p, '.sn-editbox-proposed'))?.testo || '', { timeout: 15000 }).toContain('riscritto');
  await clicca(app, p, '.sn-editbox-replace');
  await p.waitForTimeout(1000);
  console.log('contenteditable', JSON.stringify(await p.locator('#ed').innerText()), 'fuoco', await p.evaluate(() => document.activeElement && document.activeElement.id));
});

for (const modo of ['clic-strato', 'goto', 'clic-senza-riquadro', 'location']) {
  test(`nav-${modo}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await modelloFinto(app);
    const dest = testServer.html('<h1>altrove</h1>');
    const p = await testServer.openReady(openTab, pagina(`<p><a id="vai" href="${dest}" style="font-size:30px">vai</a></p>`));
    if (modo !== 'clic-senza-riquadro') await traduci(app, p);
    const b = await p.locator('#vai').boundingBox();
    const t0 = Date.now();
    if (modo === 'clic-strato') {
      const strato = await paginaDelloStrato(app, p);
      await strato.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    } else if (modo === 'goto') {
      await app.evaluate(({ BrowserWindow }, u) => { const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs); w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.loadURL(u + '?b'); }, p.url());
    } else if (modo === 'location') {
      await p.evaluate((d) => { setTimeout(() => { location.href = d; }, 10); }, dest);
    } else {
      await app.evaluate(({ BrowserWindow }, { u, x, y }) => { const w = BrowserWindow.getAllWindows().find((q) => q._filoTabs); const wc = w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents; wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); }, { u: p.url(), x: Math.round(b.x + 10), y: Math.round(b.y + 10) });
    }
    for (let i = 0; i < 12; i++) {
      const r = await Promise.race([app.evaluate(() => 'vivo'), new Promise((ok) => setTimeout(() => ok('BLOCCATO'), 3000))]);
      console.log(modo, Date.now() - t0, r);
      if (r === 'BLOCCATO') { await new Promise((ok) => setTimeout(ok, 1000)); continue; }
      await new Promise((ok) => setTimeout(ok, 1000));
    }
  });
}

for (const modo of ['input-strato', 'clic-strato-bottone']) {
  test(`nav2-${modo}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(60_000);
    await modelloFinto(app);
    const dest = testServer.html('<h1>altrove</h1>');
    const p = await testServer.openReady(openTab, pagina(`<p><a id="vai" href="${dest}" style="font-size:30px">vai</a></p><button id="bt" onclick="window.__c=(window.__c||0)+1">b</button>`));
    await traduci(app, p);
    const b = await p.locator(modo === 'input-strato' ? '#vai' : '#bt').boundingBox();
    const t0 = Date.now();
    if (modo === 'input-strato') {
      await app.evaluate(({ webContents }, { x, y }) => {
        const f = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith('filo://riquadri/'));
        f.sendInputEvent({ type: 'mouseMove', x, y });
        f.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        f.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      }, { x: Math.round(b.x + 10), y: Math.round(b.y + 10) });
    } else {
      const strato = await paginaDelloStrato(app, p);
      await strato.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    }
    for (let i = 0; i < 8; i++) {
      const r = await Promise.race([app.evaluate(() => 'vivo'), new Promise((ok) => setTimeout(() => ok('BLOCCATO'), 3000))]);
      console.log(modo, Date.now() - t0, r);
      await new Promise((ok) => setTimeout(ok, 1000));
    }
    console.log(modo, 'url', p.url());
  });
}

for (const giro of [1, 2]) test(`nav3-traccia-${giro}`, async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const dest = testServer.html('<h1>altrove</h1>');
  const p = await testServer.openReady(openTab, pagina(`<p><a id="vai" href="${dest}" style="font-size:30px">vai</a></p>`));
  await traduci(app, p);
  const b = await p.locator('#vai').boundingBox();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const R = w._filoTabs.riquadri;
    globalThis.__righe = []; const log = (m) => { globalThis.__righe.push(`${Date.now() % 100000} ${m}`); };
    globalThis.__traccia = log;
    for (const nome of ['_butta', '_restituisci', 'posa', '_nascondi', '_inCima', '_tastiera', 'inCima', '_dalloStrato']) {
      const orig = R[nome];
      R[nome] = function (...a) { log(`> ${nome} ${nome === '_dalloStrato' ? a[1] + ' ' + JSON.stringify(a[2]).slice(0, 80) : ''}`); const r = orig.apply(this, a); log(`< ${nome}`); return r; };
    }
    for (const s of R.strati.values()) {
      const oi = s.vuoto.inoltra.bind(s.vuoto);
      s.vuoto.inoltra = (d) => { log(`> inoltra ${d && d.tipo}`); oi(d); log(`< inoltra ${d && d.tipo}`); };
    }
    const tab = w._filoTabs.tabs.find((t) => /\/2$/.test(t.view.webContents.getURL()) || true);
    void tab;
    for (const t of w._filoTabs.tabs) {
      const wc = t.view.webContents;
      for (const ev of ['will-navigate', 'did-start-navigation', 'did-navigate', 'did-finish-load', 'focus', 'blur']) wc.on(ev, () => log(`tab ${wc.id} ${ev}`));
    }
  });
  await app.evaluate(({ webContents }, { x, y }) => {
    const f = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith('filo://riquadri/'));
    for (const ev of ['destroyed', 'focus', 'blur', 'render-process-gone']) f.on(ev, () => globalThis.__traccia(`strato ${ev}`));
    f.sendInputEvent({ type: 'mouseMove', x, y });
    f.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    f.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }, { x: Math.round(b.x + 10), y: Math.round(b.y + 10) });
  for (let i = 0; i < 4; i++) {
    const r = await Promise.race([app.evaluate(() => 'vivo'), new Promise((ok) => setTimeout(() => ok('BLOCCATO'), 3000))]);
    console.log('traccia', r);
  }
  console.log((await app.evaluate(() => globalThis.__righe)).join('\n'));
  console.log('url', p.url());
});

test('nav4-eccezione', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const dest = testServer.html('<h1>altrove</h1>');
  const p = await testServer.openReady(openTab, pagina(`<p><a id="vai" href="${dest}" style="font-size:30px">vai</a></p>`));
  await traduci(app, p);
  const b = await p.locator('#vai').boundingBox();
  await app.evaluate(({ dialog }) => {
    globalThis.__errori = [];
    process.prependListener('uncaughtException', (e) => { globalThis.__errori.push(String(e && e.stack || e).slice(0, 1500)); });
    dialog.showErrorBox = (t, c) => { globalThis.__errori.push(`DIALOG ${t}: ${String(c).slice(0, 1500)}`); };
  });
  await app.evaluate(({ webContents }, { x, y }) => {
    const f = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith('filo://riquadri/'));
    f.sendInputEvent({ type: 'mouseMove', x, y });
    f.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    f.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  }, { x: Math.round(b.x + 10), y: Math.round(b.y + 10) });
  for (let i = 0; i < 4; i++) {
    const r = await Promise.race([app.evaluate(() => globalThis.__errori), new Promise((ok) => setTimeout(() => ok('BLOCCATO'), 3000))]);
    console.log('eccezione', JSON.stringify(r, null, 1));
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  console.log('url', p.url());
});

test('nav5-dopo-un-minuto', async ({ app, openTab, testServer }) => {
  test.setTimeout(150_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina(`<p><a id="vai" href="#x" style="font-size:30px">vai</a></p>`));
  await traduci(app, p);
  const b = await p.locator('#vai').boundingBox();
  await app.evaluate(({ dialog }) => {
    globalThis.__errori = [];
    process.prependListener('uncaughtException', (e) => { globalThis.__errori.push(String(e && e.stack || e).slice(0, 300)); });
    dialog.showErrorBox = (t, c) => { globalThis.__errori.push(`DIALOG ${t}: ${String(c).slice(0, 300)}`); };
  });
  // Il mouse passa sul vuoto dello strato, poi la risposta si chiude con Esc.
  await app.evaluate(({ webContents }) => {
    const f = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith('filo://riquadri/'));
    f.sendInputEvent({ type: 'mouseMove', x: 900, y: 600 });
    f.sendInputEvent({ type: 'mouseMove', x: 905, y: 605 });
  });
  const strato = await paginaDelloStrato(app, p);
  await strato.keyboard.press('Escape');
  await expect.poll(() => conta(app, p, '.sn-popup')).toBe(0);
  console.log('chiusa', JSON.stringify(await statoStrato(app, p.url())));
  await p.waitForTimeout(63_000);
  console.log('dopo un minuto', JSON.stringify(await statoStrato(app, p.url())));
  // L'utente passa col mouse sul collegamento della pagina.
  await app.evaluate(({ BrowserWindow }, { u, x, y }) => {
    const w = BrowserWindow.getAllWindows().find((q) => q._filoTabs);
    const wc = w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL().startsWith(u)).view.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x: 700, y: 500 });
    wc.sendInputEvent({ type: 'mouseMove', x, y });
  }, { u: p.url(), x: Math.round(b.x + 10), y: Math.round(b.y + 10) });
  await p.waitForTimeout(1500);
  console.log('errori', JSON.stringify(await app.evaluate(() => globalThis.__errori), null, 1));
});

test('feedback2 invio fallito con finestra a fuoco', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => conta(app, p, '.sn-fb-overlay')).toBe(1);
  const { neiRiquadri, clicca } = await import('../../helpers/riquadri.mjs');
  await neiRiquadri(app, p, () => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => (m && m.type === 'submit_feedback' ? Promise.resolve({ ok: false, error: 'rete giù' }) : orig(m, ...r));
    return true;
  });
  await clicca(app, p, '.sn-fb-text');
  await clicca(app, p, '.sn-fb-clear');
  console.log('prima invio', JSON.stringify(await statoStrato(app, p.url())));
  await clicca(app, p, '.sn-fb-text');
  await p.waitForTimeout(300);
  console.log('dopo clic testo', JSON.stringify(await statoStrato(app, p.url())));
  await clicca(app, p, '.sn-fb-send');
  await p.waitForTimeout(2500);
  console.log('dopo invio', JSON.stringify(await statoStrato(app, p.url())));
});

test('touch: scorrere la pagina col dito con la risposta aperta', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<div style="height:4000px"></div>'));
  // Controllo: senza riquadro il dito scorre la pagina.
  const cdpP = await p.context().newCDPSession(p);
  const swipe = async (s) => {
    await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 600 }] });
    for (let i = 1; i <= 10; i++) await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 700, y: 600 - i * 30 }] });
    await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await swipe(cdpP);
  await p.waitForTimeout(800);
  console.log('senza riquadro scrollY', await p.evaluate(() => scrollY));
  await p.evaluate(() => scrollTo(0, 0));
  await traduci(app, p);
  const strato = await paginaDelloStrato(app, p);
  const cdpS = await strato.context().newCDPSession(strato);
  await swipe(cdpS);
  await p.waitForTimeout(800);
  console.log('con riquadro scrollY', await p.evaluate(() => scrollY), 'popup', await conta(app, p, '.sn-popup'));
});

for (const tema of ['light', 'dark']) {
  test(`aspetto-${tema}`, async ({ app, openTab, testServer }) => {
    test.setTimeout(90_000);
    await modelloFinto(app, 'Il gatto: **the cat**. Si usa per indicare il felino domestico; vedi anche *kitten* per un cucciolo.');
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    const p = await testServer.openReady(openTab, pagina('<p>Testo della pagina sotto per vedere la trasparenza. Lorem ipsum dolor sit amet.</p>'));
    await traduci(app, p);
    await p.waitForTimeout(1200);
    const strato = await paginaDelloStrato(app, p);
    await p.screenshot({ path: `tests/.shots/1509-${tema}-pagina.png` });
    await strato.screenshot({ path: `tests/.shots/1509-${tema}-strato.png`, omitBackground: true });
  });
}
