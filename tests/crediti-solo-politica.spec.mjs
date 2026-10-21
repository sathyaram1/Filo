// Coi crediti di Filo solo i modelli della politica (#830): modelli propri, un modello chiuso su «spiega» e nessuna
// chiave propria → chi usa Filo legge la frase condivisa e il router non riceve la richiesta. Con un modello a pesi
// aperti la stessa strada risponde (il finto server è vivo); il «Prova» di una riga dice la stessa frase, e la scelta
// di una voce fuori politica lo avvisa subito.
// Il finto server è quello di tests/ripiego-crediti.spec.mjs, ridotto: portafoglio, identità e OpenRouter.

import { createServer } from 'node:http';
import { test, expect } from './fixtures/electron.mjs';
import { statoDi, conta, clicca } from './helpers/riquadri.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const testoDi = async (app, page, sel) => (await statoDi(app, page, sel))?.testo || '';

const PERSONAL_KEY = 'sk-or-v1-test-personal';
const CHIUSO = 'openai/gpt-5';
const frase = (funzione) => `La funzione «${funzione}» non può usare «${CHIUSO}» perché coi crediti di Filo questo modello non si usa. `
  + 'Per usarlo metti una tua chiave OpenRouter nella pagina Crediti, o scegline un altro in Opzioni → Modelli per azione.';

let server;
let base = '';
const seen = { completions: [] };
let redeemed = false; // il portafoglio esiste solo dopo il riscatto

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const url = req.url.split('?')[0];
      const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch (_) { body = {}; }
      if (url === '/accounts:signUp') return json(res, 200, { idToken: 'anon-id-token', refreshToken: 'anon-refresh', expiresIn: '3600', localId: 'anon-uid-1' });
      if (url === '/token') return json(res, 200, { id_token: 'anon-id-token', refresh_token: 'anon-refresh', expires_in: '3600', user_id: 'anon-uid-1' });
      if (url === '/walletState') {
        if (!redeemed) return json(res, 200, { result: { hasWallet: false, invitesOpen: true, configured: true } });
        return json(res, 200, { result: { hasWallet: true, pseudonym: 'abcdef0123456789', balance: { credits: 4990, creditsGranted: 5000, limitUsd: 4.2, usageUsd: 0.01, remainingUsd: 4.19, eurUsd: 1.2, eurPerCredit: 0.0007 }, stale: false, dailyCredits: 100, invites: [] } });
      }
      if (url === '/walletRedeem') {
        redeemed = true;
        return json(res, 200, { result: { status: 'ok', key: PERSONAL_KEY, pseudonym: 'abcdef0123456789', credits: 5000, entryCredits: 5000, migrated: 0, localRequested: 0, inviteCodes: [] } });
      }
      if (url === '/api/v1/chat/completions') {
        const msgs = Array.isArray(body.messages) ? body.messages : [];
        if (JSON.stringify(msgs).includes('preparare la dashboard')) { req.socket.destroy(); return undefined; }
        seen.completions.push({ key: bearer, model: body.model });
        if (body.stream !== true) {
          return json(res, 200, { id: 'gen-1', provider: 'Fake', choices: [{ message: { content: 'RISPOSTA-APERTA.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.0002 } });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ id: 'gen-1', provider: 'Fake', choices: [{ delta: { content: 'RISPOSTA-APERTA.' } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 5, cost: 0.0002 } })}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      }
      if (url === '/api/v1/generation') return json(res, 404, { error: { message: 'not yet' } });
      if (url.startsWith('/v1/projects/') && url.endsWith(':commit')) return json(res, 200, { writeResults: (body.writes || []).map(() => ({})) });
      return json(res, 404, { error: { message: `not found ${url}` } });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  process.env.FILO_FUNCTIONS_BASE = base;
  process.env.FILO_IDENTITY_ENDPOINT = `${base}/accounts:signUp`;
  process.env.FILO_SECURE_TOKEN_ENDPOINT = `${base}/token`;
});

test.afterAll(async () => {
  delete process.env.FILO_FUNCTIONS_BASE;
  delete process.env.FILO_IDENTITY_ENDPOINT;
  delete process.env.FILO_SECURE_TOKEN_ENDPOINT;
  await new Promise((r) => server.close(r));
});

test.beforeEach(() => { seen.completions.length = 0; redeemed = false; });

async function redirectHosts(app) {
  await app.evaluate((_, b) => {
    if (globalThis.__filoFetchVero) return;
    const vero = globalThis.fetch;
    globalThis.__filoFetchVero = vero;
    globalThis.fetch = (url, init) => vero(String(url).replace(/^https:\/\/openrouter\.ai/, b).replace(/^https:\/\/firestore\.googleapis\.com/, b), init);
  }, base);
}

// Modelli propri, nessuna chiave propria: paga la chiave personale dei crediti (#598).
async function prepare(app, explainRef) {
  await redirectHosts(app);
  await app.evaluate(async (_, { ref, chiuso }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: '' },
      models: { [C.ACTIONS.EXPLAIN]: ref, [C.ACTIONS.EXPLAIN_DEEP]: ref },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, gpt: { provider: 'openrouter', model: chiuso }, aura: { provider: 'openrouter', model: 'deepgram/aura-2' } },
    });
  }, { ref: explainRef, chiuso: CHIUSO });
}

async function redeemWallet(openTab) {
  const page = await openTab('filo://credits/credits.html');
  await expect(page.locator('#redeemForm')).toBeVisible({ timeout: 15000 });
  await page.fill('#inviteCode', 'abcd-efgh');
  await page.click('#redeemBtn');
  await expect(page.locator('#redeemMsg')).toContainText('riscattato', { timeout: 10000 });
  return page;
}

const seleziona = (page) => page.evaluate(() => {
  const r = document.createRange();
  r.selectNodeContents(document.querySelector('#t'));
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
});

// La scorciatoia di «spiega»: il riquadro dell'approfondimento.
async function spiega(app, page) {
  await seleziona(page);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w._filoTabs);
    globalThis.__filoShortcuts.dispatch('explain-selection', win);
  });
}

