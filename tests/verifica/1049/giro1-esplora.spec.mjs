// #1049 verifica giro 1 — esplorazione: aspetto della fermata in chiaro e scuro, pannello staccato dalla pagina.

import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';

const SHOTS = join(resolve(dirname(fileURLToPath(import.meta.url))), '..', '..', '.shots');

const PAGINA = '<!doctype html><title>Guida infinita</title><h1>Guida</h1>'
  + Array.from({ length: 120 }, (_, i) => `<details id="sez${i}"><summary>Sezione ${i}</summary><p>Testo ${i}</p></details>`).join('');

async function prepara(app, op) {
  await app.evaluate(async (_e, op) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__aiuto = 0;
    const risposta = ({ attempts, messages }) => {
      const fatto = (text) => ({ text, finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] });
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return fatto('{}');
      const n = ++globalThis.__aiuto;
      if (op === 'shell') return fatto(JSON.stringify({ action: 'shell', command: 'settings', status: 'continue' }));
      return fatto(JSON.stringify({ text: `Apro la sezione ${n}.`, highlight: { selector: `#sez${n - 1}`, action: 'reveal' }, status: 'continue' }));
    };
    const P = globalThis.SN_PROVIDERS;
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  }, op);
}

async function apri(shell, openTab, testServer) {
  const sito = await testServer.openReady(openTab, PAGINA);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  await sito.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  await sito.fill('.sn-sidebar-input textarea', 'cosa dice?');
  await sito.press('.sn-sidebar-input textarea', 'Enter');
  return sito;
}

test('aspetto della fermata, chiaro e scuro', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  await prepara(app, 'reveal');
  const sito = await apri(shell, openTab, testServer);
  const riga = sito.locator('.sn-sidebar-log-passi');
  await expect(riga).toBeVisible({ timeout: 90_000 });
  await sito.screenshot({ path: join(SHOTS, 'v1049-chiaro.png') });
  await riga.locator('button').hover();
  await sito.locator('.sn-sidebar').screenshot({ path: join(SHOTS, 'v1049-chiaro-hover.png') });
  await app.evaluate(() => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await sito.waitForTimeout(800);
  await sito.screenshot({ path: join(SHOTS, 'v1049-scuro.png') });
});

test('pannello staccato dalla pagina: i passi da solo si fermano', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(150_000);
  await prepara(app, 'reveal');
  const sito = await apri(shell, openTab, testServer);
  await expect.poll(() => app.evaluate(() => globalThis.__aiuto), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
  await sito.evaluate(() => { document.querySelector('.sn-sidebar').closest('body > *, html > *').remove(); });
  const allo = await app.evaluate(() => globalThis.__aiuto);
  await sito.waitForTimeout(15_000);
  const dopo = await app.evaluate(() => globalThis.__aiuto);
  console.log('staccato: chiamate al distacco', allo, 'dopo 15s', dopo);
  expect(dopo - allo).toBeLessThanOrEqual(1);
});
