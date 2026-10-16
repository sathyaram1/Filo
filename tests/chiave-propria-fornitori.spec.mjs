// #962 — con una chiave OpenRouter propria, «Con la mia chiave, usa anche i fornitori esclusi» nelle Opzioni: compare
// solo con la chiave salvata, acceso le richieste pagate con lei partono senza la lista di esclusione, coi crediti di
// Filo (anche dopo il ripiego dalla chiave rifiutata) la lista resta; si accende anche chiedendolo a Filo.

import { test, expect } from './fixtures/electron.mjs';
import { clickConfirm, confirmState, fillConfirmInput, scrollConfirmToEnd, CONFIRM_HOST } from './helpers/confirm.mjs';

const OWN = 'sk-or-v1-own-key-962962';
const PERSONAL = 'sk-or-v1-personal-962';
const SHOTS = 'tests/.shots';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito'));
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());

async function configura(app, { ownKey = OWN, toggle = false } = {}) {
  await app.evaluate(async (_e, { k, t }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      ownKeyAllProviders: t,
      apiKeys: { openrouter: k },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
    });
  }, { k: ownKey, t: toggle });
}

// La chiave dei crediti di Filo nel portafoglio, dove la deposita il riscatto vero.
async function chiaveNelPortafoglio(app, chiave) {
  await app.evaluate((_e, k) => {
    const Module = process.getBuiltinModule('module');
    const path = process.getBuiltinModule('path');
    const req = Module.createRequire(path.join(process.cwd(), 'src', 'main', 'main.js'));
    const w = req('./auth/wallet-store');
    if (k) w.save({ key: k, pseudonym: 'prova962' }); else w.clear();
  }, chiave);
}

// OpenRouter finto nel main: registra chiave e corpo di ogni chat, risponde servita da Google.
async function routerFinto(app, rifiuti = {}) {
  await app.evaluate((_e, st) => {
    const vero = globalThis.__f962Vero || globalThis.fetch;
    globalThis.__f962Vero = vero;
    globalThis.__f962 = [];
    globalThis.fetch = async (url, init = {}) => {
      if (!String(url).startsWith('https://openrouter.ai/api/v1/chat/completions')) return vero(url, init);
      const key = String((init.headers && init.headers.Authorization) || '').replace('Bearer ', '');
      let body = null;
      try { body = JSON.parse(init.body); } catch (_) {}
      globalThis.__f962.push({ key, body });
      if (st[key]) return new Response('{"error":{"message":"User not found."}}', { status: st[key], headers: { 'content-type': 'application/json' } });
      const sse = 'data: {"provider":"Google","choices":[{"delta":{"content":"Risposta finta 962"}}]}\n\n'
        + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
  }, rifiuti);
}
const richieste = async (app, segno) => (await app.evaluate(() => globalThis.__f962 || []))
  .filter((r) => JSON.stringify((r.body && r.body.messages) || []).includes(segno));
const ignoreDi = (r) => (r.body && r.body.provider && r.body.provider.ignore) || null;

async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('A — l’interruttore compare nelle Opzioni solo con una chiave propria salvata, e segue la chiave messa o tolta', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  const opt = await openTab('filo://options/options.html');
  await expect(opt.locator('#openWeightsOnly')).toBeVisible({ timeout: 8_000 });
  await expect(opt.locator('#ownKeyAllProviders')).toBeHidden();

  // La chiave messa dalla pagina Crediti arriva con lo stesso messaggio: l'interruttore compare senza ricaricare.
  const metti = (k) => opt.evaluate(async (chiave) => {
    await chrome.runtime.sendMessage({ type: window.SN_MSG.MSG.UPDATE_SETTINGS, settings: { apiKeys: { openrouter: chiave } } });
  }, k);
  await metti(OWN);
  await expect(opt.locator('#ownKeyAllProviders')).toBeVisible({ timeout: 5_000 });
  await expect(opt.locator('#ownKeyAllProviders')).not.toBeChecked();
  await expect(opt.locator('#ownKeyAllProviders-label')).toHaveText('Con la mia chiave, usa anche i fornitori esclusi');
  await opt.locator('#sec-own-key-providers').screenshot({ path: `${SHOTS}/962-interruttore-chiaro.png` });

  await opt.locator('#ownKeyAllProviders').check();
  await expect.poll(async () => (await impostazioni(app)).ownKeyAllProviders, { timeout: 5_000 }).toBe(true);
  await opt.reload();
  await expect(opt.locator('#ownKeyAllProviders')).toBeChecked({ timeout: 8_000 });
  await expect(opt.locator('#ownKeyAllProviders')).toBeVisible();

  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await opt.reload();
  await expect(opt.locator('#ownKeyAllProviders')).toBeVisible({ timeout: 8_000 });
  await opt.locator('#sec-own-key-providers').screenshot({ path: `${SHOTS}/962-interruttore-scuro.png` });

  // Tolta la chiave sparisce, anche dopo aver ricaricato; rimessa torna com'era.
  await metti('');
  await expect(opt.locator('#ownKeyAllProviders')).toBeHidden({ timeout: 5_000 });
  await opt.reload();
  await expect(opt.locator('#openWeightsOnly')).toBeVisible({ timeout: 8_000 });
  await expect(opt.locator('#ownKeyAllProviders')).toBeHidden();
  await metti('   ');
  await expect.poll(async () => (await impostazioni(app)).apiKeys.openrouter, { timeout: 5_000 }).toBe('   ');
  await expect(opt.locator('#ownKeyAllProviders'), 'soli spazi non sono una chiave').toBeHidden();
  await metti(OWN);
  await expect(opt.locator('#ownKeyAllProviders')).toBeChecked({ timeout: 5_000 });
});