const PAGINA = '<!doctype html><meta charset="utf-8"><title>Prova</title>'
  + '<p id="t" style="font:18px sans-serif;margin:120px 40px">La fotosintesi trasforma la luce in zuccheri.</p>';

test('«spiega» con un modello chiuso pagato coi crediti: la frase lo dice e il router non riceve niente; con un modello aperto risponde', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const crediti = await redeemWallet(openTab);
  await prepare(app, 'gpt');
  const page = await testServer.openReady(openTab, PAGINA);
  // Il tasto destro: la spiegazione nel menu.
  await seleziona(page);
  await page.locator('#t').click({ button: 'right' });
  const menu = menuDi(page);
  await expect(menu.pannelli.first()).toBeVisible({ timeout: 10000 });
  await expect(menu.locator('.sn-menu-inline-explain')).toContainText(frase('Spiega (inline)'), { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/830-spiega-menu.png' }).catch(() => {});
  await page.keyboard.press('Escape');
  // La scorciatoia: il riquadro.
  await spiega(app, page);
  await expect.poll(() => testoDi(app, page, '.sn-popup'), { timeout: 30000 }).toContain(frase('Approfondisci'));
  // Il tasto sotto la frase porta dove la frase manda per prima: la pagina Crediti.
  expect(await testoDi(app, page, '.sn-popup .sn-msg-rimedio')).toBe('Apri Crediti');
  await page.screenshot({ path: 'tests/.shots/830-spiega-riquadro.png' }).catch(() => {});
  expect(seen.completions.filter((c) => c.model === CHIUSO)).toEqual([]);

  // Il «Prova» della riga, pagato coi crediti: la stessa frase, senza la funzione.
  const prova = await crediti.evaluate(async ({ key, model }) => chrome.runtime.sendMessage({
    type: 'test_provider', provider: 'openrouter', apiKey: key, model,
  }), { key: PERSONAL_KEY, model: CHIUSO });
  expect(prova.ok).toBe(false);
  expect(prova.error).toBe(`Filo non può usare «${CHIUSO}» perché coi crediti di Filo questo modello non si usa. `
    + 'Per usarlo metti una tua chiave OpenRouter nella pagina Crediti, o scegline un altro in Opzioni → Modelli per azione.');
  expect(seen.completions.filter((c) => c.model === CHIUSO)).toEqual([]);

  // Scegliendo la voce, l'avviso lo dice prima di provarla (nessuna chiamata, nemmeno per chiedere gli host).
  const voce = await crediti.evaluate(() => chrome.runtime.sendMessage({ type: 'audio_host_check', action: 'tts', nickname: 'aura', label: 'Aura-2' }));
  expect(voce.verdict).toBe('crediti');
  expect(voce.warning).toBe('Con «Aura-2» la lettura ad alta voce non parte coi crediti di Filo: per usarlo metti una tua chiave OpenRouter nella pagina Crediti.');

  // La stessa strada con un modello a pesi aperti: il router riceve, coi crediti, e la spiegazione arriva.
  await clicca(app, page, '.sn-popup .sn-popup-close');
  await expect.poll(() => conta(app, page, '.sn-popup')).toBe(0);
  await prepare(app, 'deepseek-flash');
  await page.evaluate(() => { document.querySelector('#t').textContent = 'Un’altra frase, da spiegare col modello aperto.'; });
  await spiega(app, page);
  await expect.poll(() => testoDi(app, page, '.sn-popup'), { timeout: 30000 }).toContain('RISPOSTA-APERTA');
  expect(seen.completions.some((c) => c.key === PERSONAL_KEY && c.model !== CHIUSO)).toBe(true);
});

// Preme il «Prova» della riga col modello `id` e torna il testo della riga a prova finita.
async function provaRiga(page, id) {
  await page.waitForFunction((m) => [...document.querySelectorAll('#modelRegistryList .sn-model-id')].some((i) => i.value === m), id, { timeout: 10_000 });
  await page.evaluate((m) => {
    document.querySelectorAll('[data-in-prova]').forEach((r) => r.removeAttribute('data-in-prova'));
    const input = [...document.querySelectorAll('#modelRegistryList .sn-model-id')].find((i) => i.value === m);
    input.closest('.sn-model-row').dataset.inProva = '1';
  }, id);
  const riga = page.locator('#modelRegistryList .sn-model-row[data-in-prova="1"]');
  await riga.locator('.sn-model-test').click();
  const stato = riga.locator('.sn-model-row-status');
  await expect.poll(async () => (await stato.textContent()) || '', { timeout: 20_000 }).not.toMatch(/in corso|^\s*$/i);
  return { riga, testo: (await stato.textContent()) || '' };
}

test('il «Prova» premuto nelle Opzioni senza una chiave propria paga coi crediti: sul modello chiuso la frase, su quello aperto la prova riesce', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app, 'deepseek-flash');
  const page = await openTab('filo://options/options.html');
  const chiuso = await provaRiga(page, CHIUSO);
  expect(chiuso.testo).toContain(`Filo non può usare «${CHIUSO}» perché coi crediti di Filo questo modello non si usa. `);
  expect(seen.completions.filter((c) => c.model === CHIUSO)).toEqual([]);
  await chiuso.riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/830-prova-opzioni.png' }).catch(() => {});

  const aperto = await app.evaluate(() => globalThis.SN_TEST_MODELS.registry['deepseek-flash'].model);
  const esito = await provaRiga(page, aperto);
  expect(esito.testo).not.toMatch(/API key|fallita/i);
  expect(seen.completions.some((c) => c.key === PERSONAL_KEY && c.model === aperto)).toBe(true);
});

