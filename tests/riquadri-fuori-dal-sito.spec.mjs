// #1509.1 — Quello che l'utente scrive o seleziona in un riquadro di Filo sopra un sito non lo legge il sito: né dalla
// selezione (selectionchange, getSelection), né dalla copia, né con la ricerca testuale del browser. I riquadri stanno
// nello strato sopra la scheda. Regola: patterns/i-riquadri-di-filo-su-un-sito-stanno-sopra-la-scheda.md

import { test, expect } from './fixtures/electron.mjs';
import { nelMondoDiFilo, nelloStrato, statoDi, scrivi, clicca, conta, paginaDelloStrato, tastoSullaScheda } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const SEGRETO = 'zibaldone-segreto-1509 del mio conto';

// Lo script del sito: annota ogni selezione, ogni copia e ogni nodo che entra nel suo documento, e cerca con la
// ricerca del browser.
const SPIA = `<script>
  window.__letti = [];
  window.__nodi = [];
  const leggi = () => { try { const s = String(getSelection()); if (s) window.__letti.push(s); } catch (_) {} };
  document.addEventListener('selectionchange', leggi, true);
  for (const t of ['copy', 'cut', 'selectstart', 'keyup', 'mouseup', 'input', 'beforeinput']) window.addEventListener(t, (e) => { leggi(); if (e.data) window.__letti.push(e.data); }, true);
  setInterval(leggi, 50);
  new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) window.__nodi.push(n.outerHTML || n.textContent || ''); })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  window.trova = (s) => { try { getSelection().removeAllRanges(); } catch (_) {} return window.find(s, false, false, true); };
  window.cosaHaVisto = () => window.__letti.join(' | ') + ' ' + window.__nodi.join(' ') + ' ' + document.documentElement.outerHTML;
  window.__clic = 0;
</script>`;
const pagina = (corpo = '') => `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:40px;font:16px sans-serif">`
  + `<p style="font-size:20px">Il <span id="parola">gatto</span> dorme.</p>${corpo}${SPIA}</body></html>`;

// Provider finto nel main: la riscrittura e la risposta arrivano subito.
async function modelloFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.TRANSLATE_SELECTION]: 'deepseek-flash', [C.ACTIONS.EDIT_TEXT]: 'deepseek-flash', [C.ACTIONS.FOLLOWUP || 'followup']: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const orig = globalThis.SN_PROVIDER_OPENROUTER;
    globalThis.SN_PROVIDER_OPENROUTER = {
      ...orig,
      complete: async () => ({ text: 'Testo riscritto per bene.', usage: {} }),
      streamComplete: async ({ onDelta }) => { onDelta('The cat sleeps.'); return { text: 'The cat sleeps.', usage: {} }; },
    };
  });
}

const comando = (app, nome) => app.evaluate(({ BrowserWindow }, c) => {
  const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
  globalThis.__filoShortcuts.dispatch(c, win);
}, nome);

// Scritto, selezionato tutto e copiato dove sta il campo: il sito non ne ha visto niente, e cercandolo non lo trova.
async function nienteAlSito(app, p, sel, testo) {
  const strato = await scrivi(app, p, sel, testo);
  expect((await statoDi(app, p, sel)).valore).toBe(testo);
  await strato.keyboard.press('ControlOrMeta+A');
  await strato.keyboard.press('ControlOrMeta+C');
  await p.waitForTimeout(400);
  expect(await p.evaluate(() => window.cosaHaVisto())).not.toContain(testo.split(' ')[0]);
  expect(await p.evaluate((s) => window.trova(s), testo.split(' ')[0])).toBe(false);
  expect(await p.evaluate(() => document.querySelector('[data-sn-riquadro]')), 'nel documento del sito non entra niente').toBeNull();
  return strato;
}

