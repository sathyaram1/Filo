// Verifica #557 giro 2: le porte del turno finito senza risposta (tetto dei passi, ricerca fallita, tema scuro, righe).

import { test, expect } from '../../fixtures/electron.mjs';

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

// `giri`: un elemento per chiamata; l'ultimo si ripete. `ricercaRotta`: la ricerca sul web fallisce.
async function modelloFinto(app, giri, { ricercaRotta = false } = {}) {
  await app.evaluate(async (_e, { g, rotta }) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    const origWS = globalThis.SN_WEB_SEARCH;
    globalThis.__v557b_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; globalThis.SN_WEB_SEARCH = origWS; };
    globalThis.SN_WEB_SEARCH = { search: async ({ query }) => {
      if (rotta) throw new Error('rete giù');
      return { provider: 'finto', results: [{ title: `Risultato ${query}`, url: 'https://example.com/', snippet: 'testo' }] };
    } };
    globalThis.__v557b_n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta, onToolCall }) => {
      const giro = g[Math.min(globalThis.__v557b_n, g.length - 1)];
      globalThis.__v557b_n += 1;
      const calls = (giro.toolCalls || []).map((c, i) => ({ ...c, id: `${c.id || 'x'}${globalThis.__v557b_n}_${i}` }));
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, { g: giri, rotta: ricercaRotta });
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__v557b_restore?.(); } catch (_) {} });

async function scrivi(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

const cercaAnnunciata = { text: 'Cerco ancora gli orari…', toolCalls: [{ id: 'w', name: 'CERCA_WEB', arguments: '{"query":"treni"}' }] };

test('tetto dei passi con frasi di lavoro, tema scuro: una bolla che dice che si è fermato e un Continua', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await configura(app, { theme: 'dark' });
  await modelloFinto(app, [cercaAnnunciata]);
  await scrivi(page, 'a che ora parte il treno?');
  const fermo = page.locator('.dash-bubble-filo', { hasText: 'Mi sono fermato dopo' });
  await expect(fermo).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('.dash-continua')).toHaveCount(1);
  console.log('BOLLE:', await page.locator('.dash-bubble-filo').allInnerTexts());
  console.log('TESTA:', await page.locator('.dash-activity-head').allInnerTexts());
  await app.evaluate((_e) => globalThis.SN_HANDLE_MESSAGE({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: 'dark' } }, { tab: { url: 'filo://preferences/' }, url: 'filo://preferences/' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'tests/.shots/v557g2-tetto-scuro.png' });
  await ripristina(app);
});

test('ricerca fallita e poi silenzio: anche qui Continua', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await configura(app);
  await modelloFinto(app, [cercaAnnunciata, { text: '   ' }], { ricercaRotta: true });
  await scrivi(page, 'a che ora parte il treno?');
  await expect(page.locator('.dash-continua')).toHaveCount(1, { timeout: 30_000 });
  console.log('BOLLE:', await page.locator('.dash-bubble-filo').allInnerTexts());
  await ripristina(app);
});

test('Continua lasciato lì e un messaggio nuovo: il tasto sparisce', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await configura(app);
  await modelloFinto(app, [cercaAnnunciata, { text: '' }, { text: 'Ciao!' }]);
  await scrivi(page, 'a che ora parte il treno?');
  await expect(page.locator('.dash-continua')).toHaveCount(1, { timeout: 30_000 });
  await scrivi(page, 'lascia stare, ciao');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Ciao!' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.dash-continua')).toHaveCount(0);
  await ripristina(app);
});

test('righe delle preferenze: tema, valore storto su una chiave con trattino basso, blocco popup', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await configura(app);
  await modelloFinto(app, [
    { toolCalls: [
      { id: 'a', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"scuro"}' },
      { id: 'b', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"dimensione_testo","valore":"fucsia"}' },
      { id: 'c', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"commento_home","valore":"forse"}' },
      { id: 'd', name: 'IMPOSTA_PREFERENZA', arguments: '{"chiave":"tema","valore":"<b>x</b>"}' },
    ] },
    { text: 'Fatto.' },
  ]);
  await scrivi(page, 'metti il tema scuro');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto.' })).toBeVisible({ timeout: 15_000 });
  await page.locator('.dash-activity-head').first().click();
  const righe = page.locator('.dash-activity-row');
  console.log('RIGHE:', await righe.allInnerTexts());
  await expect(righe.filter({ hasText: '_' })).toHaveCount(0);
  await expect(righe.filter({ hasText: '=' })).toHaveCount(0);
  await page.screenshot({ path: 'tests/.shots/v557g2-righe.png' });
  await ripristina(app);
});
