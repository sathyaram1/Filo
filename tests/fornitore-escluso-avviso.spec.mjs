// #1478 — una risposta servita davvero da un fornitore che la politica esclude si vede: un avviso sulla pagina, anche
// senza «solo pesi aperti», e il segno sulla sua voce della Cronologia AI. Un avviso per host ogni dieci minuti; chi
// con la sua chiave ha ammesso i fornitori esclusi non lo riceve. Chi viola, a regole pure: produttoriEsclusi.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const OWN = 'sk-or-v1-own-key-1478';
const SHOTS = 'tests/.shots';
const AVVISO = 'Questa risposta è arrivata da';

async function home(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return w.url().startsWith('filo://newtab') && !w.url().includes('incognito'); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function configura(app, { ownKeyAllProviders = false } = {}) {
  await app.evaluate(async (_e, tutti) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      ownKeyAllProviders: tutti,
      apiKeys: { openrouter: 'sk-or-v1-own-key-1478' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'mio-claude': { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' } },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.EXPLAIN]: 'deepseek-flash', [C.ACTIONS.EXPLAIN_DEEP]: 'mio-claude' },
    });
  }, ownKeyAllProviders);
}

// OpenRouter finto nel main: ogni risposta la serve l'host scritto in globalThis.__host1478.
async function routerFinto(app) {
  await app.evaluate(() => {
    const vero = globalThis.__vero1478 || globalThis.fetch;
    globalThis.__vero1478 = vero;
    globalThis.__host1478 = 'DeepSeek';
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        return json({ data: { endpoints: [{ provider_name: 'Anthropic', tag: 'anthropic' }, { provider_name: 'DeepInfra', tag: 'deepinfra' }] } });
      }
      if (!u.startsWith('https://openrouter.ai/api/v1/chat/completions')) return vero(url, init);
      const host = globalThis.__host1478;
      let body = {};
      try { body = JSON.parse(init.body); } catch (_) {}
      if (body.stream) {
        const sse = `data: ${JSON.stringify({ provider: host, choices: [{ delta: { content: 'Risposta finta 1478' } }] })}\n\n`
          + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\ndata: [DONE]\n\n';
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return json({ provider: host, choices: [{ message: { content: 'Risposta finta 1478' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    };
  });
}

const servitaDa = (app, host) => app.evaluate((_e, h) => { globalThis.__host1478 = h; }, host);

// Una richiesta del tasto destro, come la manda la pagina: ogni testo è nuovo, così nessuna risposta arriva dalla cache.
const spiega = (app, azione, testo) => app.evaluate(async (_e, { azione: a, testo: t }) => {
  const C = globalThis.SN_CONST;
  const r = await globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.AI_REQUEST, action: C.ACTIONS[a], payload: { selection: t, sentence: `${t} in una frase` } }, {});
  return { ok: Boolean(r && !r.error), error: r && r.error };
}, { azione, testo });

async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('una risposta servita da un fornitore escluso: avviso sulla pagina e segno nella Cronologia AI', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await home(app);
  await routerFinto(app);
  await configura(app);
  await app.evaluate(async () => { try { await globalThis.SN_HISTORY.clear(); } catch (_) {} });

  // Ogni avviso che nasce sulla home, anche quelli già chiusi quando si guarda.
  await chat.evaluate((testo) => {
    window.__avvisi1478 = [];
    new MutationObserver((muta) => {
      for (const m of muta) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList.contains('sn-toast') && n.textContent.includes(testo)) window.__avvisi1478.push(n.textContent);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }, AVVISO);
  const avvisi = () => chat.evaluate(() => window.__avvisi1478.slice());

  // La domanda in chat la serve DeepSeek, che Filo esclude: l'avviso lo dice, senza «solo pesi aperti».
  await scrivi(chat, 'domanda1478 prima');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Risposta finta 1478' }).last()).toBeVisible({ timeout: 15_000 });
  const avviso = chat.locator('.sn-toast', { hasText: '«DeepSeek»' });
  await expect(avviso).toBeVisible({ timeout: 5_000 });
  await expect(avviso).toContainText('un fornitore che Filo esclude');
  await chat.waitForTimeout(400);
  await chat.screenshot({ path: `${SHOTS}/1478-avviso-home.png` }).catch(() => {});

  // Lo stesso host subito dopo non ne impila un secondo.
  await scrivi(chat, 'domanda1478 seconda');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Risposta finta 1478' })).toHaveCount(2, { timeout: 15_000 });
  await chat.waitForTimeout(800);
  expect(await avvisi()).toHaveLength(1);

  // Un Claude servito da Amazon Bedrock: escluso perché non è Anthropic, e l'avviso lo dice così.
  await servitaDa(app, 'Amazon Bedrock');
  expect((await spiega(app, 'EXPLAIN_DEEP', 'parola1478 bedrock')).ok).toBe(true);
  const bedrock = chat.locator('.sn-toast', { hasText: '«Amazon Bedrock»' });
  await expect(bedrock).toBeVisible({ timeout: 5_000 });
  await expect(bedrock).toContainText('solo da Anthropic');

  // Un host ammesso non avvisa.
  await servitaDa(app, 'DeepInfra');
  expect((await spiega(app, 'EXPLAIN', 'parola1478 ammessa')).ok).toBe(true);

  // Con la chiave propria e i fornitori esclusi ammessi chi serve si registra e basta; spento, lo stesso host avvisa.
  await servitaDa(app, 'Google');
  await configura(app, { ownKeyAllProviders: true });
  expect((await spiega(app, 'EXPLAIN', 'parola1478 ammessi')).ok).toBe(true);
  await chat.waitForTimeout(800);
  expect((await avvisi()).filter((t) => t.includes('«Google»'))).toHaveLength(0);
  await configura(app);
  expect((await spiega(app, 'EXPLAIN', 'parola1478 esclusa')).ok).toBe(true);
  await expect(chat.locator('.sn-toast', { hasText: '«Google»' })).toBeVisible({ timeout: 5_000 });
  expect((await avvisi()).map((t) => t.match(/«([^»]+)»/)[1])).toEqual(['DeepSeek', 'Amazon Bedrock', 'Google']);

  // Nella Cronologia AI il segno sta sulle voci servite fuori dalla politica, e solo lì.
  const storia = await openTab('filo://history/history.html');
  const voce = (testo) => storia.locator('.sn-history-item', { hasText: testo });
  const segno = (testo) => voce(testo).locator('.sn-history-policy-warn');
  await expect(voce('parola1478 esclusa')).toBeVisible({ timeout: 10_000 });
  for (const t of ['domanda1478 prima', 'domanda1478 seconda', 'parola1478 bedrock', 'parola1478 esclusa']) {
    await expect(segno(t), `la voce «${t}» deve essere segnata`).toHaveText('⚠ fornitore non ammesso');
  }
  await expect(voce('domanda1478 prima')).toContainText('via DeepSeek');
  await expect(voce('parola1478 bedrock')).toContainText('via Amazon Bedrock');
  await expect(segno('parola1478 bedrock')).toHaveAttribute('title', /non doveva arrivare da lì/);
  for (const t of ['parola1478 ammessa', 'parola1478 ammessi']) {
    await expect(voce(t)).toBeVisible();
    await expect(segno(t), `la voce «${t}» non va segnata`).toHaveCount(0);
  }
  await storia.screenshot({ path: `${SHOTS}/1478-cronologia-chiaro.png` }).catch(() => {});
  await app.evaluate(async () => { await globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }); });
  await storia.reload();
  await expect(segno('parola1478 esclusa')).toBeVisible({ timeout: 10_000 });
  await storia.screenshot({ path: `${SHOTS}/1478-cronologia-scuro.png` }).catch(() => {});
});

