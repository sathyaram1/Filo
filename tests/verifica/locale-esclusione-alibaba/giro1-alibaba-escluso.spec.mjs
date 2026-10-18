// Verifica locale «esclusione Alibaba», giro 1: un modello Qwen chiesto a OpenRouter non deve mai
// finire sull'host «Alibaba». Il router finto si comporta come quello vero: senza «Alibaba» in
// provider.ignore la richiesta la serve Alibaba, con l'esclusione la serve un host indipendente.

import { test, expect } from '../../fixtures/electron.mjs';

const QWEN = 'qwen/qwen3-235b-a22b-2507';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// `testardo`: il router serve Alibaba anche se escluso (la controprova deve accorgersene).
async function preparaRouter(app, settings, { testardo = false } = {}) {
  await app.evaluate(async (_e, { settings, testardo }) => {
    await globalThis.SN_STORAGE.updateSettings(settings);
    try { await globalThis.SN_HISTORY.clear(); } catch (_) {}
    globalThis.__testardo = testardo;
    globalThis.__corpi = [];
    if (!globalThis.__fetchVero) {
      globalThis.__fetchVero = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        if (!u.includes('openrouter.ai/api/v1/') || !init || !init.body || typeof init.body !== 'string') {
          return globalThis.__fetchVero(url, init);
        }
        let body;
        try { body = JSON.parse(init.body); } catch (_) { return globalThis.__fetchVero(url, init); }
        globalThis.__corpi.push({ url: u, model: body.model, provider: body.provider || null, stream: !!body.stream });
        const ignore = ((body.provider && body.provider.ignore) || []).map((s) => String(s).toLowerCase());
        const host = (!globalThis.__testardo && (ignore.includes('alibaba'))) ? 'DeepInfra' : 'Alibaba';
        if (body.stream) {
          const sse = `data: ${JSON.stringify({ provider: host, choices: [{ delta: { content: 'Risposta qwen.' } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ provider: host, model: body.model, choices: [{ message: { content: 'Risposta qwen.' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      };
    }
  }, { settings, testardo });
}

const corpi = (app) => app.evaluate(() => globalThis.__corpi);

function portaAlibaba(lista) {
  expect(lista.length).toBeGreaterThan(0);
  for (const b of lista) {
    expect(b.provider, JSON.stringify(b)).toBeTruthy();
    expect(b.provider.ignore.map((s) => s.toLowerCase())).toContain('alibaba');
  }
}

test('la chat della home con un modello Qwen esclude Alibaba e la risposta arriva da un host ammesso', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  const C = await app.evaluate(() => ({ chat: globalThis.SN_CONST.ACTIONS.FILO_CHAT }));
  await preparaRouter(app, {
    useDefaultModels: false,
    openWeightsOnly: false,
    apiKeys: { openrouter: 'k-test' },
    modelRegistry: { 'mio-qwen': { provider: 'openrouter', model: QWEN } },
    models: { [C.chat]: 'mio-qwen' },
  });

  await page.locator('#input').fill('ciao 👋 <b>prova</b>');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta qwen.' })).toBeVisible({ timeout: 20_000 });
  const tutti = await corpi(app);
  const chat = tutti.filter((b) => b.model === QWEN);
  portaAlibaba(chat);
  await page.screenshot({ path: 'tests/.shots/verifica-alibaba-chat.png' }).catch(() => {});
});

test('spiega con i modelli predefiniti, e con «solo pesi aperti», porta Alibaba nell\'esclusione; se Alibaba serve lo stesso, la cronologia lo marca', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await shell.waitForLoadState('domcontentloaded');

  let n = 0;
  const run = async (settings, opts) => {
    n += 1;
    await preparaRouter(app, settings, opts);
    return app.evaluate(async (_e, { QWEN, n }) => {
      const C = globalThis.SN_CONST;
      const MSG = globalThis.SN_MSG.MSG;
      const r = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AI_REQUEST, action: C.ACTIONS.EXPLAIN, payload: { selection: `mare${n}`, sentence: `il mare ${n} è calmo` } }, {});
      const items = await globalThis.SN_HISTORY.list();
      const v = items && items[0];
      return { ok: !(r && r.error), text: r && r.text, error: r && r.error, voce: v ? { servedBy: v.servedBy, policyViolation: v.policyViolation } : null };
    }, { QWEN, n });
  };

  // I modelli predefiniti dei test, con l'azione spiega puntata su un Qwen nella config condivisa simulata.
  const base = await app.evaluate(async (_e, QWEN) => {
    const C = globalThis.SN_CONST;
    const reg = { ...globalThis.SN_TEST_MODELS.registry, 'qwen-def': { provider: 'openrouter', model: QWEN } };
    return { reg, models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.EXPLAIN]: 'qwen-def' } };
  }, QWEN);

  const predefiniti = await run({ useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' }, modelRegistry: base.reg, models: base.models });
  expect(predefiniti.ok, JSON.stringify(predefiniti)).toBe(true);
  portaAlibaba((await corpi(app)).filter((b) => b.model === QWEN));
  expect(predefiniti.voce.servedBy).toBe('DeepInfra');
  expect(predefiniti.voce.policyViolation).toBe(false);

  const aperti = await run({ useDefaultModels: false, openWeightsOnly: true, apiKeys: { openrouter: 'k-test' }, modelRegistry: base.reg, models: base.models });
  expect(aperti.ok, JSON.stringify(aperti)).toBe(true);
  portaAlibaba((await corpi(app)).filter((b) => b.model === QWEN));

  // Il router ignora l'esclusione e serve Alibaba: la controprova deve vederlo.
  const testardo = await run({ useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' }, modelRegistry: base.reg, models: base.models }, { testardo: true });
  expect(testardo.voce.servedBy).toBe('Alibaba');
  expect(testardo.voce.policyViolation).toBe(true);

  const hist = await openTab('filo://history/history.html');
  const avviso = hist.locator('.sn-history-policy-warn');
  await expect(avviso).toHaveCount(1);
  await expect(hist.locator('.sn-history-meta').filter({ has: avviso })).toContainText('via Alibaba');
  await hist.screenshot({ path: 'tests/.shots/verifica-alibaba-cronologia.png' }).catch(() => {});
});

test('la lista effettiva della config condivisa contiene Alibaba, e l\'host dichiarato «Alibaba» è escluso prima della chiamata', async ({ app }) => {
  const out = await app.evaluate(async (_e, QWEN) => {
    const C = globalThis.SN_CONST;
    const settings = await globalThis.SN_STORAGE.getSettings();
    return {
      ignore: C.providerIgnoreList(C.DEFAULT_EXCLUDED_PROVIDERS),
      host: C.hostPolicyViolation({ name: 'Alibaba', tag: 'alibaba/opensource' }, QWEN, C.DEFAULT_EXCLUDED_PROVIDERS),
      hostSlug: C.hostPolicyViolation({ name: '', tag: 'alibaba' }, QWEN, C.DEFAULT_EXCLUDED_PROVIDERS),
      served: C.servedPolicyViolation('Alibaba Cloud', QWEN, C.DEFAULT_EXCLUDED_PROVIDERS),
      indip: C.servedPolicyViolation('DeepInfra', QWEN, C.DEFAULT_EXCLUDED_PROVIDERS),
      motivo: (C.DEFAULT_EXCLUDED_PROVIDER_REASONS || []).find((r) => r.name === 'Alibaba') || null,
      _s: !!settings,
    };
  }, QWEN);
  expect(out.ignore).toContain('Alibaba');
  expect(out.host).toBe('excluded');
  expect(out.hostSlug).toBe('excluded');
  expect(out.served).toBe('excluded');
  expect(out.indip).toBe('');
  expect(out.motivo && out.motivo.kind).toBe('producer');
});
