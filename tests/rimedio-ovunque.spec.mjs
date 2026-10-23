// #663, #828.1: quando Filo non può rispondere (senza invito, crediti finiti, modello che nessun fornitore ammesso
// serve) la frase dice dove si rimedia, e su ogni superficie c'è il tasto che ci porta: la spiegazione del tasto
// destro (parola, immagine, link), il riquadro «Modifica», gli avvisi di traduzione, trascrizione e dettatura, l'Aiuto
// (che nell'Editor è la chat del documento, #1433). Nella home quel tasto è il principale. Regola e sentinella: tests/unit/rimedioOvunque.test.mjs.
// La dettatura usa un microfono finto (un oscillatore): il resto, dalla trascrizione all'avviso, è quello vero.

import { test, expect } from './fixtures/electron.mjs';
import { statoDi, clicca, scrivi, nelMondoDiFilo } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { apriAiuto, chiediAllAiuto } from './helpers/strumentiEditor.mjs';

const SHOTS = 'tests/.shots';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// Nessuna chiave e nessun invito: la richiesta non parte, e la frase manda alla pagina Crediti.
async function senzaChiave(app) {
  await app.evaluate(async () => {
    const D = globalThis.__filoDefaults;
    const orig = globalThis.__filoDefaultsOrigGet || D.get;
    globalThis.__filoDefaultsOrigGet = orig;
    D.get = () => ({ ...orig(), apiKeys: {} });
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: '' } });
  });
}

// Una chiave c'è, ma il servizio risponde 402: i crediti sono finiti.
async function creditiFiniti(app) {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ apiKeys: { openrouter: 'k-test' } });
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const boom = () => {
      const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}');
      e.status = 402; e.provider = 'openrouter';
      throw e;
    };
    globalThis.SN_PROVIDER_OPENROUTER = { ...P, streamComplete: boom, complete: boom };
  });
}

const schede = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
  .flatMap((w) => (w._filoTabs ? w._filoTabs.tabs : []))
  .map((t) => t.view.webContents.getURL()));
const aperta = async (app, inizio) => (await schede(app)).some((u) => u.startsWith(inizio));
async function siApre(app, inizio) {
  await expect.poll(() => aperta(app, inizio), { timeout: 15_000, message: `nessuna scheda ${inizio}` }).toBe(true);
}

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Un tasto appena comparso nel menu di un sito accetta il clic dopo mezzo secondo a schermo (vistoDavvero.js).
const ASPETTA_VISTO_MS = 700;

test('tasto destro su una parola, senza invito: sotto la spiegazione c’è «Apri Crediti», e porta lì', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Parola</title>'
    + '<p id="t" style="font:18px sans-serif;margin:120px 40px">La fotosintesi trasforma la luce.</p>');
  await page.evaluate(() => { document.documentElement.dataset.snTheme = 'dark'; });
  await page.evaluate(() => {
    const n = document.querySelector('#t').firstChild;
    const r = document.createRange();
    r.setStart(n, 3); r.setEnd(n, 14);
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#t').click({ button: 'right', position: { x: 60, y: 8 } });
  const menu = menuDi(page);
  const sezione = menu.locator('.sn-menu-inline-explain');
  await expect(sezione).toHaveClass(/sn-menu-inline-error/, { timeout: 30_000 });
  await expect(sezione).toContainText(/invito|Crediti/);
  const tasto = sezione.locator('.sn-msg-rimedio');
  await expect(tasto).toHaveText('Apri Crediti');
  await page.waitForTimeout(ASPETTA_VISTO_MS);
  await page.screenshot({ path: `${SHOTS}/663-menu-parola.png` }).catch(() => {});
  expect(await aperta(app, 'filo://credits')).toBe(false);
  await tasto.click();
  await siApre(app, 'filo://credits');
  await expect(menu.pannelli).toHaveCount(0);
});