test('«Segnala» nell’avviso apre «Invia feedback» già scritto, e in Cronologia l’host si trova cercandolo', async ({ app, shell, openTab }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await home(app);
  await routerFinto(app);
  await configura(app);
  await app.evaluate(async () => { try { await globalThis.SN_HISTORY.clear(); } catch (_) {} });
  await servitaDa(app, 'Google Vertex');

  await scrivi(chat, 'domanda1478 segnala');
  const avviso = chat.locator('.sn-toast', { hasText: '«Google Vertex»' });
  await expect(avviso).toBeVisible({ timeout: 15_000 });
  const tasto = avviso.locator('.sn-msg-rimedio');
  await expect(tasto).toHaveText('Segnala');
  await chat.waitForTimeout(400);
  await chat.screenshot({ path: `${SHOTS}/1478-avviso-segnala.png` }).catch(() => {});
  await tasto.click();
  const testo = chat.locator('.sn-fb-overlay .sn-fb-text');
  await expect(testo).toBeVisible({ timeout: 5_000 });
  await expect(testo).toHaveValue(/«Google Vertex»/);
  await expect(testo).toHaveValue(/deepseek/);
  await expect(avviso).toHaveCount(0, { timeout: 5_000 });
  await chat.screenshot({ path: `${SHOTS}/1478-segnala-feedback.png` }).catch(() => {});
  await chat.locator('.sn-fb-overlay .sn-fb-cancel').click();

  const storia = await openTab('filo://history/history.html');
  await expect(storia.locator('.sn-history-item', { hasText: 'domanda1478 segnala' })).toBeVisible({ timeout: 10_000 });
  for (const q of ['Vertex', 'non ammesso']) {
    await storia.locator('#search').fill(q);
    await expect(storia.locator('.sn-history-item', { hasText: 'domanda1478 segnala' }), `cercando «${q}»`).toBeVisible({ timeout: 3_000 });
  }
  await storia.locator('#search').fill('DeepInfra');
  await expect(storia.locator('.sn-history-item')).toHaveCount(0, { timeout: 3_000 });
});
