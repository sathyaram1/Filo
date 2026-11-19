import { test, expect } from '../../fixtures/electron.mjs';
import { apriFiloPerLaProva, preparaFilo } from '../../agent/provaPreparazione.mjs';
import { closeFilo } from '../../agent/driver.mjs';
import { home, chiedi } from '../../helpers/chatFinta.mjs';

test('esplora: chiamate vere al fornitore durante la preparazione con fornitore finto', async () => {
  test.setTimeout(150_000);
  const { app, shell } = await apriFiloPerLaProva();
  try {
    await app.evaluate(() => {
      globalThis.__vere = [];
      const vera = globalThis.fetch;
      globalThis.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || String(input);
        const h = init && init.headers;
        const auth = h && (typeof h.get === 'function' ? h.get('authorization') : (h.Authorization || h.authorization));
        if (/openrouter\.ai/.test(url)) globalThis.__vere.push({ url, auth: auth || '' });
        return vera.call(this, input, init);
      };
      globalThis.__provaChiamate = [];
      const P = globalThis.SN_PROVIDERS;
      const risposta = (attempts, text) => ({ model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' });
      P.streamCompleteWithFallback = async ({ attempts, onDelta }) => { onDelta && onDelta('Eccomi, sono Filo.'); return risposta(attempts, 'Eccomi, sono Filo.'); };
      P.completeWithFallback = async ({ attempts }) => risposta(attempts, '{}');
    });
    await preparaFilo(app, shell, 'k-test');
    const page = await home(app);
    await chiedi(page, 'ciao Filo');
    await expect(page.getByText('Eccomi, sono Filo.').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(5000);
    const vere = await app.evaluate(() => globalThis.__vere);
    console.log('CHIAMATE', JSON.stringify(vere, null, 1));
  } finally {
    await closeFilo(app);
  }
});
