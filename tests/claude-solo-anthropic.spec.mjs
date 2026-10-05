// #904: Claude chiesto a OpenRouter parte legato agli host di Anthropic, e se lo serve un altro host
// (Amazon, Microsoft) la cronologia lo marca. Regole pure: tests/unit/claudeSoloDaAnthropic.test.mjs.

import { test, expect } from './fixtures/electron.mjs';

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

  // Anthropic non risponde: la richiesta fallisce e lo dice, senza un secondo tentativo altrove.
  expect(out.rifiuto.ok).toBe(false);
  expect(String(out.rifiuto.error)).toMatch(/404|endpoint/i);
  expect(out.rifiuto.bodies.length).toBe(1);
  expect(out.rifiuto.bodies[0].provider.only).toEqual(['anthropic', 'claude-on-aws']);

  const page = await openTab('filo://history/history.html');
  const avviso = page.locator('.sn-history-policy-warn');
  await expect(avviso).toHaveCount(1);
  await expect(avviso).toHaveText('⚠ fornitore non ammesso');
  await expect(page.locator('.sn-history-meta').filter({ has: avviso })).toContainText('via Amazon Bedrock');
  await page.screenshot({ path: 'tests/.shots/904-cronologia-host-non-ammesso.png' });
});
