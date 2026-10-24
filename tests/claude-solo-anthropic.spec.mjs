// #904: Claude chiesto a OpenRouter parte legato agli host di Anthropic, e se lo serve un altro host
// (Amazon, Microsoft) la cronologia lo marca; se Anthropic non risponde lo si dice (#829).
// Regole pure: tests/unit/claudeSoloDaAnthropic.test.mjs e tests/unit/claudeProduttoreGiu.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

const CLAUDE = 'anthropic/claude-haiku-4.5';
const SPIEGAZIONE = `non può usare «${CLAUDE}» perché questo modello lo serve solo Anthropic, e adesso non risponde. Scegline un altro in Opzioni → Modelli per azione.`;

test('Claude solo da Anthropic: la richiesta lo impone, un altro host è marcato, un rifiuto si vede', async ({ app, shell, openTab }) => {
  test.setTimeout(90_000);
  await shell.waitForLoadState('domcontentloaded');

  const out = await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    const MSG = globalThis.SN_MSG.MSG;
    const Storage = globalThis.SN_STORAGE;
    const History = globalThis.SN_HISTORY;

    await Storage.setSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: {
        'mio-claude': { provider: 'openrouter', model: 'anthropic/claude-haiku-4.5' },
        'mio-aperto': { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' },
      },
      models: { [C.ACTIONS.EXPLAIN]: 'mio-claude', [C.ACTIONS.EXPLAIN_LINK]: 'mio-aperto' },
    });
    try { await History.clear(); } catch (_) {}

    const bodies = [];
    let host = 'Amazon Bedrock';
    let rifiuta = false;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      // Il catalogo degli host: Anthropic c'è, quindi un rifiuto è Anthropic che non risponde (#829).
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(String(url))) {
        const endpoints = [{ provider_name: 'Anthropic', tag: 'anthropic' }, { provider_name: 'Amazon Bedrock', tag: 'amazon-bedrock' }];
        return new Response(JSON.stringify({ data: { endpoints } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (!String(url).includes('openrouter.ai/api/v1/chat/completions')) return origFetch(url, init);
      const body = JSON.parse(init.body);
      bodies.push({ model: body.model, provider: body.provider || null });
      if (rifiuta) {
        return new Response(JSON.stringify({ error: { code: 404, message: 'No endpoints found matching your data policy and provider restrictions.' } }), { status: 404, headers: { 'content-type': 'application/json' } });
      }
      if (body.stream) {
        const sse = `data: ${JSON.stringify({ provider: host, choices: [{ delta: { content: 'risposta' } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      return new Response(JSON.stringify({ provider: host, choices: [{ message: { content: 'risposta' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const run = async (action, payload) => {
      const prima = bodies.length;
      try {
        const r = await globalThis.SN_HANDLE_MESSAGE({ type: MSG.AI_REQUEST, action, payload }, {});
        return { ok: !(r && r.error), text: r && r.text, error: r && r.error, bodies: bodies.slice(prima) };
      } catch (e) {
        return { ok: false, error: String(e && e.message), bodies: bodies.slice(prima) };
      }
    };
    const ultimaVoce = async () => {
      const items = await History.list();
      const v = items && items[0];
      return v ? { servedBy: v.servedBy, policyViolation: v.policyViolation, model: v.model } : null;
    };

    const res = {};
    try {
      res.amazon = await run(C.ACTIONS.EXPLAIN, { selection: 'ciao', sentence: 'ciao mondo' });
      res.voceAmazon = await ultimaVoce();
      host = 'Anthropic';
      res.anthropic = await run(C.ACTIONS.EXPLAIN, { selection: 'mare', sentence: 'il mare è calmo' });
      res.voceAnthropic = await ultimaVoce();
      host = 'Azure';
      res.aperto = await run(C.ACTIONS.EXPLAIN_LINK, { url: 'https://example.com', text: 'esempio' });
      res.voceAperto = await ultimaVoce();
      rifiuta = true;
      res.rifiuto = await run(C.ACTIONS.EXPLAIN, { selection: 'neve', sentence: 'nevica in montagna' });
    } finally {
      globalThis.fetch = origFetch;
    }
    return res;
  });

  // La richiesta di Claude porta il vincolo, anche quando a servirla è poi chi non dovrebbe.
  expect(out.amazon.ok, JSON.stringify(out.amazon)).toBe(true);
  expect(out.amazon.text).toContain('risposta');
  expect(out.amazon.bodies.length).toBeGreaterThan(0);
  for (const b of [...out.amazon.bodies, ...out.anthropic.bodies]) {
    expect(b.model).toBe('anthropic/claude-haiku-4.5');
    expect(b.provider.only).toEqual(['anthropic', 'claude-on-aws']);
    expect(b.provider.ignore.map((s) => s.toLowerCase())).toContain('google');
  }
  expect(out.voceAmazon).toEqual({ servedBy: 'Amazon Bedrock', policyViolation: true, model: 'anthropic/claude-haiku-4.5' });
  expect(out.voceAnthropic.servedBy).toBe('Anthropic');
  expect(out.voceAnthropic.policyViolation).toBe(false);

  // Un modello a pesi aperti resta libero di andare su qualunque host non escluso.
  expect(out.aperto.ok, JSON.stringify(out.aperto)).toBe(true);
  expect(out.aperto.bodies[0].provider.only).toBeUndefined();
  expect(out.voceAperto.policyViolation).toBe(false);

  // Anthropic non risponde: la richiesta fallisce e lo dice (#829), senza un secondo tentativo altrove.
  expect(out.rifiuto.ok).toBe(false);
  expect(out.rifiuto.error).toBe(`La funzione «Spiega (inline)» ${SPIEGAZIONE}`);
  expect(out.rifiuto.bodies.length).toBe(1);
  expect(out.rifiuto.bodies[0].provider.only).toEqual(['anthropic', 'claude-on-aws']);

  const page = await openTab('filo://history/history.html');
  const avviso = page.locator('.sn-history-policy-warn');
  await expect(avviso).toHaveCount(1);
  await expect(avviso).toHaveText('⚠ fornitore non ammesso');
  await expect(page.locator('.sn-history-meta').filter({ has: avviso })).toContainText('via Amazon Bedrock');
  await page.screenshot({ path: 'tests/.shots/904-cronologia-host-non-ammesso.png' });
});

test('il «Prova» di una riga con Claude parte legato ad Anthropic, e se Anthropic non risponde lo dice', async ({ app, openTab }) => {
  test.setTimeout(60_000);
  await app.evaluate(async (_e, { CLAUDE }) => {
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      openWeightsOnly: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { ...globalThis.SN_TEST_MODELS.registry, 'mio-claude': { provider: 'openrouter', model: CLAUDE } },
    });
    globalThis.SN_PROVIDER_OPENROUTER.forgetModelHosts();
    globalThis.__corpi = [];
    globalThis.__anthropicGiu = false;
    const vero = globalThis.fetch;
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'retry-after': '0' } });
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (/openrouter\.ai\/api\/v1\/models\/.+\/endpoints$/.test(u)) {
        return json({ data: { endpoints: [{ provider_name: 'Anthropic', tag: 'anthropic' }, { provider_name: 'Amazon Bedrock', tag: 'amazon-bedrock' }] } });
      }
      if (!u.includes('openrouter.ai/api/v1/chat/completions')) return vero(url, init);
      const body = JSON.parse(init.body);
      // Altre funzioni possono chiamare un modello nel frattempo: conta solo la richiesta della prova.
      const prova = JSON.stringify(body.messages || []).includes('Conta da 1 a 20');
      if (prova) globalThis.__corpi.push({ model: body.model, provider: body.provider || null });
      if (globalThis.__anthropicGiu && body.model === CLAUDE) return json({ error: { code: 502, message: 'Provider returned error' } }, 502);
      const sse = `data: ${JSON.stringify({ provider: 'Anthropic', choices: [{ delta: { content: '1, 2, 3' } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
  }, { CLAUDE });

  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#sec-model-registry:not([hidden])', { timeout: 8_000 });
  await page.waitForFunction((id) => [...document.querySelectorAll('#modelRegistryList .sn-model-id')].some((i) => i.value === id), CLAUDE, { timeout: 8_000 });
  await page.evaluate((id) => {
    const input = [...document.querySelectorAll('#modelRegistryList .sn-model-id')].find((i) => i.value === id);
    input.closest('.sn-model-row').dataset.provaClaude = '1';
  }, CLAUDE);
  const riga = page.locator('#modelRegistryList .sn-model-row[data-prova-claude="1"]');
  await expect(riga).toHaveCount(1);
  const stato = riga.locator('.sn-model-row-status');

  await riga.locator('.sn-model-test').click();
  await expect(stato).toContainText('TTFT', { timeout: 15_000 });
  const corpi = await app.evaluate(() => globalThis.__corpi);
  expect(corpi.length).toBe(1);
  expect(corpi[0].model).toBe(CLAUDE);
  expect(corpi[0].provider.only).toEqual(['anthropic', 'claude-on-aws']);
  expect(corpi[0].provider.ignore.map((x) => x.toLowerCase())).toContain('google');

  await app.evaluate(() => { globalThis.__anthropicGiu = true; globalThis.__corpi = []; });
  await expect(riga.locator('.sn-model-test')).toBeEnabled();
  await riga.locator('.sn-model-test').click();
  await expect(stato).toContainText(`Filo ${SPIEGAZIONE}`, { timeout: 15_000 });
  await expect(stato).not.toContainText(/riprov/i);
  const altri = await app.evaluate(() => globalThis.__corpi);
  expect(altri.length).toBeGreaterThan(0);
  expect(altri.every((b) => b.model === CLAUDE && b.provider.only.join() === 'anthropic,claude-on-aws')).toBe(true);
  await riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/829-prova-claude-anthropic-giu.png' });
});