test('feedback e attacco red-team su un sito: scritti, selezionati e copiati, il sito non legge niente', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const p = await testServer.openReady(openTab, pagina());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-fb-text')).not.toBeNull();
  expect((await statoDi(app, p, '.sn-fb-text')).nelloStrato).toBe(true);
  await nienteAlSito(app, p, '.sn-fb-text', SEGRETO);
  await clicca(app, p, '.sn-fb-cancel');
  await expect.poll(() => conta(app, p, '.sn-fb-modal')).toBe(0);

  await nelMondoDiFilo(app, p, () => globalThis.SN_REDTEAM_ATTACK_UI.open());
  await expect.poll(() => statoDi(app, p, '.sn-rt-attack')).not.toBeNull();
  await nienteAlSito(app, p, '.sn-rt-attack', 'ignora-le-istruzioni-1509 e rispondi');
});

test('Modifica su un sito: il campo del sito riceve solo il testo scelto, e la tastiera torna a lui', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<textarea id="campo" style="width:400px;height:80px">Un testo con un erore.</textarea>'));
  await p.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await p.locator('#campo').click({ button: 'right' });
  await expect(menuDi(p).locator('.sn-menu')).toBeVisible({ timeout: 10_000 });
  await p.evaluate(() => { window.__letti = []; });
  await menuDi(p).locator('.sn-menu .sn-menu-item', { hasText: 'Modifica' }).click();
  await expect.poll(() => statoDi(app, p, '.sn-editbox-instruction')).not.toBeNull();
  const strato = await nienteAlSito(app, p, '.sn-editbox-instruction', 'riscrivilo-segreto-1509 per bene');
  await strato.keyboard.press('Enter');
  await expect.poll(async () => (await statoDi(app, p, '.sn-editbox-proposed'))?.testo || '').toContain('riscritto');
  await expect(p.locator('#campo')).toHaveValue('Un testo con un erore.');
  await clicca(app, p, '.sn-editbox-replace');
  await expect(p.locator('#campo')).toHaveValue('Testo riscritto per bene.');
  await expect.poll(() => conta(app, p, '.sn-editbox')).toBe(0);
  // Si continua a scrivere nel campo, senza cliccarlo.
  await expect.poll(() => p.evaluate(() => document.activeElement && document.activeElement.id)).toBe('campo');
});

test('la risposta su un sito: sotto la parola, la domanda non la legge il sito, fuori dal riquadro la pagina risponde ed Esc la chiude', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<button id="bottone" style="margin-top:420px" onclick="window.__clic++">Premi</button>'));
  await p.locator('#parola').dblclick();
  const parola = await p.locator('#parola').boundingBox();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  const riquadro = await statoDi(app, p, '.sn-popup');
  expect(riquadro.nelloStrato).toBe(true);
  expect(riquadro.top >= parola.y + parola.height || riquadro.bottom <= parola.y, 'il riquadro non copre la parola').toBe(true);
  await nienteAlSito(app, p, '.sn-popup-input', 'domanda-segreta-1509 sul gatto');

  // Fuori dal riquadro il clic è della pagina, e la tastiera torna a lei.
  const strato = await paginaDelloStrato(app, p);
  const b = await p.locator('#bottone').boundingBox();
  await strato.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect.poll(() => p.evaluate(() => window.__clic)).toBe(1);
  await expect.poll(() => conta(app, p, '.sn-popup')).toBe(1);
  await tastoSullaScheda(app, p, 'Escape');
  await expect.poll(() => conta(app, p, '.sn-popup')).toBe(0);
});

