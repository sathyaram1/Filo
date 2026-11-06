// Verifica #1718 giro 1: porte vicine allo scenario (stop durante la ricerca web, fra un passo e l'altro, pannello
// tolto con la chiamata in volo, ragionamento con markup). Modello finto nel main, come negli spec dell'area.

import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDellAiuto } from '../../helpers/riquadri.mjs';

const SHOTS = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), '.shots');
const PAGINA = '<!doctype html><title>Guida</title><h1>Guida</h1>'
  + Array.from({ length: 40 }, (_, i) => `<details id="sez${i}"><summary>Sezione ${i}</summary><p>Testo ${i}</p></details>`).join('');

async function prepara(app, passi) {
  await app.evaluate(async (_e, passi) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__aiuto = { chiamate: 0, interrotte: 0, rilascia: null, passi, ricerche: 0, rilasciaRicerca: null };
    const risposta = async ({ attempts, messages, signal, onReasoning, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
      const sistema = String((messages.find((m) => m.role === 'system') || {}).content || '');
      if (!sistema.includes('# Protocollo di risposta')) return { ...base, text: '{}' };
      const A = globalThis.__aiuto;
      const n = A.chiamate;
      const p = A.passi[Math.min(n, A.passi.length - 1)];
      A.chiamate += 1;
      for (const pezzo of p.pensa || []) { try { onReasoning && onReasoning(pezzo); } catch (_) {} }
      if (p.aspetta) {
        await new Promise((ok, ko) => {
          A.rilascia = ok;
          if (!signal) return;
          const via = () => { A.interrotte += 1; const e = new Error('aborted'); e.name = 'AbortError'; ko(e); };
          if (signal.aborted) via(); else signal.addEventListener('abort', via, { once: true });
        });
      }
      const text = JSON.stringify(p.serie ?{ highlight: { selector: `#sez${n}`, action: 'reveal' }, status: 'continue' } : p.risposta);
      try { onDelta && onDelta(text); } catch (_) {}
      return { ...base, text };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = risposta;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = risposta;
    globalThis.SN_WEB_SEARCH.search = () => new Promise((ok) => {
      globalThis.__aiuto.ricerche += 1;
      globalThis.__aiuto.rilasciaRicerca = () => ok({ provider: 'prova', results: [{ title: 'Uno', url: 'https://esempio.it/', snippet: 'x' }] });
    });
  }, passi);
}

async function apriAiuto(app, shell, openTab, testServer) {
  const sito = await testServer.openReady(openTab, PAGINA);
  const id = await shell.evaluate(async () => (await window.filoShell.tabs.snapshot()).activeId);
  await shell.evaluate((tabId) => window.filoShell.tabs.help(tabId), id);
  const aiuto = await paginaDellAiuto(app, sito);
  await aiuto.waitForSelector('.sn-sidebar-input textarea', { timeout: 8_000 });
  return { sito, aiuto };
}
async function chiedi(aiuto, testo) {
  await aiuto.fill('.sn-sidebar-input textarea', testo);
  await aiuto.press('.sn-sidebar-input textarea', 'Enter');
}
const stato = (app) => app.evaluate(() => {
  const A = globalThis.__aiuto;
  return { chiamate: A.chiamate, interrotte: A.interrotte, ricerche: A.ricerche };
});
const tasto = (aiuto) => aiuto.locator('.sn-sidebar-input button[type="submit"]');

test('stop durante la ricerca web: niente chiamata dopo, pannello pronto', async ({ app, shell, openTab, testServer }) => {
  await prepara(app, [
    { risposta: { action: 'web_search', query: 'orari' } },
    { risposta: { text: 'Trovato.', status: 'done' } },
  ]);
  const { aiuto } = await apriAiuto(app, shell, openTab, testServer);
  await chiedi(aiuto, 'a che ora apre?');
  await expect.poll(() => stato(app).then((s) => s.ricerche), { timeout: 15_000 }).toBe(1);
  await expect(aiuto.locator('.sn-sidebar-attesa').last()).toContainText('Cerco sul web');
  await aiuto.locator('.sn-sidebar').screenshot({ path: join(SHOTS, 'v1718-cerco-sul-web.png') });
  await aiuto.waitForTimeout(600);
  await tasto(aiuto).click();
  await expect(aiuto.locator('.sn-sidebar-log-fermato')).toBeVisible();
  await expect(tasto(aiuto)).toHaveAttribute('data-modo', 'invia');
  await app.evaluate(() => globalThis.__aiuto.rilasciaRicerca());
  await aiuto.waitForTimeout(2500);
  expect((await stato(app)).chiamate).toBe(1);
});

test('stop fra un passo e l\'altro: nessuna chiamata parte dopo il clic', async ({ app, shell, openTab, testServer }) => {
  await prepara(app, [{ risposta: () => 0 }]);
  const { sito, aiuto } = await apriAiuto(app, shell, openTab, testServer);
  await chiedi(aiuto, 'apri tutto');
  await expect(aiuto.locator('.sn-sidebar-log', { hasText: 'sezione aperta' })).toHaveCount(2, { timeout: 20_000 });
  await tasto(aiuto).click();
  const alClic = (await stato(app)).chiamate;
  await expect(aiuto.locator('.sn-sidebar-log-fermato')).toBeVisible();
  await expect(tasto(aiuto)).toHaveAttribute('data-modo', 'invia');
  await sito.waitForTimeout(3000);
  expect((await stato(app)).chiamate).toBe(alClic);
  expect(alClic).toBeLessThan(6);
});

test('pannello tolto con la chiamata in volo: la sua risposta non apre niente e non ne parte un\'altra', async ({ app, shell, openTab, testServer }) => {
  await prepara(app, [{ aspetta: true, pensa: ['apro la prima'], risposta: { highlight: { selector: '#sez0', action: 'reveal' }, status: 'continue' } }]);
  const { sito, aiuto } = await apriAiuto(app, shell, openTab, testServer);
  await chiedi(aiuto, 'apri tutto');
  await expect.poll(() => stato(app).then((s) => s.chiamate), { timeout: 15_000 }).toBe(1);
  await aiuto.evaluate(() => document.querySelector('.sn-sidebar').remove());
  await app.evaluate(() => globalThis.__aiuto.rilascia());
  await sito.waitForTimeout(3000);
  expect((await stato(app)).chiamate).toBe(1);
  expect(await sito.evaluate(() => document.querySelectorAll('details[open]').length)).toBe(0);
});

test('il ragionamento con markup si legge come testo', async ({ app, shell, openTab, testServer }) => {
  await prepara(app, [{ aspetta: true, pensa: ['<img src=x onerror="window.__x=1"><b>grassetto</b>'], risposta: { text: 'Ok.', status: 'done' } }]);
  const { aiuto } = await apriAiuto(app, shell, openTab, testServer);
  await chiedi(aiuto, 'pensa');
  const attesa = aiuto.locator('.sn-sidebar-attesa');
  await expect(attesa).toContainText('<b>grassetto</b>', { timeout: 15_000 });
  expect(await attesa.locator('img, b').count()).toBe(0);
  await app.evaluate(() => globalThis.__aiuto.rilascia());
  await expect(aiuto.locator('.sn-sidebar-msg-assistant', { hasText: 'Ok.' })).toBeVisible();
});
