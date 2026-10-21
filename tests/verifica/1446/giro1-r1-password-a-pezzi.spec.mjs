// Verifica #1446 giro 1, rilievo 1: una password detta a parole («la password del wifi è …») non deve partire verso il
// controllo rapido nemmeno quando la frase arriva in due controlli, con una pausa fra la parola «password» e il valore.
import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!doctype html><meta charset="utf-8">
<body style="margin:0;padding:20px;font:16px sans-serif">
  <textarea id="ta" lang="it" style="display:block;width:760px;height:120px;font:22px monospace"></textarea>
</body>`;

async function apri(app, openTab, testServer) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.SPELLCHECK_SEMANTIC]: 'deepseek-flash', [C.ACTIONS.SPELLCHECK_CONTEXT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      featureFlags: { spellcheck: true, spellcheckContext: true },
      correttore: { modelloErrori: true, ripetizioni: true },
    });
    globalThis.__partiti = [];
    const finto = async ({ messages }) => {
      globalThis.__partiti.push(String(messages[messages.length - 1].content));
      return { text: '[][][][nessuno]', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
  const page = await testServer.openReady(openTab, PAGINA, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  return page;
}
const rapide = (app) => app.evaluate(() => globalThis.__partiti.filter((t) => t.includes('Sei il controllo rapido')).length);

test('r1 la password scritta dopo una pausa non parte verso il controllo rapido', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('ciao Marco, la password del wifi è ');
  await expect.poll(() => rapide(app), { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await page.keyboard.type('Gatto2024 a presto');
  await page.waitForTimeout(6000);
  const partiti = await app.evaluate(() => globalThis.__partiti);
  expect(await rapide(app)).toBeGreaterThan(1);
  expect(partiti.filter((t) => t.includes('Gatto2024')).length, 'nessuna richiesta porta la password').toBe(0);
});

test('r1 il numero di carta scritto in due tempi non parte intero', async ({ app, openTab, testServer }) => {
  const page = await apri(app, openTab, testServer);
  await page.locator('#ta').click();
  await page.keyboard.type('ti mando i dati, la carta è 4111 1111 ');
  await expect.poll(() => rapide(app), { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await page.keyboard.type('1111 1111 grazie');
  await expect.poll(() => rapide(app), { timeout: 6000 }).toBeGreaterThan(1);
  await page.waitForTimeout(1500);
  const partiti = await app.evaluate(() => globalThis.__partiti);
  const cifre = partiti.map((t) => (t.match(/1111/g) || []).length);
  expect(Math.max(...cifre), 'nessuna richiesta porta le cifre della carta').toBe(0);
});