test('tasto destro su un’immagine e su un link, senza invito: la spiegazione porta ai Crediti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const img = testServer.asset(Buffer.from(PNG_B64, 'base64'), 'image/png');
  const destinazione = testServer.html('<!doctype html><meta charset="utf-8"><title>Altrove</title><p>altrove</p>');
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Media</title>'
    + `<img id="img" src="${img}" width="220" height="140" style="display:block;margin:60px 40px">`
    + `<a id="link" href="${destinazione}" style="display:block;margin:20px 40px;font:18px sans-serif">Un collegamento</a>`);
  const menu = menuDi(page);

  await page.locator('#img').click({ button: 'right' });
  const immagine = menu.locator('.sn-menu-inline-error');
  await expect(immagine).toBeVisible({ timeout: 30_000 });
  await expect(immagine.locator('.sn-msg-rimedio')).toHaveText('Apri Crediti');
  await page.waitForTimeout(ASPETTA_VISTO_MS);
  await immagine.locator('.sn-msg-rimedio').click();
  await siApre(app, 'filo://credits');
  await expect(menu.pannelli).toHaveCount(0);

  // Chiusa la pagina Crediti, la stessa strada dal link.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const t = (w._filoTabs?.tabs || []).find((x) => x.view.webContents.getURL().startsWith('filo://credits'));
      if (t) w._filoTabs.closeTab(t.id);
    }
  });
  await expect.poll(() => aperta(app, 'filo://credits')).toBe(false);
  await page.bringToFront();
  await page.locator('#link').click({ button: 'right' });
  const link = menu.locator('.sn-menu-inline-error');
  await expect(link).toBeVisible({ timeout: 30_000 });
  await expect(link.locator('.sn-msg-rimedio')).toHaveText('Apri Crediti');
  await page.waitForTimeout(ASPETTA_VISTO_MS);
  await link.locator('.sn-msg-rimedio').click();
  await siApre(app, 'filo://credits');
});

test('riquadro «Modifica», senza invito: il motivo ha lo stile dell’errore, e «Apri Crediti» porta lì', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Modulo</title>'
    + '<textarea id="campo" style="margin:120px 40px;width:400px;height:80px;font:16px sans-serif">Un testo con un erore.</textarea>');
  await page.locator('#campo').click();
  await page.evaluate(() => { const t = document.querySelector('#campo'); t.focus(); t.select(); });
  await page.locator('#campo').click({ button: 'right' });
  await menuDi(page).voce('Modifica').click();
  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox'))?.visibile, { timeout: 10_000 }).toBe(true);
  await scrivi(app, page, '.sn-editbox-instruction', 'rendilo più corto');
  await page.keyboard.press('Enter');

  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.classi || '', { timeout: 30_000 })
    .toContain('sn-editbox-errore');
  const prop = await statoDi(app, page, '.sn-editbox-proposed');
  expect(prop.classi).not.toContain('sn-editbox-empty');
  expect(prop.testo).toMatch(/invito|Crediti/);
  // Il colore è quello dell'errore del tema, non il grigio corsivo dell'attesa.
  const stile = await nelMondoDiFilo(app, page, () => {
    const T = globalThis.SN_FILO_UI._test;
    const el = T.trova('.sn-editbox-proposed');
    const cs = getComputedStyle(el);
    const prova = document.createElement('span');
    prova.style.color = 'var(--sn-error)';
    el.parentNode.appendChild(prova);
    const errore = getComputedStyle(prova).color;
    prova.remove();
    return { colore: cs.color, corsivo: cs.fontStyle, errore };
  });
  expect(stile.corsivo).toBe('normal');
  expect(stile.colore).toBe(stile.errore);

  const tasto = await statoDi(app, page, '.sn-editbox .sn-msg-rimedio');
  expect(tasto?.testo).toBe('Apri Crediti');
  await page.screenshot({ path: `${SHOTS}/663-modifica.png` }).catch(() => {});
  expect(await aperta(app, 'filo://credits')).toBe(false);
  await clicca(app, page, '.sn-editbox .sn-msg-rimedio');
  await siApre(app, 'filo://credits');
});