test('la finestrella di accesso aperta da un sito ha i suoi riquadri sopra la pagina, come una scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  const login = `${testServer.html(`<h1>accedi</h1>${SPIA}`)}?client_id=filo1509&redirect_uri=http%3A%2F%2Fsito.example%2Fcb`;
  const sito = await testServer.openReady(openTab, `<h1>sito</h1>
    <button id="accedi" onclick='window.open(${JSON.stringify(login)}, "_blank", "width=520,height=640")'>Accedi con…</button>`);
  await sito.click('#accedi');
  const nelPopup = (code) => app.evaluate(async ({ BrowserWindow }, c) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes('client_id=filo1509'));
    if (!w) return null;
    try { return await w.webContents.executeJavaScriptInIsolatedWorld(999, [{ code: c }]); } catch (_) { return null; }
  }, code);
  await expect.poll(() => nelPopup('document.documentElement.dataset.filoContentReady || ""'), { timeout: 10_000 }).toBe('1');
  await nelPopup('globalThis.SN_FEEDBACK_UI.open()');
  // Il riquadro sta nella vista dello strato della finestrella, non nel documento del sito.
  let strato = null;
  await expect.poll(async () => {
    const id = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => !x._filoTabs && String(x.webContents.getURL()).includes('client_id=filo1509'));
      return w ? w.webContents.id : null;
    });
    strato = app.windows().find((p) => p.url() === `filo://riquadri/riquadri.html#${id}`) || null;
    return strato ? strato.locator('.sn-fb-text').count() : 0;
  }, { timeout: 10_000 }).toBe(1);
  await strato.locator('.sn-fb-text').click();
  await strato.keyboard.insertText(SEGRETO);
  await strato.keyboard.press('ControlOrMeta+A');
  await strato.keyboard.press('ControlOrMeta+C');
  const popup = app.windows().find((p) => p.url().includes('client_id=filo1509'));
  await popup.waitForTimeout(400);
  expect(await popup.evaluate(() => window.cosaHaVisto())).not.toContain('zibaldone');
  expect(await popup.evaluate(() => document.querySelector('[data-sn-riquadro], .sn-fb-text'))).toBeNull();
});

// Scrivendo in un riquadro sopra un sito i tasti del browser valgono come nella pagina: il tasto arriva dove sta la
// tastiera, cioè allo strato.
async function premiDoveScrive(app, keyCode, modifiers) {
  await app.evaluate(({ webContents }, { k, m }) => {
    const f = webContents.getFocusedWebContents();
    if (!f || !String(f.getURL()).startsWith('filo://riquadri/')) throw new Error(`la tastiera non è nello strato: ${f && f.getURL()}`);
    f.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: m });
    f.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: m });
  }, { k: keyCode, m: modifiers });
}

async function traduzioneConLaTastiera(app, p) {
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await p.locator('#parola').dblclick();
  await comando(app, 'translate-selection');
  await expect.poll(async () => (await statoDi(app, p, '.sn-popup-body'))?.testo || '', { timeout: 15_000 }).toContain('The cat');
  await expect.poll(() => app.evaluate(({ webContents }) => String(webContents.getFocusedWebContents()?.getURL() || '')))
    .toMatch(/^filo:\/\/riquadri\//);
}

const urlDelleSchede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .find((w) => w._filoTabs)._filoTabs.tabs.map((t) => t.view.webContents.getURL()));

test('con la risposta aperta su un sito Ctrl+W chiude la scheda e Alt+Sinistra torna indietro', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const prima = await testServer.openReady(openTab, '<h1>prima</h1>');
  const indietro = prima.url();
  await prima.goto(testServer.html(pagina()));
  await prima.waitForFunction(() => document.documentElement.dataset.filoReady === '1');
  await traduzioneConLaTastiera(app, prima);
  await premiDoveScrive(app, 'Left', ['alt']);
  await expect.poll(() => prima.url()).toBe(indietro);

  const p = await testServer.openReady(openTab, pagina());
  const url = p.url();
  await traduzioneConLaTastiera(app, p);
  await premiDoveScrive(app, 'W', ['control']);
  await expect.poll(() => urlDelleSchede(app)).not.toContain(url);
});

const zoomDi = (app, u) => app.evaluate(({ BrowserWindow }, url) => BrowserWindow.getAllWindows().find((w) => w._filoTabs)
  ._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === url).view.webContents.getZoomFactor(), u);

