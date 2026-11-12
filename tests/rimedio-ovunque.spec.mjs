// #663, #828.1: quando Filo non può rispondere (senza invito, crediti finiti, modello che nessun fornitore ammesso
// serve) la frase dice dove si rimedia, e su ogni superficie c'è il tasto che ci porta: la spiegazione del tasto
// destro (parola, immagine, link), il riquadro «Modifica», gli avvisi di traduzione, trascrizione e dettatura, l'Aiuto
// (che nell'Editor è la chat del documento, #1433). Nella home quel tasto è il principale. Regola e sentinella: tests/unit/rimedioOvunque.test.mjs.
// La dettatura usa un microfono finto (un oscillatore): il resto, dalla trascrizione all'avviso, è quello vero.

import { test, expect } from './fixtures/electron.mjs';
import { statoDi, clicca, scrivi, neiRiquadri } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';
import { premiNellaBarra } from './helpers/barra.mjs';
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
  const dove = await scrivi(app, page, '.sn-editbox-instruction', 'rendilo più corto');
  await dove.keyboard.press('Enter');

  await expect.poll(async () => (await statoDi(app, page, '.sn-editbox-proposed'))?.classi || '', { timeout: 30_000 })
    .toContain('sn-editbox-errore');
  const prop = await statoDi(app, page, '.sn-editbox-proposed');
  expect(prop.classi).not.toContain('sn-editbox-empty');
  expect(prop.testo).toMatch(/invito|Crediti/);
  // Il colore è quello dell'errore del tema, non il grigio corsivo dell'attesa.
  const stile = await neiRiquadri(app, page, () => {
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
  await dove.screenshot({ path: `${SHOTS}/663-modifica.png` }).catch(() => {});
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
  await premiNellaBarra(app, 'translate');

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
  await premiNellaBarra(app, 'transcribe');
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

// ── #1344.1: le strade rimaste senza il tasto, e il «Parere di Filo» che si richiedeva da solo ─────────────────────

// Scryfall finto: due carte rosse per la ricerca, più il commander.
async function scryfallFinto(app) {
  await app.evaluate(() => {
    const carta = (id, name, extra) => ({
      id, name, cmc: 1, type_line: 'Instant', oracle_text: 'Testo.', colors: ['R'], color_identity: ['R'],
      image_uris: { normal: `https://cards.test/${id}.jpg` }, prices: { eur: '1.00' }, legalities: { commander: 'legal' },
      scryfall_uri: `https://scryfall.com/card/${id}`, mana_cost: '{R}', ...extra,
    });
    const BY_ID = {
      'niv-1': carta('niv-1', 'Niv-Mizzet, Parun', { type_line: 'Legendary Creature — Dragon Wizard', cmc: 6, colors: ['U', 'R'], color_identity: ['U', 'R'] }),
      'bolt-1': carta('bolt-1', 'Lightning Bolt'),
      'tome-1': carta('tome-1', 'Faithless Looting', { type_line: 'Sorcery' }),
    };
    globalThis.SN_SCRYFALL._setFetch(async (url) => {
      const u = new URL(String(url));
      let body = null;
      if (u.pathname === '/cards/search') {
        body = u.searchParams.get('unique') === 'prints' ? { total_cards: 3, data: [] } : { data: [BY_ID['bolt-1'], BY_ID['tome-1']], has_more: false };
      } else if (BY_ID[u.pathname.replace('/cards/', '')]) body = BY_ID[u.pathname.replace('/cards/', '')];
      else if (u.pathname === '/symbology') body = { data: [] };
      if (!body) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => body };
    });
  });
}

// Il modello finto dei mazzi: la chat cerca, il giudice tiene tutto; il parere segue `__parere` ('salta' = risponde
// senza la carta, '402' = crediti finiti) e il giudice `__giudice` ('esclusi' = nessun fornitore ammesso).
async function modelloDeiMazzi(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.DECKS_CHAT]: 'deepseek-flash', [C.ACTIONS.DECKS_OPINION]: 'deepseek-flash',
        [C.ACTIONS.DECKS_AUTOTAG]: 'deepseek-flash', [C.ACTIONS.DECKS_SEARCH_FILTER]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__pareri = 0;
    globalThis.__parere = 'salta';
    globalThis.__giudice = 'tiene';
    const risposta = ({ attempts, messages }) => {
      const tutto = messages.map((m) => String(m.content || '')).join('\n');
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      if (tutto.includes('CARTE DA VALUTARE')) {
        globalThis.__pareri += 1;
        if (globalThis.__parere === '402') {
          const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}');
          e.status = 402; e.provider = 'openrouter';
          throw e;
        }
        return fatto(JSON.stringify({ pareri: [] }));
      }
      if (tutto.includes('CARTE CANDIDATE')) {
        if (globalThis.__giudice === 'esclusi') {
          const e = new Error('No allowed providers are available for the selected model.');
          e.code = 'NO_ALLOWED_HOST'; e.model = 'google/gemini-2.5-flash'; e.hosts = ['Google AI Studio'];
          throw e;
        }
        return fatto('{"keep":[1,2]}');
      }
      return fatto(JSON.stringify({ reply: 'Ecco.', query: 'c:r' }));
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  });
}

