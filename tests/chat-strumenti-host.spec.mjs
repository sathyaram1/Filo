// #700: la chat con gli strumenti chiede al router solo host che li reggono davvero, in streaming e no;
// un modello che non ragiona non perde la chat, e se fra gli host ammessi non ne resta nessuno la chat lo dice.
// Regole pure: tests/unit/openrouterTools.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const NO_PARAMS = 'No endpoints found that can handle the requested parameters. To learn more about provider routing, visit: https://openrouter.ai/docs/provider-routing';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Il router finto nel main: registra ogni corpo e risponde secondo `modo`
// ('ok' | 'senza-ragionamento' = nessun host regge `reasoning` | 'nessuno' = ogni richiesta con strumenti riceve `rifiuto`).
async function preparaRouter(app, modo, rifiuto = NO_PARAMS) {
  await app.evaluate(async (_e, { modo, rifiuto }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
    });
    globalThis.__routerModo = modo;
    globalThis.__rifiuto = rifiuto;
    globalThis.__corpi = [];
    if (!globalThis.__fetchVero) {
      globalThis.__fetchVero = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (!String(url).includes('openrouter.ai/api/v1/chat/completions')) return globalThis.__fetchVero(url, init);
        const body = JSON.parse(init.body);
        globalThis.__corpi.push(body);
        const m = globalThis.__routerModo;
        const rifiuta = body.tools && (m === 'nessuno' || (m === 'senza-ragionamento' && body.reasoning));
        if (rifiuta) {
          return new Response(JSON.stringify({ error: { code: 404, message: globalThis.__rifiuto } }), { status: 404, headers: { 'content-type': 'application/json' } });
        }
        if (body.stream) {
          const sse = `data: ${JSON.stringify({ provider: 'DeepInfra', choices: [{ delta: { content: 'Ecco fatto.' } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ provider: 'DeepInfra', choices: [{ message: { content: 'Ecco fatto.' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    }
  }, { modo, rifiuto });
}

const corpiConStrumenti = (app) => app.evaluate(() => globalThis.__corpi
  .filter((b) => Array.isArray(b.tools) && b.tools.length)
  .map((b) => ({ stream: b.stream, reasoning: !!b.reasoning, provider: b.provider || null, tools: b.tools.length })));

function vincoliIntatti(corpi) {
  expect(corpi.length).toBeGreaterThan(0);
  for (const b of corpi) {
    expect(b.provider.require_parameters).toBe(true);
    // La lista di esclusione di serie viaggia insieme al vincolo: Google e DeepSeek li esclude Filo.
    expect(b.provider.ignore).toEqual(expect.arrayContaining(['Google', 'DeepSeek']));
  }
}

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('la chat in diretta chiede solo host che reggono gli strumenti, e la risposta arriva', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'ok');

  await scrivi(page, 'cerca il meteo di domani');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' })).toBeVisible({ timeout: 15_000 });
  const corpi = await corpiConStrumenti(app);
  vincoliIntatti(corpi);
  expect(corpi.every((b) => b.stream === true)).toBe(true);
});

test('un modello che non ragiona non perde la chat: si rifà senza ragionamento, col vincolo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'senza-ragionamento');

  await scrivi(page, 'che ore sono a Tokyo?');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' })).toBeVisible({ timeout: 15_000 });
  const corpi = await corpiConStrumenti(app);
  vincoliIntatti(corpi);
  expect(corpi.map((b) => b.reasoning)).toEqual([true, false]);
});

test('il rifiuto del ragionamento si paga al primo messaggio: il secondo va dritto', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'senza-ragionamento');

  const risposte = page.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' });
  await scrivi(page, 'che ore sono a Tokyo?');
  await expect(risposte).toHaveCount(1, { timeout: 15_000 });
  await scrivi(page, 'e a Lima?');
  await expect(risposte).toHaveCount(2, { timeout: 15_000 });
  const corpi = await corpiConStrumenti(app);
  vincoliIntatti(corpi);
  expect(corpi.map((b) => b.reasoning)).toEqual([true, false, false]);
});

test('nessun host ammesso regge gli strumenti: la chat lo dice, e niente parte senza vincolo', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'nessuno');

  await scrivi(page, 'apri le impostazioni');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'nessun fornitore ammesso sa usare gli strumenti' });
  await expect(bolla).toBeVisible({ timeout: 15_000 });
  await expect(bolla).toContainText('Scegli un altro modello in Modelli predefiniti.');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ecco fatto.' })).toHaveCount(0);
  const corpi = await corpiConStrumenti(app);
  vincoliIntatti(corpi);
  expect(corpi).toHaveLength(2);
  await page.screenshot({ path: 'tests/.shots/700-chat-nessun-host-strumenti.png' });
});

test('un rifiuto per la privacy dell\'account non viene raccontato come mancanza di strumenti', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await preparaRouter(app, 'nessuno', 'No endpoints found matching your data policy (Paid model training). Configure: https://openrouter.ai/settings/privacy');

  await scrivi(page, 'che ore sono a Tokyo?');
  const bolla = page.locator('.dash-bubble-filo', { hasText: 'privacy' });
  await expect(bolla).toBeVisible({ timeout: 15_000 });
  await expect(bolla).toContainText('openrouter.ai/settings/privacy');
  await expect(bolla).not.toContainText('strumenti');
  const corpi = await corpiConStrumenti(app);
  vincoliIntatti(corpi);
  expect(corpi).toHaveLength(1);
});

test('la chat senza diretta (chiamata normale) porta lo stesso vincolo e lo stesso errore', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await preparaRouter(app, 'ok');
  const chiedi = () => app.evaluate(async () => globalThis.SN_HANDLE_MESSAGE(
    { type: globalThis.SN_MSG.MSG.FILO_CHAT, userMessage: 'dimmi una curiosità', threadHistory: [] },
    { url: 'filo://newtab/newtab.html' },
  ));

  const ok = await chiedi();
  expect(ok.ok, JSON.stringify(ok)).toBe(true);
  expect(ok.text).toContain('Ecco fatto.');
  let corpi = await corpiConStrumenti(app);
  vincoliIntatti(corpi);
  expect(corpi.every((b) => b.stream === false)).toBe(true);

  await preparaRouter(app, 'nessuno');
  const ko = await chiedi();
  expect(ko.ok).toBe(false);
  expect(ko.code).toBe('NO_TOOL_HOST');
  expect(ko.error).toMatch(/^Per il modello scelto nessun fornitore ammesso sa usare gli strumenti/);
  corpi = await corpiConStrumenti(app);
  vincoliIntatti(corpi);
});