test('«Traduci la pagina» coi crediti finiti: l’avviso porta ai Crediti, col clic e dal tasto destro', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await creditiFiniti(app);
  const page = await testServer.openReady(openTab, '<!doctype html><html lang="en"><meta charset="utf-8"><title>Article</title>'
    + '<p id="p1" style="margin:80px 40px">The quick brown fox jumps over the lazy dog, again and again, in the morning light.</p>');
  await page.locator('#p1').click({ button: 'right', position: { x: 5, y: 5 } });
  await menuDi(page).icona('translate').click();

  const avviso = page.locator('.sn-toast', { hasText: 'Non sono riuscito a tradurre la pagina' });
  await expect(avviso).toBeVisible({ timeout: 30_000 });
  await expect(avviso).toContainText('Crediti');
  const tasto = avviso.locator('.sn-msg-rimedio');
  await expect(tasto).toHaveText('Apri Crediti');
  await page.screenshot({ path: `${SHOTS}/663-avviso-traduzione.png` }).catch(() => {});
  // Anche l'avviso dei crediti finiti che il main manda a ogni scheda: nessun avviso nomina Crediti senza il tasto.
  const nominano = page.locator('.sn-toast', { hasText: 'pagina Crediti' });
  await expect.poll(() => nominano.count()).toBeGreaterThan(1);
  for (const a of await nominano.all()) await expect(a.locator('.sn-msg-rimedio')).toHaveText('Apri Crediti');

  // Il tasto destro sull'avviso offre la stessa strada.
  await avviso.click({ button: 'right', position: { x: 10, y: 10 } });
  await expect(menuDi(page).voce('Apri Crediti')).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('Escape');

  expect(await aperta(app, 'filo://credits')).toBe(false);
  await tasto.click();
  await siApre(app, 'filo://credits');
  await expect(avviso).toHaveCount(0, { timeout: 5_000 });
});

test('«Trascrivi» una zona, senza invito: l’avviso porta ai Crediti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Scansione</title>'
    + '<p id="t" style="font:28px sans-serif;margin:120px 40px">Un testo da trascrivere</p>');
  await page.locator('#t').click({ button: 'right', position: { x: 5, y: 5 } });
  await menuDi(page).locator('.sn-menu-row-overflow').hover();
  await menuDi(page).locator('.sn-menu-row-overflow').click().catch(() => {});
  await menuDi(page).icona('transcribe').click();
  await expect(page.locator('.sn-region-overlay')).toBeVisible({ timeout: 10_000 });
  await page.mouse.move(30, 100);
  await page.mouse.down();
  await page.mouse.move(300, 140, { steps: 5 });
  await page.mouse.move(500, 180, { steps: 5 });
  await page.mouse.up();

  const tasto = page.locator('.sn-toast .sn-msg-rimedio');
  await expect(tasto).toHaveText('Apri Crediti', { timeout: 30_000 });
  await tasto.click();
  await siApre(app, 'filo://credits');
});

test('dettatura senza invito: l’avviso porta ai Crediti', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const page = await newtabPage(app);
  await page.waitForFunction(() => document.documentElement.dataset.filoContentScripts === '1', null, { timeout: 8_000 });
  await page.waitForFunction(() => typeof window.SN_TTS?.startDictation === 'function', null, { timeout: 8_000 });
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
      return dest.stream;
    };
  });
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend',
    '<textarea id="campoDetta" style="position:fixed;top:60px;left:20px;width:320px;height:60px;z-index:9"></textarea>'));
  await page.locator('#campoDetta').focus();
  await page.locator('#campoDetta').click({ button: 'right' });
  await expect(menuDi(page).locator('.sn-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.SN_TTS.startDictation());
  await expect(page.locator('.sn-dictate-pill')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.SN_TTS.stopDictation());

  const avviso = page.locator('.sn-toast', { hasText: 'Non sono riuscito a trascrivere' });
  await expect(avviso).toBeVisible({ timeout: 15_000 });
  await expect(avviso.locator('.sn-msg-rimedio')).toHaveText('Apri Crediti');
  await avviso.locator('.sn-msg-rimedio').click();
  await siApre(app, 'filo://credits');
});

