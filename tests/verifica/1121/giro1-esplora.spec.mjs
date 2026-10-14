// Esplorazione del giro 1 di #1121: modelli predefiniti (il caso comune) con la scelta personale degli host.

import { test, expect } from '../../fixtures/electron.mjs';

const OPTIONS_URL = 'filo://options/options.html';

async function intercetta(app) {
  await app.evaluate(async () => {
    globalThis.__richieste = [];
    const vero = global.fetch;
    global.fetch = async (url, init) => {
      const u = String(url && url.url ? url.url : url);
      if (!u.includes('openrouter.ai')) return vero(url, init);
      let corpo = null;
      try { corpo = JSON.parse((init && init.body) || 'null'); } catch (_) { corpo = null; }
      globalThis.__richieste.push({ url: u, corpo });
      if (u.includes('/chat/completions')) {
        if (corpo && corpo.stream) {
          const sse = 'data: {"choices":[{"delta":{"content":"1, 2, 3"}}]}\n\n'
            + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":9},"provider":"Baseten"}\n\n'
            + 'data: [DONE]\n\n';
          return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify({ id: 'g', provider: 'Baseten', choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });
}

test('esplora: scelta personale chiesta a parole, coi modelli predefiniti, arriva alla chat', async ({ app, openTab }) => {
  await app.evaluate(async () => {
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: true, openWeightsOnly: false, ordineHost: '', apiKeys: { openrouter: 'sk-or-finta' } });
  });
  await intercetta(app);
  const opzioni = await openTab(OPTIONS_URL);
  await opzioni.waitForSelector('#ordineHost', { timeout: 8_000 });
  await expect(opzioni.locator('#ordineHost')).toBeVisible();
  const voci = await opzioni.locator('#ordineHost option').allTextContents();
  console.log('VOCI', JSON.stringify(voci));

  const esito = await app.evaluate(async () => globalThis.SN_PREF.buildPreferencePartial('chat più veloce', 'velocità'));
  console.log('PARTIAL', JSON.stringify(esito));
  const page = await openTab('filo://dashboard/dashboard.html');
  await page.evaluate(async (p) => window.filo.message({ type: 'update_settings', settings: p }), esito.partial);
  // La pagina aperta si riallinea alla scelta fatta a parole.
  await expect(opzioni.locator('#ordineHost')).toHaveValue('throughput', { timeout: 5_000 });

  const flusso = await page.evaluate(async () => new Promise((risolvi) => {
    window.filo.aiStream({
      action: 'explain',
      payload: { messages: [{ role: 'user', content: `ciao ${Date.now()}` }] },
      onDone: () => risolvi({ ok: true }),
      onError: (e) => risolvi({ ok: false, e: e && e.message }),
    });
    setTimeout(() => risolvi({ ok: false, e: 'scaduto' }), 15000);
  }));
  expect(flusso.ok, JSON.stringify(flusso)).toBe(true);
  const viste = await app.evaluate(() => globalThis.__richieste.filter((r) => r.url.includes('/chat/completions')).map((r) => r.corpo && r.corpo.provider));
  console.log('PROVIDER', JSON.stringify(viste));
  expect(viste.length).toBeGreaterThan(0);
  for (const p of viste) {
    expect(p && p.sort).toBe('throughput');
    expect(p && Array.isArray(p.ignore) && p.ignore.length).toBeTruthy();
  }

  // Cambiata nella pagina, la scelta si salva e il «Prova» di un predefinito misura con quella.
  await opzioni.bringToFront();
  await opzioni.selectOption('#ordineHost', 'price');
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).ordineHost), { timeout: 5_000 }).toBe('price');
  await app.evaluate(() => { globalThis.__richieste.length = 0; });
  const riga = opzioni.locator('#defaultModelsList .sn-default-model-row:not(.sn-model-row-head)').first();
  await riga.waitFor({ timeout: 15_000 });
  await riga.locator('.sn-model-test').click();
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 20_000 });
  const prova = await app.evaluate(() => globalThis.__richieste.filter((r) => r.url.includes('/chat/completions')).map((r) => r.corpo && r.corpo.provider));
  console.log('PROVA', JSON.stringify(prova));
  expect(prova[0] && prova[0].sort).toBe('price');

  // Tornata a «Lo sceglie Filo», la misura presa con «prezzo» non resta.
  await opzioni.selectOption('#ordineHost', '');
  await expect(riga.locator('.sn-model-row-status')).not.toHaveText(/TTFT\s+\d/, { timeout: 5_000 });
  await opzioni.selectOption('#ordineHost', 'price');
  await expect(riga.locator('.sn-model-row-status')).toHaveText(/TTFT\s+\d/, { timeout: 5_000 });

  for (const tema of ['light', 'dark']) {
    await app.evaluate(async (_e, t) => { await globalThis.SN_STORAGE.updateSettings({ theme: t }); }, tema);
    await opzioni.reload();
    await opzioni.waitForSelector('#ordineHost', { timeout: 8_000 });
    await opzioni.waitForTimeout(800);
    await opzioni.locator('#sec-host-order').scrollIntoViewIfNeeded();
    await opzioni.screenshot({ path: `tests/.shots/1121-opzioni-${tema}.png` });
  }
});
