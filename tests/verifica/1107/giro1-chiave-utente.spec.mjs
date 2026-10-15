// Verifica #1107 giro 1: la chiave Tavily scritta dall'utente parte davvero verso la ricerca,
// dalle Preferenze e dall'Aiuto, con la chiave di fabbrica nel pacchetto.
import { test, expect } from '../../fixtures/electron.mjs';

process.env.FILO_DEFAULT_TAVILY_KEY = 'tav-fabbrica-v1107';

async function spiaTavily(app) {
  await app.evaluate(() => {
    globalThis.__vero1107 = globalThis.__vero1107 || global.fetch;
    globalThis.__viste1107 = [];
    global.fetch = async (u, init) => {
      if (String(u).includes('api.tavily.com')) {
        globalThis.__viste1107.push(JSON.parse(init.body).api_key);
        return { ok: true, status: 200, async json() { return { results: [{ title: 'Orche', url: 'https://example.com/o', content: 'c' }] }; }, async text() { return ''; } };
      }
      return globalThis.__vero1107(u, init);
    };
  });
}
const viste = (app) => app.evaluate(() => globalThis.__viste1107.slice());

test('chiave scritta nelle Preferenze (interruttore spento, scritta, riacceso): la ricerca dell\'Aiuto usa quella', async ({ app, openTab }) => {
  const page = await openTab('filo://options/options.html');
  await page.waitForSelector('#useDefaultModels', { timeout: 8_000 });
  await page.uncheck('#useDefaultModels');
  await page.fill('#apiKeyTavily', '  tav-utente-v1107 ');
  await page.locator('#apiKeyTavily').blur();
  await page.check('#useDefaultModels');
  await expect.poll(() => app.evaluate(async () => {
    const s = await globalThis.__filoHandlers.getEffectiveSettings();
    return `${s.useDefaultModels !== false}|${s.apiKeys.tavily}`;
  }), { timeout: 6_000 }).toBe('true|tav-utente-v1107');

  await spiaTavily(app);
  const r = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'web_search', query: 'orche', parole: ['orche'] }));
  expect(r.provider).toBe('tavily');
  expect(await viste(app)).toEqual(['tav-utente-v1107']);

  await page.uncheck('#useDefaultModels');
  await page.fill('#apiKeyTavily', '');
  await page.locator('#apiKeyTavily').blur();
  await page.check('#useDefaultModels');
  await expect.poll(() => app.evaluate(async () => (await globalThis.__filoHandlers.getEffectiveSettings()).apiKeys.tavily), { timeout: 6_000 }).toBe('tav-fabbrica-v1107');
  await spiaTavily(app);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'web_search', query: 'orche', parole: ['orche'] }));
  expect(await viste(app)).toEqual(['tav-fabbrica-v1107']);
});
