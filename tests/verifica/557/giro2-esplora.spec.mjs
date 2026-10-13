// Verifica #557 giro 2: le porte del turno finito senza risposta (tetto dei passi, ricerca fallita, ricarica, tema scuro).

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

test('Continua, poi la pagina ricaricata: il messaggio interno non diventa una bolla dell’utente', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await home(app);
  await configura(app);
  await modelloFinto(app, [cercaAnnunciata, { text: '' }, { text: 'Parte alle 8:15.' }]);
  await scrivi(page, 'a che ora parte il treno?');
  await expect(page.locator('.dash-continua')).toHaveCount(1, { timeout: 30_000 });
  await page.locator('.dash-continua').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Parte alle 8:15.' })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.dash-bubble-user', { hasText: '[L' })).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);
  console.log('DOPO RICARICA:', await page.locator('.dash-bubble').allInnerTexts());
  await expect(page.locator('.dash-bubble', { hasText: 'continuare il lavoro' })).toHaveCount(0);
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
