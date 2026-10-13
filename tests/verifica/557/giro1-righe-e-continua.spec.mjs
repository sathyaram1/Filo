// Verifica #557 giro 1: porte provate e chiuse (righe delle preferenze in parole, Continua ripetuto).

import { test, expect } from '../../fixtures/electron.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { aspettaConfermaPronta } from '../../helpers/confirm.mjs';

async function home(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const w = app.windows().find((x) => x.url().startsWith('filo://newtab') && !x.url().includes('incognito'));
    if (w) { await w.waitForLoadState('domcontentloaded'); return w; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('home non trovata');
}

async function configura(app, extra = {}) {
  await app.evaluate(async (_e, ex) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
      theme: 'light',
      ...ex,
    });
  }, extra);
}

// `giri`: un elemento per chiamata al modello; l'ultimo si ripete.
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    const origWS = globalThis.SN_WEB_SEARCH;
    globalThis.__v557_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; globalThis.SN_WEB_SEARCH = origWS; };
    globalThis.SN_WEB_SEARCH = { search: async ({ query }) => ({ provider: 'finto', results: [{ title: `Risultato ${query}`, url: 'https://example.com/', snippet: 'testo' }] }) };
    globalThis.__v557_n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(globalThis.__v557_n, g.length - 1)];
      globalThis.__v557_n += 1;
      const calls = (giro.toolCalls || []).map((c, i) => ({ ...c, id: `${c.id || 'x'}${globalThis.__v557_n}_${i}` }));
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__v557_restore?.(); } catch (_) {} });

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('impostazione confermata con OK: la riga parla coi nomi delle Preferenze', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await configura(app);
  await livelloAutonomia(app, 'conservativo');
  await modelloFinto(app, [
    { toolCalls: [{ id: 'p', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"blocco_popup","valore":"no"}' }] },
    { text: 'Ti chiedo conferma.' },
  ]);
  await scrivi(page, 'non bloccare i popup');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ti chiedo conferma.' })).toBeVisible({ timeout: 15_000 });
  await aspettaConfermaPronta(page);
  await page.evaluate(() => window.SN_CONFIRM_UI._test.scrollToEnd()).catch(() => {});
  await page.evaluate(() => window.SN_CONFIRM_UI._test.fill('conferma'));
  const cliccato = await page.evaluate(() => window.SN_CONFIRM_UI._test.click('ok') || window.SN_CONFIRM_UI._test.click('danger'));
  expect(cliccato).toBe(true);
  await expect.poll(async () => (await app.evaluate(async () => globalThis.SN_STORAGE.getSettings())).security.blockPopups).toBe(false);
  await page.locator('.dash-activity-head').first().click();
  const righe = page.locator('.dash-activity-row');
  await expect(righe.filter({ hasText: 'blocco dei popup' })).not.toHaveCount(0);
  await expect(righe.filter({ hasText: '=' })).toHaveCount(0);
  await expect(righe.filter({ hasText: 'blockPopups' })).toHaveCount(0);
  await expect(righe.filter({ hasText: 'Già così' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/v557-confermata.png' });
  await ripristina(app);
});

test('dimensione del testo e un valore non valido: righe leggibili, mai la chiave interna', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [
      { id: 'a', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"dimensione_testo","valore":"grande"}' },
      { id: 'b', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"fucsia a pois"}' },
      { id: 'c', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"chiave_inventata","valore":"sì"}' },
    ] },
    { text: 'Fatto quel che potevo.' },
  ]);
  await scrivi(page, 'testo grande e tema fucsia');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto quel che potevo.' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.dash-activity-head').first().click();
  const righe = page.locator('.dash-activity-row');
  await expect(righe.filter({ hasText: 'dimensione del testo' })).toHaveCount(1);
  await expect(righe.filter({ hasText: '=' })).toHaveCount(0);
  await expect(righe.filter({ hasText: 'textScale' })).toHaveCount(0);
  await expect(righe.filter({ hasText: 'dimensione_testo' })).toHaveCount(0);
  console.log('RIGHE:', await righe.allInnerTexts());
  await page.screenshot({ path: 'tests/.shots/v557-righe.png' });
  await ripristina(app);
});

test('Continua che si ferma di nuovo: una bolla nuova con un solo Continua', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await configura(app);
  const cerca = { toolCalls: [{ id: 'w', name: 'CERCA_WEB', arguments: '{"query":"treni"}' }] };
  await modelloFinto(app, [cerca, cerca, { text: '' }, cerca, { text: '' }, { text: 'Parte alle 8:15.' }]);
  await scrivi(page, 'a che ora parte il treno?');
  const tasto = page.locator('.dash-continua');
  await expect(tasto).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Mi sono fermato dopo 2 passi' })).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/v557-continua-scuro.png' });
  await tasto.click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Mi sono fermato dopo un passo' })).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator('.dash-continua')).toHaveCount(1);
  await page.screenshot({ path: 'tests/.shots/v557-continua-due-volte.png' });
  await page.locator('.dash-continua').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Parte alle 8:15.' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.dash-continua')).toHaveCount(0);
  await ripristina(app);
});