async function mazzoNuovo(page) {
  await page.waitForLoadState('domcontentloaded');
  await page.click('#newDeck');
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const deckId = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/deck/', ''));
  await page.evaluate(async (id) => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.DECKS_SET_COMMANDER, id, scryfallId: 'niv-1' }), deckId);
  return deckId;
}

const pareri = (app) => app.evaluate(() => globalThis.__pareri);

test('«Parere di Filo» che non arriva: una richiesta, non una raffica; il motivo, «Apri Crediti» e «Riprova»', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await scryfallFinto(app);
  await modelloDeiMazzi(app);
  const page = await openTab('filo://decks/decks.html');
  await mazzoNuovo(page);
  await page.fill('#chatInput', 'carte rosse che pescano');
  await page.press('#chatInput', 'Enter');
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla.locator('.dk-cardlist .dk-row')).toHaveCount(2, { timeout: 20_000 });
  await bolla.locator('[data-add="bolt-1"]').click();
  const riga = page.locator('#deckList .dk-row[data-card-id="bolt-1"]');
  await expect(riga).toBeVisible();

  await riga.hover();
  await expect(page.locator('#statePreview')).toBeVisible();
  await page.locator('#previewModule').click({ button: 'right' });
  await page.locator('.sn-select-pop .sn-select-option', { hasText: 'Parere di Filo' }).click();
  await riga.hover();
  const modulo = page.locator('#previewModule');
  // Il modello risponde senza il parere di quella carta: si dice, e non si richiede da solo.
  await expect(modulo.locator('.dk-op-errore')).toContainText('senza il parere di questa carta', { timeout: 15_000 });
  const prima = await pareri(app);
  await page.waitForTimeout(3000);
  expect(await pareri(app), 'richieste ripetute da sole a carta ferma').toBe(prima);
  expect(prima).toBeLessThanOrEqual(2);
  // La frase manda dove chi usa Filo cambia il modello, non nella Gestione, e il tasto porta lì.
  await expect(modulo.locator('.dk-op-errore')).not.toContainText('Modelli predefiniti');
  await expect(modulo.locator('.dk-op-errore')).toContainText('Opzioni → Modelli per azione');
  await expect(modulo.locator('.dk-rimedio')).toHaveText('Apri Opzioni');

  // Crediti finiti: «Riprova» chiede una volta, e il motivo porta il tasto per la pagina Crediti, in evidenza.
  await app.evaluate(() => { globalThis.__parere = '402'; });
  await modulo.locator('[data-op-retry]').click();
  await expect(modulo.locator('.dk-op-errore')).toContainText('Crediti', { timeout: 15_000 });
  expect(await pareri(app)).toBe(prima + 1);
  await page.waitForTimeout(3000);
  expect(await pareri(app), 'coi crediti finiti nessuna raffica').toBe(prima + 1);
  const tasti = modulo.locator('.dk-mod-actions button');
  await expect(tasti.first()).toHaveText('Apri Crediti');
  await expect(tasti.nth(1)).toHaveText('Riprova');
  await page.screenshot({ path: `${SHOTS}/1344-parere-crediti.png` }).catch(() => {});
  await app.evaluate(() => globalThis.__filoHandlers.applySettingsUpdate({ theme: 'dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-sn-theme', 'dark', { timeout: 5_000 });
  await modulo.screenshot({ path: `${SHOTS}/1344-parere-crediti-scuro.png` }).catch(() => {});
  expect(await aperta(app, 'filo://credits')).toBe(false);
  await tasti.first().click();
  await siApre(app, 'filo://credits');
});

