// #948 — Il tasto microfono delle chat: si preme, si parla, il testo compare nella casella e la richiesta parte
// da sola dopo un attimo per annullare; con «Lascia il testo da correggere» resta nella casella. Home, Aiuto, Editor.
// Nella home, mentre Filo lavora, il dettato parte come seguito (#1296).
// Microfono finto (un tono: per il segmentatore è voce, spento è silenzio), trascrizione e chat finte nel main:
// tutto il resto (ascolto, fine del parlato, WAV, inserimento, invio) è il codice di produzione.

import { test, expect } from './fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { menuDi } from './helpers/menuContestuale.mjs';

const SHOTS = 'tests/.shots';
const DETTO = 'che tempo fa domani a Lisbona';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}

async function prepara(app, { tema = 'light' } = {}) {
  await app.evaluate(async (_e, { detto, tema: t }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: t,
      dictation: { autoSend: true },
    });
    globalThis.__trascrizioni = 0;
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async ({ audioBase64 }) => {
      globalThis.__trascrizioni += 1;
      const bytes = Buffer.from(String(audioBase64 || ''), 'base64').length;
      return { text: ` ${detto} `, usage: { seconds: bytes / 32000, costUsd: 0.00001 }, generationId: null };
    };
    globalThis.__richieste = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const ultimo = [...messages].reverse().find((m) => m.role === 'user');
      globalThis.__richieste.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content));
      try { onDelta && onDelta('Domani c\'è il sole.'); } catch (_) {}
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: 'Domani c\'è il sole.', toolCalls: [], reasoningDetails: [], finishReason: 'stop',
      };
    };
  }, { detto: DETTO, tema });
}

// Un tono acceso/spento a comando al posto del microfono.
async function microfonoFinto(page) {
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      osc.frequency.value = 220;
      const gain = ac.createGain();
      gain.gain.value = 0.4;
      const dest = ac.createMediaStreamDestination();
      osc.connect(gain); gain.connect(dest); osc.start();
      try { await ac.resume(); } catch (_) {}
      window.__mic = { gain };
      return dest.stream;
    };
  });
}
const voce = (page, on) => page.evaluate((v) => { window.__mic.gain.gain.value = v ? 0.4 : 0; }, on);

async function home(app) {
  const page = await trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  return page;
}

// Parla per un secondo e mezzo e poi tace: il tasto deve smettere di ascoltare da solo.
async function parla(page, mic = page.locator('.dash-input-wrap .sn-voce-btn')) {
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await voce(page, false);
}

test('home: il microfono si vede accanto all\'invio, si parla e la richiesta parte senza altri clic', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  mkdirSync(SHOTS, { recursive: true });

  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await expect(mic).toBeVisible();
  // Accanto all'invio, prima di lui.
  const vicini = await page.evaluate(() => {
    const m = document.querySelector('.dash-input-wrap .sn-voce-btn');
    return m.nextElementSibling && m.nextElementSibling.id;
  });
  expect(vicini).toBe('sendBtn');
  // Hover di una parola e la scorciatoia, col nome che le dà questo sistema.
  const tasto = await page.evaluate(() => window.SN_TASTI.etichetta(window.SN_VOCE_CHAT.TASTO));
  await expect(mic).toHaveAttribute('title', `Parla (${tasto})`);
  // A riposo è solo un microfono: niente anello, niente croce.
  await expect(mic.locator('.sn-voce-anello')).toBeHidden();
  await expect(mic.locator('.sn-voce-x')).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/voce-chat-home-pronto.png` });

  await mic.click();
  await parla(page);
  // Il testo detto compare nella casella e c'è l'attimo per annullare…
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 10_000 });
  await expect(mic).toHaveAttribute('data-stato', 'attesa');
  await expect(mic.locator('.sn-voce-x')).toBeVisible();
  await expect(mic.locator('.sn-voce-mic')).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/voce-chat-home-attesa.png` });
  // …poi la richiesta parte da sola: la bolla dell'utente, la risposta, la casella vuota.
  await expect(page.locator('.dash-bubble-user', { hasText: DETTO })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Domani c\'è il sole.' })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#input')).toHaveValue('');
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  const richieste = await app.evaluate(() => globalThis.__richieste);
  expect(richieste.some((r) => r.includes(DETTO))).toBe(true);
});