test('cambiare nelle Opzioni il modello di una riga dichiarata a pesi aperti: la dichiarazione non segue il modello chiuso', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await redeemWallet(openTab);
  await prepare(app, 'deepseek-flash');
  // Una riga cambiata prima della regola: il registro salvato porta ancora la dichiarazione del modello di prima.
  await app.evaluate(async (_, chiuso) => {
    const s = await globalThis.SN_STORAGE.getSettings();
    const reg = { ...s.modelRegistry, vecchia: { provider: 'openrouter', model: chiuso, weights: 'open' } };
    await globalThis.SN_STORAGE.updateSettings({ modelRegistry: reg });
  }, CHIUSO);

  const opzioni = await openTab('filo://options/options.html');
  const righe = opzioni.locator('#modelRegistryList .sn-model-row:not(.sn-model-row-head)');
  const indiceDi = (nick) => righe.evaluateAll((rs, n) => rs.findIndex((r) => r.querySelector('.sn-model-nick')?.value === n), nick);
  await expect.poll(() => indiceDi('deepseek-flash'), { timeout: 10000 }).toBeGreaterThan(-1);
  const riga = righe.nth(await indiceDi('deepseek-flash'));
  await riga.locator('.sn-model-id').fill(CHIUSO);
  await riga.locator('.sn-model-id').press('Tab');
  const salvata = () => opzioni.evaluate(async () => (await window.SN_STORAGE.getSettings()).modelRegistry['deepseek-flash']);
  await expect.poll(async () => (await salvata())?.model, { timeout: 8000 }).toBe(CHIUSO);
  expect((await salvata()).weights).toBeUndefined();

  const page = await testServer.openReady(openTab, PAGINA);
  await spiega(app, page);
  await expect.poll(() => testoDi(app, page, '.sn-popup'), { timeout: 30000 }).toContain(frase('Approfondisci'));

  // La riga salvata prima della regola, su «spiega»: la stessa frase.
  await clicca(app, page, '.sn-popup .sn-popup-close');
  await expect.poll(() => conta(app, page, '.sn-popup')).toBe(0);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ models: { [C.ACTIONS.EXPLAIN]: 'vecchia', [C.ACTIONS.EXPLAIN_DEEP]: 'vecchia' } });
  });
  await spiega(app, page);
  await expect.poll(() => testoDi(app, page, '.sn-popup'), { timeout: 30000 }).toContain(frase('Approfondisci'));
  expect(seen.completions.filter((c) => c.model === CHIUSO)).toEqual([]);
});