test('chat dei mazzi: il controllo delle carte senza fornitore ammesso porta «Apri Opzioni» prima di «Riprova», anche riaprendo', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await scryfallFinto(app);
  await modelloDeiMazzi(app);
  await app.evaluate(() => { globalThis.__giudice = 'esclusi'; });
  const page = await openTab('filo://decks/decks.html');
  await mazzoNuovo(page);
  await page.fill('#chatInput', 'carte rosse che pescano');
  await page.press('#chatInput', 'Enter');
  const bolla = page.locator('.dk-msg-bot').last();
  await expect(bolla).toContainText('Opzioni', { timeout: 20_000 });
  const tasti = bolla.locator('button.dk-retry');
  await expect(tasti.first()).toHaveText('Apri Opzioni');
  await expect(tasti.nth(1)).toContainText('Riprova');
  await page.screenshot({ path: `${SHOTS}/1344-mazzi-filtro.png` }).catch(() => {});

  // La chat si rilegge dal salvataggio: il tasto resta.
  await page.reload();
  await expect(page.locator('#screenBuilder')).toBeVisible();
  const riletta = page.locator('.dk-msg-bot').last();
  await expect(riletta.locator('button.dk-retry').first()).toHaveText('Apri Opzioni', { timeout: 10_000 });
  await riletta.locator('button.dk-retry').first().click();
  await siApre(app, 'filo://options');
});

test('Editor, tasto destro sul titolo senza invito: «Rigenera titolo» e «Rigenera riassunto» dicono perché e portano ai Crediti', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.locator('#doc').click();
  await editor.keyboard.type('Una nota sul bilancio del trimestre, con le spese di manutenzione.');

  for (const [voce, cosa] of [['Rigenera titolo', 'il titolo'], ['Rigenera riassunto', 'il riassunto']]) {
    await editor.locator('#docTitle').click({ button: 'right' });
    await editor.locator('.ed-title-ctxmenu .sn-select-option', { hasText: voce }).click();
    const avviso = editor.locator('.ed-toast', { hasText: `Non sono riuscito a generare ${cosa}` });
    await expect(avviso).toBeVisible({ timeout: 15_000 });
    await expect(avviso).toContainText('invito');
    await expect(avviso.locator('.ed-toast-action')).toHaveText('Apri Crediti');
  }
  await editor.screenshot({ path: `${SHOTS}/1344-editor-titolo.png` }).catch(() => {});
  await editor.locator('.ed-toast', { hasText: 'il riassunto' }).locator('.ed-toast-action').click();
  await siApre(app, 'filo://credits');
});

test('«Leggi» senza invito: l’avviso dice perché e porta ai Crediti', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await senzaChiave(app);
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Leggi</title>'
    + '<p id="t" style="font:18px sans-serif;margin:120px 40px">Questo testo va letto ad alta voce.</p>');
  await page.evaluate(() => {
    const r = document.createRange(); r.selectNodeContents(document.querySelector('#t'));
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('#t').click({ button: 'right' });
  await menuDi(page).locator('.sn-menu-label', { hasText: 'Leggi' }).first().click();
  const avviso = page.locator('.sn-toast', { hasText: 'voce del browser' });
  await expect(avviso).toBeVisible({ timeout: 15_000 });
  await expect(avviso).toContainText('invito');
  await expect(avviso.locator('.sn-msg-rimedio')).toHaveText('Apri Crediti');
  await avviso.locator('.sn-msg-rimedio').click();
  await siApre(app, 'filo://credits');
});