// #1296 — dettato mentre Filo lavora è un seguito, come Invio con del testo: non ferma e non aspetta la fine per partire.
test('home: dettato mentre Filo lavora, parte come seguito senza fermarlo', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await app.evaluate(() => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const ultimo = [...messages].reverse().find((m) => m.role === 'user');
      globalThis.__richieste.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content));
      const primo = n++ === 0;
      if (primo) await new Promise((r) => setTimeout(r, 12_000));
      const testo = primo ? 'Prima risposta.' : 'Domani c\'è il sole.';
      try { onDelta && onDelta(testo); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text: testo, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  const page = await home(app);
  await page.locator('#input').fill('prima domanda');
  await page.locator('#input').press('Enter');
  await expect(page.locator('#stopBtn')).toBeVisible();
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await parla(page);
  await expect(page.locator('.dash-bubble-attesa', { hasText: DETTO })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('#input')).toHaveValue('');
  await expect(page.locator('.dash-bubble-fermato')).toHaveCount(0);
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Prima risposta.' })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Domani c\'è il sole.' })).toBeVisible({ timeout: 10_000 });
  const richieste = await app.evaluate(() => globalThis.__richieste);
  expect(richieste.length).toBe(2);
  expect(richieste[1]).toContain(DETTO);
});

test('home: nell\'attimo per annullare, la croce ferma l\'invio e il testo resta da correggere', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');

  // Anche la scorciatoia accende il microfono.
  await page.locator('#input').focus();
  await page.keyboard.press('Control+Shift+Space');
  await parla(page);
  await expect(mic).toHaveAttribute('data-stato', 'attesa', { timeout: 10_000 });
  await expect(mic).toHaveAttribute('title', /Annulla l'invio/);
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  await page.waitForTimeout(3500);
  await expect(page.locator('#input')).toHaveValue(DETTO);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__richieste.length)).toBe(0);
});

