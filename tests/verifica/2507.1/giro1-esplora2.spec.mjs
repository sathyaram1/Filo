// #2507.1 giro 1: esplorazione. La prova della chat della home: stabile, e nessuna chiamata vera verso il fornitore.

import { test, expect } from '../../fixtures/electron.mjs';
import { apriFiloPerLaProva, preparaFilo } from '../../agent/provaPreparazione.mjs';
import { closeFilo } from '../../agent/driver.mjs';
import { home, chiedi } from '../../helpers/chatFinta.mjs';

test('esplora: chiamate di rete verso openrouter durante la prova della chat', async () => {
  test.setTimeout(120_000);
  const { app, shell } = await apriFiloPerLaProva();
  try {
    await app.evaluate(({ net, session }) => {
      globalThis.__rete = [];
      const f0 = globalThis.fetch;
      globalThis.fetch = (u, ...r) => { globalThis.__rete.push(`fetch ${String(u && u.url || u)}`); return f0(u, ...r); };
      const n0 = net.fetch.bind(net);
      net.fetch = (u, ...r) => { globalThis.__rete.push(`net.fetch ${String(u && u.url || u)}`); return n0(u, ...r); };
      const q0 = net.request.bind(net);
      net.request = (o, ...r) => { globalThis.__rete.push(`net.request ${typeof o === 'string' ? o : o.url || o.hostname}`); return q0(o, ...r); };
      session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*.openrouter.ai/*', '*://openrouter.ai/*'] }, (det, cb) => { globalThis.__rete.push(`sessione ${det.url}`); cb({}); });
      const P = globalThis.SN_PROVIDERS;
      const risposta = (attempts, text) => ({ model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' });
      P.streamCompleteWithFallback = async ({ attempts, onDelta }) => { onDelta && onDelta('Eccomi, sono Filo.'); return risposta(attempts, 'Eccomi, sono Filo.'); };
      P.completeWithFallback = async ({ attempts }) => risposta(attempts, '{}');
    });
    const t0 = Date.now();
    await preparaFilo(app, shell, 'k-test');
    const t1 = Date.now();
    const page = await home(app);
    await chiedi(page, 'ciao Filo');
    await expect(page.getByText('Eccomi, sono Filo.').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    const rete = await app.evaluate(() => globalThis.__rete);
    console.log(`preparazione ${t1 - t0} ms; home ${Date.now() - t1} ms`);
    console.log('RETE openrouter:', JSON.stringify(rete.filter((u) => /openrouter/i.test(u))));
  } finally {
    await closeFilo(app);
  }
});
