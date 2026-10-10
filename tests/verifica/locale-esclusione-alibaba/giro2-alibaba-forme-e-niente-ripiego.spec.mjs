// Verifica locale «esclusione Alibaba», giro 2: un modello Qwen che su OpenRouter serve SOLO Alibaba
// (qwen-plus, qwen3.7-max) deve fallire in modo evidente senza un ripiego che tolga l'esclusione, e chi
// ha servito scritto in un'altra forma («Alibaba Cloud Int.», «alibaba/us-east-1») resta riconosciuto.

import { test, expect } from '../../fixtures/electron.mjs';

const SOLO_ALIBABA = ['qwen/qwen-plus', 'qwen/qwen3.7-max'];
const MISTO = 'qwen/qwen3-235b-a22b-2507';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

// Router finto come quello vero: un modello «solo Alibaba» con Alibaba escluso risponde 404 «No allowed
// providers»; senza esclusione lo serve Alibaba. `servito` forza il nome riportato (la controprova).
async function preparaRouter(app, settings, { servito = null } = {}) {
  await app.evaluate(async (_e, { settings, servito, SOLO_ALIBABA }) => {
    await globalThis.SN_STORAGE.updateSettings(settings);
    try { await globalThis.SN_HISTORY.clear(); } catch (_) {}
    globalThis.__servito = servito;
    globalThis.__soloAlibaba = SOLO_ALIBABA;
    globalThis.__corpi = [];
    if (!globalThis.__fetchVero2) {
      globalThis.__fetchVero2 = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        const u = String(url);
        const m = /openrouter\.ai\/api\/v1\/models\/(.+)\/endpoints/.exec(u);
        if (m) {
          const id = decodeURIComponent(m[1]);
          const endpoints = globalThis.__soloAlibaba.includes(id)
            ? [{ provider_name: 'Alibaba', tag: 'alibaba' }, { provider_name: 'Alibaba', tag: 'alibaba/us-east-1' }]
            : [{ provider_name: 'Alibaba', tag: 'alibaba' }, { provider_name: 'DeepInfra', tag: 'deepinfra/fp8' }];
          return new Response(JSON.stringify({ data: { endpoints } }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (!u.includes('openrouter.ai/api/v1/') || !init || typeof init.body !== 'string') {
          return globalThis.__fetchVero2(url, init);
        }
        let body;
        try { body = JSON.parse(init.body); } catch (_) { return globalThis.__fetchVero2(url, init); }
        globalThis.__corpi.push({ url: u, model: body.model, provider: body.provider || null, stream: !!body.stream });
        const ignore = ((body.provider && body.provider.ignore) || []).map((s) => String(s).toLowerCase());
        const escluso = ignore.includes('alibaba');
        let host;
        if (globalThis.__servito) host = globalThis.__servito;
        else if (globalThis.__soloAlibaba.includes(body.model)) {
          if (escluso) {
            return new Response(JSON.stringify({ error: { message: 'No allowed providers are available for the selected model.', code: 404 } }),
              { status: 404, headers: { 'content-type': 'application/json' } });
          }
          host = 'Alibaba';
        } else host = escluso ? 'DeepInfra' : 'Alibaba';
        if (body.stream) {
          const sse = `data: ${JSON.stringify({ provider: host, choices: [{ delta: { content: 'Risposta qwen.' } }] })}\n\ndata: [DONE]\n\n`;
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ provider: host, model: body.model, choices: [{ message: { content: 'Risposta qwen.' } }], usage: {} }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      };
    }
  }, { settings, servito, SOLO_ALIBABA });
}

const corpi = (app) => app.evaluate(() => globalThis.__corpi);

function tuttiEscludonoAlibaba(lista) {
  expect(lista.length).toBeGreaterThan(0);
  for (const b of lista) {
    expect(b.provider, JSON.stringify(b)).toBeTruthy();
    expect((b.provider.ignore || []).map((s) => s.toLowerCase()), JSON.stringify(b)).toContain('alibaba');
  }
}

test('la prova dalle Opzioni di un Qwen servito solo da Alibaba non ripiega e dice perché non parte', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await shell.waitForLoadState('domcontentloaded');
  await preparaRouter(app, { useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' } });
  const r = await app.evaluate(async () => {
    const MSG = globalThis.SN_MSG.MSG;
    return globalThis.SN_HANDLE_MESSAGE({ type: MSG.TEST_PROVIDER, provider: 'openrouter', apiKey: 'k-test', model: 'qwen/qwen-plus' }, {});
  });
  expect(r && r.ok, JSON.stringify(r)).toBe(false);
  expect(String(r.error)).toMatch(/ammess|esclu/i);
  const tutti = await corpi(app);
  tuttiEscludonoAlibaba(tutti.filter((b) => b.model === 'qwen/qwen-plus'));
});

test('la chat della home con un Qwen servito solo da Alibaba fallisce in chiaro, e nessuna richiesta toglie Alibaba', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  const C = await app.evaluate(() => ({ chat: globalThis.SN_CONST.ACTIONS.FILO_CHAT }));
  await preparaRouter(app, {
    useDefaultModels: false,
    openWeightsOnly: false,
    apiKeys: { openrouter: 'k-test' },
    modelRegistry: { 'qwen-max': { provider: 'openrouter', model: 'qwen/qwen3.7-max' } },
    models: { [C.chat]: 'qwen-max' },
  });
  await page.locator('#input').fill('che tempo fa domani?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('body')).toContainText(/fra quelli ammessi/, { timeout: 30_000 });
  await expect(page.locator('body')).not.toContainText('Risposta qwen.');
  const tutti = await corpi(app);
  tuttiEscludonoAlibaba(tutti.filter((b) => b.model === 'qwen/qwen3.7-max'));
  await page.screenshot({ path: 'tests/.shots/verifica-alibaba-g2-chat-rifiuto.png' }).catch(() => {});
});

test('chi ha servito scritto come «Alibaba Cloud Int.», «alibaba/us-east-1» o «ALIBABA» marca la cronologia', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await shell.waitForLoadState('domcontentloaded');
  const base = await app.evaluate(async (_e, MISTO) => {
    const C = globalThis.SN_CONST;
    const reg = { ...globalThis.SN_TEST_MODELS.registry, 'qwen-def': { provider: 'openrouter', model: MISTO } };
    return { reg, models: { ...globalThis.SN_TEST_MODELS.models, [C.ACTIONS.EXPLAIN]: 'qwen-def' } };
  }, MISTO);
  const esiti = {};
  let n = 0;
  for (const forma of ['Alibaba Cloud Int.', 'alibaba/us-east-1', 'ALIBABA', ' Alibaba Cloud ', 'DeepInfra']) {
    n += 1;
    await preparaRouter(app, { useDefaultModels: false, openWeightsOnly: false, apiKeys: { openrouter: 'k-test' }, modelRegistry: base.reg, models: base.models }, { servito: forma });
    esiti[forma] = await app.evaluate(async (_e, n) => {
      const C = globalThis.SN_CONST;
      const MSG = globalThis.SN_MSG.MSG;
      await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AI_REQUEST, action: C.ACTIONS.EXPLAIN, payload: { selection: `onda${n}`, sentence: `una onda ${n} alta` } }, {});
      const items = await globalThis.SN_HISTORY.list();
      const v = items && items[0];
      return v ? { servedBy: v.servedBy, policyViolation: v.policyViolation } : null;
    }, n);
    tuttiEscludonoAlibaba((await corpi(app)).filter((b) => b.model === MISTO));
  }
  for (const forma of ['Alibaba Cloud Int.', 'alibaba/us-east-1', 'ALIBABA', ' Alibaba Cloud ']) {
    expect(esiti[forma] && esiti[forma].policyViolation, `${forma}: ${JSON.stringify(esiti[forma])}`).toBe(true);
  }
  expect(esiti.DeepInfra && esiti.DeepInfra.policyViolation).toBe(false);
});