test('home: con «Lascia il testo da correggere» (scelto dal tasto destro sul microfono) il testo resta nella casella', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app, { tema: 'dark' });
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');

  // Il tasto destro sul microfono offre le due scelte; quella di serie è segnata.
  await mic.click({ button: 'right' });
  const menu = menuDi(page).locator('.sn-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('✓ Invia da solo')).toBeVisible();
  await menu.getByText('Lascia il testo da correggere').click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).dictation.autoSend)).toBe(false);

  await mic.click();
  await parla(page);
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 10_000 });
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  await page.waitForTimeout(3500);
  await expect(page.locator('#input')).toHaveValue(DETTO);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
  expect(await app.evaluate(() => globalThis.__richieste.length)).toBe(0);
  // Il cursore è in fondo al testo, pronto per correggere.
  expect(await page.evaluate(() => {
    const i = document.querySelector('#input');
    return document.activeElement === i && i.selectionStart === i.value.length;
  })).toBe(true);
  // La casella si comporta come se il testo l'avessi scritto tu: stessa altezza.
  const altezza = () => page.evaluate(() => document.querySelector('#input').offsetHeight);
  const dopoVoce = await altezza();
  await page.locator('#input').fill('');
  await page.locator('#input').pressSequentially(DETTO);
  expect(await altezza()).toBe(dopoVoce);

  // Il tema scuro: il tasto acceso si vede.
  await voce(page, true);
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  // L'alone segue la voce: con il tono acceso il livello sale.
  await expect.poll(() => mic.evaluate((b) => Number(b.style.getPropertyValue('--sn-voce-livello') || 0))).toBeGreaterThan(0.5);
  await page.mouse.move(10, 10);
  await page.waitForTimeout(300);
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/voce-chat-home-ascolta-scuro.png` });
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'pronto', { timeout: 10_000 });
});

test('microfono negato: un avviso dice cosa fare e il tasto torna pronto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };
  });
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(page.locator('.sn-toast', { hasText: 'non ha il permesso di usare il microfono' })).toBeVisible({ timeout: 5_000 });
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
});

test('trascrizione fallita: un avviso lo dice e niente parte', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await app.evaluate(() => {
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => { throw new Error('fetch failed'); };
  });
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await parla(page);
  await expect(page.locator('.sn-toast', { hasText: 'Non sono riuscito a trascrivere' })).toBeVisible({ timeout: 10_000 });
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  await expect(page.locator('#input')).toHaveValue('');
  expect(await app.evaluate(() => globalThis.__richieste.length)).toBe(0);
});

// Le altre chat di Filo rispondono col modello senza flusso: qui risponde quello finto.
async function rispostaFinta(app, testo) {
  await app.evaluate((_e, t) => {
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      const ultimo = [...messages].reverse().find((m) => m.role === 'user');
      globalThis.__richieste.push(typeof ultimo?.content === 'string' ? ultimo.content : JSON.stringify(ultimo?.content));
      return { text: t, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  }, testo);
}

test('editor: la chat del documento ha il microfono, e la domanda detta parte da sola', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await rispostaFinta(app, 'Il documento è vuoto.');
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('.ed-module[data-type="switch"]');
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-module[data-type="chat"]');
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await microfonoFinto(page);
  const chat = page.locator('.ed-module[data-type="chat"]');
  const mic = chat.locator('.sn-voce-btn');
  await expect(mic).toBeVisible();
  await expect(mic).toHaveAttribute('title', /^Parla \(/);
  mkdirSync(SHOTS, { recursive: true });
  await chat.screenshot({ path: `${SHOTS}/voce-chat-editor.png` });
  await mic.click();
  await parla(page, mic);
  await expect(chat.locator('.ed-chat-msg.user', { hasText: DETTO })).toBeVisible({ timeout: 10_000 });
  await expect(chat.locator('[data-chat="input"]')).toHaveValue('');
  expect((await app.evaluate(() => globalThis.__richieste)).some((r) => r.includes(DETTO))).toBe(true);
});

test('Aiuto: la chat della scheda ha il microfono, la scorciatoia vale per lei e la domanda detta parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await rispostaFinta(app, JSON.stringify({ text: 'Eccomi.', status: 'done' }));
  const page = await home(app);
  await page.evaluate(() => window.SN_SIDEBAR.open());
  const aiuto = page.locator('.sn-sidebar');
  const mic = aiuto.locator('.sn-voce-btn');
  await expect(mic).toBeVisible();
  // La scorciatoia premuta nella casella dell'Aiuto accende il SUO microfono, non quello della home.
  await aiuto.locator('textarea').focus();
  await page.keyboard.press('Control+Shift+Space');
  await parla(page, mic);
  await expect(page.locator('.dash-input-wrap .sn-voce-btn')).toHaveAttribute('data-stato', 'pronto');
  await expect(aiuto.locator('.sn-sidebar-msg-user', { hasText: DETTO })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
  mkdirSync(SHOTS, { recursive: true });
  await aiuto.screenshot({ path: `${SHOTS}/voce-chat-aiuto.png` });
});

test('Aiuto su un sito: il microfono c\'è, e un clic fabbricato dal sito non lo accende', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await openTab(testServer.html('<!doctype html><title>Sito</title><h1>Un sito</h1>'));
  await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
  // Alt+H come lo preme l'utente: sui siti l'Aiuto vive nel mondo dei content script.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
    const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
    t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
    t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
  });
  const mic = page.locator('.sn-sidebar .sn-voce-btn');
  await expect(mic).toBeVisible({ timeout: 8_000 });
  await expect(mic).toHaveAttribute('title', /^Parla \(/);
  // Lo script del sito prova ad accenderlo: niente.
  await page.evaluate(() => {
    const b = document.querySelector('.sn-sidebar .sn-voce-btn');
    b.click();
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector('.sn-sidebar textarea').dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ', code: 'Space', ctrlKey: true, shiftKey: true, bubbles: true,
    }));
  });
  await page.waitForTimeout(500);
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  await expect(page.locator('.sn-toast', { hasText: 'microfono' })).toHaveCount(0);
});

test('home: «Detta» dal tasto destro nella casella della chat è lo stesso microfono, e la richiesta parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await page.locator('#input').click({ button: 'right' });
  const detta = menuDi(page).locator('.sn-menu .sn-menu-split-main', { hasText: 'Detta' });
  await expect(detta).toBeVisible();
  const tasto = await page.evaluate(() => window.SN_TASTI.etichetta(window.SN_VOCE_CHAT.TASTO));
  await expect(detta.locator('.sn-menu-shortcut')).toHaveText(tasto);
  await detta.click();
  await parla(page, mic);
  await expect(page.locator('.sn-dictate-pill')).toHaveCount(0);
  await expect(page.locator('.dash-bubble-user', { hasText: DETTO })).toBeVisible({ timeout: 10_000 });
});

test('home: Esc mentre ascolta smette, tiene quello che hai detto e non invia', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 10_000 });
  await expect(mic).toHaveAttribute('data-stato', 'pronto');
  await page.waitForTimeout(3500);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
});

test('la scelta si chiede a Filo in chat e si vede in Preferenze, dove si cambia', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  const prefs = await openTab('filo://preferences/preferences.html');
  const scelta = prefs.locator('#dictationAutoSend');
  await expect(scelta).toHaveValue('si');

  await app.evaluate(() => {
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts }) => {
      n += 1;
      const calls = n === 1
        ? [{ id: 'p1', name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'invio_vocale', valore: 'lascia il testo da correggere' }) }]
        : [];
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: calls.length ? '' : 'Fatto.', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  });
  await page.bringToFront();
  await page.locator('#input').fill('quando parlo lascia il testo da correggere');
  await page.locator('#sendBtn').click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).dictation.autoSend), { timeout: 10_000 }).toBe(false);
  // La pagina aperta segue il cambio fatto altrove.
  await expect(scelta).toHaveValue('no', { timeout: 5_000 });

  await scelta.selectOption('si');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).dictation.autoSend)).toBe(true);
  mkdirSync(SHOTS, { recursive: true });
  await prefs.locator('#dictationAutoSend').scrollIntoViewIfNeeded();
  await prefs.screenshot({ path: `${SHOTS}/voce-chat-preferenze.png` });
});

test('Aiuto su un sito che vieta i fogli di stile esterni: il microfono ha il suo aspetto', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  const csp = "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'";
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': csp });
    res.end('<!doctype html><title>Sito CSP</title><h1>Sito con CSP</h1>');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    const page = await openTab(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => document.documentElement.dataset.filoReady === '1', null, { timeout: 8_000 });
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      const t = w._filoTabs.tabs.find((x) => x.id === w._filoTabs.activeId);
      t.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'H', modifiers: ['alt'] });
      t.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'H', modifiers: ['alt'] });
    });
    const mic = page.locator('.sn-sidebar .sn-voce-btn');
    await expect(mic).toBeVisible({ timeout: 8_000 });
    // Tondo grande quanto l'invio, col solo microfono: niente croce, niente anello.
    await expect.poll(async () => { const b = await mic.boundingBox(); return [Math.round(b.width), Math.round(b.height)]; }).toEqual([32, 32]);
    await expect(mic.locator('.sn-voce-x')).toBeHidden();
    await expect(mic.locator('.sn-voce-anello')).toBeHidden();
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('i tempi sono dell\'utente: la pausa più lunga non chiude chi si ferma a pensare, l\'attimo per annullare segue le Preferenze', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  const page = await home(app);
  // Dalle Preferenze: pausa di 4 secondi, mezzo secondo per annullare.
  const prefs = await openTab('filo://preferences/preferences.html');
  await expect(prefs.locator('#dictationSilenceVal')).toHaveText('2 s');
  await expect(prefs.locator('#dictationCancelVal')).toHaveText('2,5 s');
  await prefs.locator('#dictationSilence').fill('4');
  await prefs.locator('#dictationCancel').fill('0.5');
  await expect(prefs.locator('#dictationCancelVal')).toHaveText('0,5 s');
  await expect.poll(() => app.evaluate(async () => {
    const d = (await globalThis.SN_STORAGE.getSettings()).dictation;
    return [d.silenceSec, d.cancelSec, d.autoSend];
  }), { timeout: 8_000 }).toEqual([4, 0.5, true]);

  await page.bringToFront();
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await parla(page);
  // Tre secondi di silenzio: con la pausa a quattro sta ancora ascoltando.
  await page.waitForTimeout(3000);
  await expect(mic).toHaveAttribute('data-stato', 'ascolta');
  await expect(page.locator('#input')).toHaveValue(DETTO, { timeout: 5_000 });
  await expect(mic).toHaveAttribute('data-stato', 'attesa', { timeout: 5_000 });
  expect(await mic.evaluate((b) => b.style.getPropertyValue('--sn-voce-attesa'))).toBe('500ms');
  await expect(page.locator('.dash-bubble-user', { hasText: DETTO })).toBeVisible({ timeout: 3_000 });
});

// I caratteri di sistema più larghi (Linux, Mac) mandano a capo prima: la prova li mette lei, così l'esito non dipende
// da quelli della macchina che la corre (#256.4).
const CARATTERE_LARGO = `.ed-chat-input textarea { font-family: 'DejaVu Sans', Verdana, sans-serif !important; }`;

test('editor: col microfono accanto, la casella della chat mostra tutto il suggerimento e cresce col testo invece di scorrere', async ({ shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  const chat = ed.locator('.ed-module[data-type="chat"]');
  await expect(chat.locator('.sn-voce-btn')).toBeVisible();
  const casella = chat.locator('[data-chat="input"]');
  const misura = () => casella.evaluate((i) => ({ sh: i.scrollHeight, ch: i.clientHeight, h: i.offsetHeight, barra: i.offsetWidth - i.clientWidth }));
  const vuota = await misura();
  expect(vuota.sh).toBeLessThanOrEqual(vuota.ch);
  expect(vuota.barra).toBeLessThan(6);
  await casella.fill('riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera');
  const piena = await misura();
  expect(piena.sh).toBeLessThanOrEqual(piena.ch);
  expect(piena.h).toBeGreaterThan(vuota.h);
  mkdirSync(SHOTS, { recursive: true });
  await chat.screenshot({ path: `${SHOTS}/voce-chat-editor-casella.png` });
  await ed.addStyleTag({ content: CARATTERE_LARGO });
  const larga = await misura();
  expect(larga.sh).toBeLessThanOrEqual(larga.ch);
  // Cinque righe a capo vero, non del font: un tetto fisso (ne teneva quattro) torna rosso su qualunque macchina (#667.6).
  await casella.fill(Array.from({ length: 5 }, (_, i) => `riga ${i + 1}`).join('\n'));
  const cinque = await misura();
  expect(cinque.sh).toBeLessThanOrEqual(cinque.ch);
  // Un testo che non ci sta scorre dentro la casella: il modulo non trabocca e la conversazione resta in vista.
  await casella.fill('una domanda lunghissima sul documento '.repeat(30));
  const lunga = await misura();
  expect(lunga.sh).toBeGreaterThan(lunga.ch);
  const [c, mod, reg] = await Promise.all([casella.boundingBox(), chat.boundingBox(), chat.locator('[data-chat="log"]').boundingBox()]);
  expect(c.y + c.height).toBeLessThanOrEqual(mod.y + mod.height);
  expect(reg.height).toBeGreaterThan(50);
});

// Con la finestra piccola la chat è stretta: la casella non resta larga due parole accanto ai tasti (#256.4).
test('editor: con la finestra piccola la casella della chat prende tutta la riga e mostra la richiesta intera', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1024, 640); });
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  const chat = ed.locator('.ed-module[data-type="chat"]');
  const mic = chat.locator('.sn-voce-btn');
  await expect(mic).toBeVisible();
  const casella = chat.locator('[data-chat="input"]');
  const misura = () => casella.evaluate((i) => ({ sh: i.scrollHeight, ch: i.clientHeight }));
  const vuota = await misura();
  expect(vuota.sh).toBeLessThanOrEqual(vuota.ch);
  await casella.fill('riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera');
  const piena = await misura();
  expect(piena.sh).toBeLessThanOrEqual(piena.ch);
  const pos = await ed.evaluate(() => {
    const mod = document.querySelector('.ed-module[data-type="chat"]');
    const r = (s) => mod.querySelector(s).getBoundingClientRect();
    const t = r('[data-chat="input"]'), m = r('.sn-voce-btn'), s = r('[data-chat="send"]');
    return { micSotto: m.top >= t.bottom, invioSotto: s.top >= t.bottom, invioDentro: s.right <= mod.getBoundingClientRect().right && s.bottom <= mod.getBoundingClientRect().bottom };
  });
  expect(pos).toEqual({ micSotto: true, invioSotto: true, invioDentro: true });
  mkdirSync(SHOTS, { recursive: true });
  await chat.screenshot({ path: `${SHOTS}/voce-chat-editor-casella-stretta.png` });
  await ed.addStyleTag({ content: CARATTERE_LARGO });
  const larga = await misura();
  expect(larga.sh).toBeLessThanOrEqual(larga.ch);
});

// In una chat bassa la casella scorre (decisione dell'owner, #256.4) ma non spinge fuori i tasti messi sotto, e
// sopra resta in vista la fine dell'ultima risposta di Filo; a 1024x640 la richiesta di una frase e mezza ci sta intera,
// e a 1280x720 (chat larga quanto basta per i tasti accanto, ma bassa) ci sta perché i tasti scendono sotto.
for (const [w, h, intera] of [[1280, 720, true], [1280, 690, true], [1024, 640, true], [960, 600, false], [900, 520, false], [800, 500, false]]) {
  test(`editor: a ${w}x${h} microfono e invio restano dentro la chat anche con una richiesta lunga`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await prepara(app);
    await rispostaFinta(app, 'Ultima risposta del documento, abbastanza lunga da andare a capo.');
    const ed = await openTab('filo://editor/editor.html');
    await ed.waitForSelector('.ed-module[data-type="switch"]');
    await ed.locator('.ed-switch-icon').nth(1).click();
    const chat = ed.locator('.ed-module[data-type="chat"]');
    await expect(chat.locator('.sn-voce-btn')).toBeVisible();
    const casella = chat.locator('[data-chat="input"]');
    await casella.fill('domanda');
    await casella.press('Enter');
    await expect(chat.locator('.ed-chat-msg.assistant')).toHaveCount(1, { timeout: 8_000 });
    const dentro = () => ed.evaluate(() => {
      const mod = document.querySelector('.ed-module[data-type="chat"]');
      const fondo = mod.getBoundingClientRect().bottom + 0.5;
      const sta = (s) => mod.querySelector(s).getBoundingClientRect().bottom <= fondo;
      const l = mod.querySelector('[data-chat="log"]').getBoundingClientRect();
      const r = mod.querySelector('.ed-chat-msg.assistant').getBoundingClientRect();
      return {
        casella: sta('[data-chat="input"]'), invio: sta('[data-chat="send"]'), microfono: sta('.sn-voce-btn'),
        rispostaInVista: l.height >= 18 && r.bottom <= l.bottom + 1 && r.bottom - 14 >= l.top,
      };
    });
    const tutti = { casella: true, invio: true, microfono: true, rispostaInVista: true };
    // Il registro torna in fondo al frame dopo che la casella è cresciuta: si legge quello che vede l'utente.
    await casella.fill('riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera');
    await expect.poll(dentro, { timeout: 3_000 }).toEqual(tutti);
    if (intera) expect(await casella.evaluate((t) => t.scrollHeight <= t.clientHeight)).toBe(true);
    await casella.fill('una richiesta lunga '.repeat(30));
    await expect.poll(dentro, { timeout: 3_000 }).toEqual(tutti);
    await chat.locator('[data-chat="send"]').click({ trial: true });
    mkdirSync(SHOTS, { recursive: true });
    await chat.screenshot({ path: `${SHOTS}/voce-chat-editor-casella-bassa-${w}.png` });
  });
}

// Il tetto della casella segue il modulo, non i caratteri del sistema (#256.4): oltre scorre, ma resta dentro la chat,
// il registro non sparisce e l'ultima risposta non scivola fuori vista mentre si scrive.
test('editor: una richiesta lunghissima ferma la casella entro la chat, e l\'ultima risposta resta in vista', async ({ app, shell, openTab }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await rispostaFinta(app, 'Ultima risposta del documento.');
  const ed = await openTab('filo://editor/editor.html');
  await ed.waitForSelector('.ed-module[data-type="switch"]');
  await ed.locator('.ed-switch-icon').nth(1).click();
  const chat = ed.locator('.ed-module[data-type="chat"]');
  const casella = chat.locator('[data-chat="input"]');
  const log = chat.locator('[data-chat="log"]');
  for (let i = 1; i <= 3; i++) {
    await casella.fill(`domanda ${i}`);
    await casella.press('Enter');
    await expect(chat.locator('.ed-chat-msg.assistant')).toHaveCount(i, { timeout: 8_000 });
  }
  await expect(chat.locator('.ed-chat-msg.assistant').last()).toHaveText('Ultima risposta del documento.');
  const vuota = await casella.evaluate((i) => i.offsetHeight);
  await casella.fill(Array.from({ length: 40 }, (_, i) => `frase numero ${i + 1} della richiesta lunga`).join(', '));
  const misure = () => ed.evaluate(() => {
    const mod = document.querySelector('.ed-module[data-type="chat"]');
    const t = mod.querySelector('[data-chat="input"]');
    const l = mod.querySelector('[data-chat="log"]');
    const r = (el) => el.getBoundingClientRect();
    const ultima = [...l.querySelectorAll('.ed-chat-msg.assistant')].pop();
    return {
      sh: t.scrollHeight, ch: t.clientHeight, h: t.offsetHeight,
      fondoCasella: r(t).bottom, fondoModulo: r(mod).bottom, log: l.clientHeight,
      ultimaInVista: r(ultima).bottom <= r(l).bottom + 1 && r(ultima).top >= r(l).top - 1,
    };
  });
  // Il registro torna in fondo al frame dopo che la casella è cresciuta: si legge quello che vede l'utente.
  await expect.poll(async () => (await misure()).ultimaInVista, { timeout: 3_000 }).toBe(true);
  const m = await misure();
  expect(m.sh).toBeGreaterThan(m.ch);
  expect(m.h).toBeGreaterThan(vuota);
  expect(m.fondoCasella).toBeLessThanOrEqual(m.fondoModulo);
  // Al registro restano poche righe, il resto del modulo va alla casella, con i tasti accanto o sotto.
  expect(m.log).toBeGreaterThan(20);
  expect(m.log).toBeLessThan(90);
  mkdirSync(SHOTS, { recursive: true });
  await chat.screenshot({ path: `${SHOTS}/voce-chat-editor-casella-tetto.png` });
  await casella.fill('');
  await expect.poll(() => casella.evaluate((i) => i.offsetHeight)).toBe(vuota);
});

// Un Esc o un Invio mentre l'ultima frase è ancora in trascrizione: quello che arriva resta nella casella.
async function trascrizioneLenta(app, dallaPrima = false) {
  await app.evaluate((_e, primaLenta) => {
    let n = 0;
    globalThis.SN_PROVIDER_OPENROUTER.transcribe = async () => {
      n += 1;
      const mio = n;
      if (mio >= 2 || primaLenta) await new Promise((r) => setTimeout(r, 3000));
      return { text: mio === 1 ? 'prima frase' : 'seconda frase', usage: { seconds: 1, costUsd: 0 }, generationId: null };
    };
  }, dallaPrima);
}

test('Esc mentre trascrive: quello che hai detto resta nella casella e non parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await trascrizioneLenta(app, true);
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1500);
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'trascrive', { timeout: 2_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('#input')).toHaveValue('prima frase', { timeout: 8_000 });
  await page.waitForTimeout(4000);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(0);
  await expect(page.locator('#input')).toHaveValue('prima frase');
});

test('Invio a mano mentre trascrive: l\'ultima frase resta nella casella invece di partire come secondo messaggio', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await prepara(app);
  await trascrizioneLenta(app);
  const page = await home(app);
  const mic = page.locator('.dash-input-wrap .sn-voce-btn');
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
  await page.waitForTimeout(1200);
  await voce(page, false);
  await expect(page.locator('#input')).toHaveValue('prima frase', { timeout: 5_000 });
  await voce(page, true);
  await page.waitForTimeout(1200);
  await mic.click();
  await expect(mic).toHaveAttribute('data-stato', 'trascrive', { timeout: 2_000 });
  await page.locator('#input').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.dash-bubble-user', { hasText: 'prima frase' })).toBeVisible({ timeout: 8_000 });
  await expect(page.locator('#input')).toHaveValue('seconda frase', { timeout: 8_000 });
  await page.waitForTimeout(4000);
  await expect(page.locator('.dash-bubble-user')).toHaveCount(1);
});

// Un invio a mano con qualunque gesto (qui il clic sul tasto d'invio) vale quanto Invio: il microfono smette
// e quello che arriva ancora resta nella casella invece di partire come secondo messaggio.
for (const quando of ['ascolta', 'trascrive']) {
  test(`clic sul tasto d'invio mentre ${quando}: l'ultima frase resta nella casella e non parte`, async ({ app, shell }) => {
    test.setTimeout(90_000);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await prepara(app);
    await trascrizioneLenta(app);
    const page = await home(app);
    const mic = page.locator('.dash-input-wrap .sn-voce-btn');
    await mic.click();
    await expect(mic).toHaveAttribute('data-stato', 'ascolta', { timeout: 5_000 });
    await page.waitForTimeout(1200);
    await voce(page, false);
    await expect(page.locator('#input')).toHaveValue('prima frase', { timeout: 5_000 });
    await voce(page, true);
    await page.waitForTimeout(1200);
    if (quando === 'trascrive') {
      await mic.click();
      await expect(mic).toHaveAttribute('data-stato', 'trascrive', { timeout: 2_000 });
    }
    await page.locator('#sendBtn').click();
    await expect(page.locator('.dash-bubble-user', { hasText: 'prima frase' })).toBeVisible({ timeout: 8_000 });
    await expect(mic).not.toHaveAttribute('data-stato', 'ascolta', { timeout: 2_000 });
    await voce(page, false);
    await expect(page.locator('#input')).toHaveValue('seconda frase', { timeout: 10_000 });
    await page.waitForTimeout(4000);
    await expect(page.locator('.dash-bubble-user')).toHaveCount(1);
    await expect(page.locator('#input')).toHaveValue('seconda frase');
  });
}