test('B — una domanda in chat pagata con la chiave propria: acceso parte senza la lista, spento con la lista', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await routerFinto(app);

  await configura(app, { toggle: true });
  await scrivi(chat, 'prova962 acceso');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Risposta finta 962' }).last()).toBeVisible({ timeout: 15_000 });
  const accese = await richieste(app, 'prova962 acceso');
  expect(accese.length).toBeGreaterThan(0);
  expect(accese[0].key).toBe(OWN);
  expect(ignoreDi(accese[0]), JSON.stringify(accese[0].body.provider || null)).toBeNull();
  // Chi ha servito resta registrato, senza essere segnato come violazione.
  await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_HISTORY.list()))
    .some((h) => h.servedBy === 'Google' && h.policyViolation === false && JSON.stringify(h.input || '').includes('prova962 acceso')), { timeout: 5_000 }).toBe(true);

  await configura(app, { toggle: false });
  await scrivi(chat, 'prova962 spento');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Risposta finta 962' })).toHaveCount(2, { timeout: 15_000 });
  const spente = await richieste(app, 'prova962 spento');
  expect(spente.length).toBeGreaterThan(0);
  expect(ignoreDi(spente[0])).toEqual(expect.arrayContaining(['Google', 'OpenAI', 'xAI']));
  await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_HISTORY.list()))
    .some((h) => h.servedBy === 'Google' && h.policyViolation === true && JSON.stringify(h.input || '').includes('prova962 spento')), { timeout: 5_000 }).toBe(true);
});

test('C — chiave propria rifiutata con l’interruttore acceso: il ripiego sui crediti di Filo riparte con la lista', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await chiaveNelPortafoglio(app, PERSONAL);
  await routerFinto(app, { [OWN]: 401 });
  await configura(app, { toggle: true });
  await scrivi(chat, 'prova962 ripiego');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Risposta finta 962' }).last()).toBeVisible({ timeout: 15_000 });
  const giri = await richieste(app, 'prova962 ripiego');
  expect(giri.map((r) => r.key).slice(0, 2)).toEqual([OWN, PERSONAL]);
  expect(ignoreDi(giri[0])).toBeNull();
  expect(ignoreDi(giri[1])).toEqual(expect.arrayContaining(['Google', 'OpenAI', 'xAI']));
  await chiaveNelPortafoglio(app, '');
});

// Il modello finto della chat: un giro per elemento (come in impostazioni-dalla-chat.spec).
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__f962Restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__f962Tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__f962Tool.push(String(ultimo.content || ''));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const imposta = (valore, id) => ({ toolCalls: [{ id, name: 'IMPOSTA_PREFERENZA', arguments: JSON.stringify({ chiave: 'fornitori_esclusi', valore }) }] });

test('D — dalla chat: senza chiave propria Filo dice perché non lo accende; con la chiave chiede «conferma» e le Opzioni aperte lo vedono', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  // Senza chiave propria la chat paga coi crediti di Filo.
  await chiaveNelPortafoglio(app, PERSONAL);
  await configura(app, { ownKey: '' });
  await modelloFinto(app, [imposta(true, 'k1'), { text: 'Non si può.' }]);
  await scrivi(chat, 'con la mia chiave usa anche i fornitori esclusi');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Non si può.' })).toBeVisible({ timeout: 10_000 });
  expect(await confirmState(chat), 'nessun OK chiesto per un cambio senza effetto').toBeNull();
  expect((await impostazioni(app)).ownKeyAllProviders).toBe(false);
  await chat.locator('.dash-activity-head').last().click();
  await expect(chat.locator('.dash-activity').last()).toContainText('serve una tua chiave OpenRouter, da mettere nella pagina Crediti');
  await app.evaluate(() => { try { globalThis.__f962Restore?.(); } catch (_) {} });

  await configura(app, { ownKey: OWN });
  const opt = await openTab('filo://options/options.html');
  await expect(opt.locator('#ownKeyAllProviders')).toBeVisible({ timeout: 8_000 });
  await expect(opt.locator('#ownKeyAllProviders')).not.toBeChecked();
  await modelloFinto(app, [imposta(true, 'k2'), { text: 'Fatto.' }]);
  await scrivi(chat, 'con la mia chiave usa anche i fornitori esclusi');
  // Allarga chi riceve i dati: vuole la parola «conferma» a ogni livello.
  await expect(chat.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  await fillConfirmInput(chat, 'conferma');
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger');
  await expect.poll(async () => (await impostazioni(app)).ownKeyAllProviders, { timeout: 5_000 }).toBe(true);
  await opt.bringToFront();
  await expect(opt.locator('#ownKeyAllProviders')).toBeChecked({ timeout: 5_000 });

  // Spegnerlo stringe la difesa: niente parola da scrivere, e torna spento.
  await modelloFinto(app, [imposta(false, 'k3'), { text: 'Spento.' }]);
  await scrivi(chat, 'con la mia chiave non usare i fornitori esclusi');
  await expect.poll(async () => {
    if (await confirmState(chat)) { try { await clickConfirm(chat); } catch (_) {} }
    return (await impostazioni(app)).ownKeyAllProviders;
  }, { timeout: 10_000 }).toBe(false);
  await expect(opt.locator('#ownKeyAllProviders')).not.toBeChecked({ timeout: 5_000 });
  await app.evaluate(() => { try { globalThis.__f962Restore?.(); } catch (_) {} });
  await chiaveNelPortafoglio(app, '');
});