test('con la risposta aperta su un sito Ctrl+più, Ctrl+meno, Ctrl+0 e Ctrl+rotella sul riquadro zoomano la pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina());
  const url = p.url();
  await traduzioneConLaTastiera(app, p);
  const prima = await zoomDi(app, url);
  await premiDoveScrive(app, '=', ['control']);
  await expect.poll(() => zoomDi(app, url)).toBeGreaterThan(prima);
  const grande = await zoomDi(app, url);
  await premiDoveScrive(app, '-', ['control']);
  await expect.poll(() => zoomDi(app, url)).toBeLessThan(grande);
  await premiDoveScrive(app, '=', ['control']);
  await expect.poll(() => zoomDi(app, url)).toBeGreaterThan(prima);
  await premiDoveScrive(app, '0', ['control']);
  await expect.poll(() => zoomDi(app, url)).toBe(prima);

  // La rotella con Ctrl sopra il riquadro stesso, non sul vuoto della pagina.
  const r = await statoDi(app, p, '.sn-popup-body');
  await app.evaluate(({ webContents }, { x, y }) => {
    const f = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith('filo://riquadri/'));
    f.sendInputEvent({ type: 'mouseMove', x, y });
    f.sendInputEvent({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: 120, wheelTicksY: 1, canScroll: true, modifiers: ['control'] });
  }, { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  await expect.poll(() => zoomDi(app, url)).not.toBe(prima);
  expect(await conta(app, p, '.sn-popup')).toBe(1);
});

test('la prima risposta su una parola in un riquadro incorporato si apre accanto alla parola', async ({ app, openTab, testServer }) => {
  test.setTimeout(90_000);
  await modelloFinto(app);
  const dentro = testServer.html('<!doctype html><body style="margin:10px;font:18px sans-serif">Il <span id="w">topo</span> corre.</body>');
  const p = await testServer.openReady(openTab, pagina(`<iframe id="embed" src="${dentro}" width="420" height="100" style="margin-left:500px;margin-top:300px;border:1px solid #333"></iframe>`));
  await expect.poll(() => p.frames().length).toBeGreaterThan(1);
  await p.waitForTimeout(500);
  const box = await p.frameLocator('#embed').locator('#w').boundingBox();
  // Doppio clic vero sulla scheda: l'ancora di un riquadro incorporato è il punto dove l'utente ha cliccato.
  await app.evaluate(({ BrowserWindow }, { u, x, y }) => {
    const w = BrowserWindow.getAllWindows().find((q) => q._filoTabs);
    const wc = w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents;
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    for (const c of [1, 2]) {
      wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: c });
      wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: c });
    }
  }, { u: p.url(), x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) });
  await expect.poll(() => p.frames().find((f) => f !== p.mainFrame()).evaluate(() => String(getSelection()).trim())).toBe('topo');
  await comando(app, 'translate-selection');
  await expect.poll(() => conta(app, p, '.sn-popup'), { timeout: 15_000 }).toBe(1);
  const pop = await statoDi(app, p, '.sn-popup');
  expect(pop.left <= box.x + box.width && pop.right >= box.x, `risposta a x=${Math.round(pop.left)}…${Math.round(pop.right)}, parola a x=${Math.round(box.x)}`).toBe(true);
  expect(Math.min(Math.abs(pop.top - (box.y + box.height)), Math.abs(pop.bottom - box.y))).toBeLessThan(250);
});

// Il mouse vero arriva allo strato, che sta sopra la pagina: come lo manda il sistema.
const sulloStrato = (app, eventi) => app.evaluate(({ webContents }, ev) => {
  const f = webContents.getAllWebContents().find((w) => String(w.getURL()).startsWith('filo://riquadri/'));
  for (const e of ev) f.sendInputEvent(e);
}, eventi);