test('«Leggi» coi crediti finiti porta ai Crediti; col modello che vuole il nome di una voce, alle Preferenze della lettura', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const T = globalThis.SN_TEST_MODELS;
    const nick = C.parseModelRefs(T.models[C.ACTIONS.TTS])[0];
    await globalThis.SN_STORAGE.setSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...T.registry, [nick]: { provider: 'openrouter', model: 'acme/voce-muta' } },
      models: { ...T.models },
      tts: { voice: '', rate: 1, pitch: 1, modelVoice: '' },
    });
    globalThis.__ttsMode = '402';
    globalThis.SN_PROVIDER_OPENROUTER.synthesizeSpeech = async () => {
      const e = globalThis.__ttsMode === '402'
        ? Object.assign(new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}'), { status: 402, provider: 'openrouter' })
        : Object.assign(new Error('OpenRouter 400: {"error":{"message":"An explicit voice is required for this TTS provider.","code":400}}'), { status: 400 });
      throw e;
    };
  });
  const page = await testServer.openReady(openTab, '<!doctype html><meta charset="utf-8"><title>Leggi</title>'
    + '<p id="t" style="font:18px sans-serif;margin:120px 40px">Questo testo va letto ad alta voce.</p>');
  const leggi = async () => {
    await page.evaluate(() => {
      const r = document.createRange(); r.selectNodeContents(document.querySelector('#t'));
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    });
    await page.locator('#t').click({ button: 'right' });
    await menuDi(page).locator('.sn-menu-label', { hasText: 'Leggi' }).first().click();
  };

  await leggi();
  const crediti = page.locator('.sn-toast', { hasText: 'voce del browser' }).last();
  await expect(crediti).toContainText('crediti', { timeout: 15_000 });
  await expect(crediti).not.toContainText('non disponibile ora');
  await expect(crediti.locator('.sn-msg-rimedio')).toHaveText('Apri Crediti');
  await page.screenshot({ path: `${SHOTS}/1344-leggi-crediti.png` }).catch(() => {});

  await app.evaluate(() => { globalThis.__ttsMode = 'muto'; });
  await page.keyboard.press('Escape');
  await leggi();
  const voce = page.locator('.sn-toast', { hasText: 'Lettura ad alta voce' });
  await expect(voce).toBeVisible({ timeout: 15_000 });
  await expect(voce.locator('.sn-msg-rimedio')).toHaveText('Apri Preferenze');
  await voce.locator('.sn-msg-rimedio').click();
  await siApre(app, 'filo://preferences/preferences.html#sec-lettura');
});

test('descrizione automatica di un’immagine copiata senza modello: l’avviso porta alle Opzioni', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.DESCRIBE_IMAGE]: '' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_ACTIONS?.pushClipboardEntry === 'function', null, { timeout: 10_000 });
  await page.evaluate((b64) => window.SN_ACTIONS.pushClipboardEntry({ type: 'image', dataUrl: `data:image/png;base64,${b64}`, description: 'Descrizione…' }), PNG_B64);
  const avviso = page.locator('.sn-toast', { hasText: 'Opzioni' });
  await expect(avviso).toBeVisible({ timeout: 15_000 });
  await expect(avviso.locator('.sn-msg-rimedio')).toHaveText('Apri Opzioni');
  await avviso.locator('.sn-msg-rimedio').click();
  await siApre(app, 'filo://options');
});

test('immagine copiata coi crediti finiti: la cronologia non promette una descrizione che non arriverà', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { ...globalThis.SN_TEST_MODELS.models },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDER_OPENROUTER;
    const boom = () => { const e = new Error('OpenRouter 402: {"error":{"message":"Insufficient credits"}}'); e.status = 402; e.provider = 'openrouter'; throw e; };
    globalThis.SN_PROVIDER_OPENROUTER = { ...P, streamComplete: boom, complete: boom };
  });
  const page = await newtabPage(app);
  await page.waitForFunction(() => typeof window.SN_ACTIONS?.pushClipboardEntry === 'function', null, { timeout: 10_000 });
  await page.evaluate((b64) => window.SN_ACTIONS.pushClipboardEntry({ type: 'image', dataUrl: `data:image/png;base64,${b64}`, description: 'Descrizione…' }), PNG_B64);
  await expect(page.locator('.sn-toast .sn-msg-rimedio', { hasText: 'Apri Crediti' })).toBeVisible({ timeout: 15_000 });
  const descrizione = async () => {
    const storia = await page.evaluate(async () => chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.GET_CLIPBOARD_HISTORY }));
    return ((storia && storia.items) || [])[0]?.description || '';
  };
  await expect.poll(descrizione, { timeout: 10_000 }).not.toBe('Descrizione…');
});