test('l’Aiuto nell’Editor senza invito: la risposta mancata è segnata come errore e «Apri Crediti» porta lì', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await apriAiuto(app, page);
  await chiediAllAiuto(page, 'di cosa parla?');
  const errore = page.locator('.sn-sidebar-msg-assistant.sn-sidebar-msg-error');
  await expect(errore).toContainText(/invito|Crediti/, { timeout: 30_000 });
  const tasto = page.locator('.sn-sidebar-choice', { hasText: 'Apri Crediti' });
  await expect(tasto).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/663-editor-aiuto.png` }).catch(() => {});
  await tasto.click();
  await siApre(app, 'filo://credits');
});

test('chat dei mazzi senza invito: «Apri Crediti» viene prima di «Riprova» e porta lì', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const page = await openTab('filo://decks/decks.html');
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  await page.fill('#chatInput', 'modi per dare haste alle creature');
  await page.press('#chatInput', 'Enter');
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla.locator('.dk-msg-error')).toContainText(/invito|Crediti/, { timeout: 30_000 });
  const tasti = bolla.locator('button.dk-retry');
  await expect(tasti.first()).toHaveText('Apri Crediti');
  await expect(tasti.nth(1)).toContainText('Riprova');
  await page.screenshot({ path: `${SHOTS}/663-mazzi-chat.png` }).catch(() => {});
  await tasti.first().click();
  await siApre(app, 'filo://credits');
});

// Il router finto nel main: il catalogo dice che il modello scelto per la chat lo servono solo host esclusi.
async function soloHostEsclusi(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const GEMINI = 'google/gemini-2.5-flash';
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'gemini-x': { provider: 'openrouter', model: GEMINI } },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.FILO_CHAT]: 'gemini-x' },
    });
    globalThis.SN_PROVIDER_OPENROUTER.forgetModelHosts();
    if (globalThis.__fetchVero) return;
    globalThis.__fetchVero = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        return json({ data: { endpoints: [{ provider_name: 'Google AI Studio', tag: 'google-ai-studio' }] } });
      }
      if (u.includes('openrouter.ai/api/v1/chat/completions')) {
        return json({ error: { code: 404, message: 'No allowed providers are available for the selected model.' } }, 404);
      }
      return globalThis.__fetchVero(url, init);
    };
  });
}

test('chat della home: sugli errori che si rimediano nelle Opzioni o in Crediti il tasto in evidenza è quello, «Riprova» resta secondario', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await soloHostEsclusi(app);

  await page.locator('#input').fill('che tempo fa domani a Roma?');
  await page.locator('#sendBtn').click();
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'nessun fornitore ammesso lo ospita' });
  await expect(bolla).toBeVisible({ timeout: 15_000 });
  const principale = bolla.locator('.dash-bubble-actions .dash-action-btn-primary');
  await expect(principale).toHaveCount(1);
  await expect(principale).toHaveText('Apri Opzioni');
  const riprova = bolla.locator('.dash-bubble-actions .dash-action-btn', { hasText: 'Riprova' });
  await expect(riprova).toBeVisible();
  await expect(riprova).not.toHaveClass(/dash-action-btn-primary/);
  await page.screenshot({ path: `${SHOTS}/828-home-tasto-principale.png` }).catch(() => {});
  await principale.click();
  await siApre(app, 'filo://options');

  // Un errore che riprovare può togliere (un guasto passeggero) tiene «Riprova» in evidenza.
  await app.evaluate(() => {
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('openrouter.ai')) return new Response('{"error":{"message":"overloaded"}}', { status: 503, headers: { 'content-type': 'application/json' } });
      return globalThis.__fetchVero(url, init);
    };
  });
  await page.bringToFront();
  await page.locator('#input').fill('e dopodomani?');
  await page.locator('#sendBtn').click();
  const passeggero = page.locator('.dash-bubble-filo', { hasText: /sovraccarico|non disponibile/ });
  await expect(passeggero).toBeVisible({ timeout: 30_000 });
  await expect(passeggero.locator('.dash-action-btn-primary')).toHaveText(/Riprova/);
});

test('chat della home senza invito: «Apri Crediti» è il tasto in evidenza', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await page.locator('#input').fill('ciao, cosa sai fare?');
  await page.locator('#sendBtn').click();
  const principale = page.locator('.dash-bubble-actions .dash-action-btn-primary');
  await expect(principale).toHaveText('Apri Crediti', { timeout: 20_000 });
  await expect(page.locator('.dash-bubble-actions .dash-action-btn', { hasText: 'Riprova' })).not.toHaveClass(/dash-action-btn-primary/);
  await principale.click();
  await siApre(app, 'filo://credits');
});