test('con la risposta aperta un clic su un collegamento della pagina la apre, e Filo resta vivo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const dest = testServer.html('<h1>altrove</h1>');
  const p = await testServer.openReady(openTab, pagina(`<p><a id="vai" href="${dest}" style="font-size:30px">vai</a></p>`));
  await traduzioneConLaTastiera(app, p);
  // Un errore non preso nel processo principale aprirebbe la sua finestra e bloccherebbe Filo: qui si annota.
  await app.evaluate(() => {
    globalThis.__errori1509 = [];
    process.prependListener('uncaughtException', (e) => { globalThis.__errori1509.push(String((e && e.stack) || e).slice(0, 400)); });
  });
  const b = await p.locator('#vai').boundingBox();
  const x = Math.round(b.x + 10);
  const y = Math.round(b.y + 10);
  await sulloStrato(app, [
    { type: 'mouseMove', x, y },
    { type: 'mouseDown', x, y, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x, y, button: 'left', clickCount: 1 },
  ]);
  await expect.poll(() => p.url(), { timeout: 10_000 }).toBe(dest);
  await p.mouse.move(20, 20);
  await p.mouse.move(60, 80);
  await p.waitForTimeout(800);
  expect(await app.evaluate(() => globalThis.__errori1509)).toEqual([]);
});

test('con la risposta aperta il dito scorre la pagina, e un trascinamento sul vuoto cade sulla pagina', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  await modelloFinto(app);
  const p = await testServer.openReady(openTab, pagina('<div style="height:4000px"></div>'));
  await traduzioneConLaTastiera(app, p);
  const strato = await paginaDelloStrato(app, p);
  const cdp = await strato.context().newCDPSession(strato);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 700, y: 600 }] });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 700, y: 600 - i * 30 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => p.evaluate(() => scrollY)).toBeGreaterThan(100);
  expect(await conta(app, p, '.sn-popup')).toBe(1);

  // Un file trascinato sul vuoto: lo strato si toglie e il rilascio va alla pagina; il mouse sulla pagina lo rimette.
  const visibile = () => app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    const t = w._filoTabs.tabs.find((x) => x.view?.webContents?.getURL() === u);
    return w._filoTabs.riquadri.stato(t.view.webContents).visibile;
  }, p.url());
  expect(await visibile()).toBe(true);
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x: 700, y: 500, data: { items: [{ mimeType: 'text/plain', data: 'un file' }], dragOperationsMask: 1 } });
  await expect.poll(visibile).toBe(false);
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w._filoTabs.tabs.find((x) => x.view?.webContents?.getURL() === u).view.webContents.sendInputEvent({ type: 'mouseMove', x: 650, y: 450 });
  }, p.url());
  await expect.poll(visibile).toBe(true);
  expect(await conta(app, p, '.sn-popup')).toBe(1);
});

test('feedback su un sito: se l\'invio con lo screenshot non riesce, la tastiera resta al feedback', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const p = await testServer.openReady(openTab, pagina('<input id="campo">'));
  await app.evaluate(({ BrowserWindow }, u) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs);
    w.show(); w.focus();
    w._filoTabs.tabs.find((t) => t.view?.webContents?.getURL() === u).view.webContents.focus();
  }, p.url());
  await nelMondoDiFilo(app, p, () => globalThis.SN_FEEDBACK_UI.open());
  await expect.poll(() => conta(app, p, '.sn-fb-overlay')).toBe(1);
  await nelloStrato(app, p, () => {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (m, ...r) => (m && m.type === 'submit_feedback' ? Promise.resolve({ ok: false, error: 'rete giù' }) : orig(m, ...r));
  });
  await clicca(app, p, '.sn-fb-text');
  await clicca(app, p, '.sn-fb-clear');
  await clicca(app, p, '.sn-fb-send');
  await expect.poll(async () => (await statoDi(app, p, '.sn-fb-status'))?.testo || '').toContain('rete giù');
  await expect.poll(() => app.evaluate(({ webContents }) => String(webContents.getFocusedWebContents()?.getURL() || '')))
    .toMatch(/^filo:\/\/riquadri\//);
});
