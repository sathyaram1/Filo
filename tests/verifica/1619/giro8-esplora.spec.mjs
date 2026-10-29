// Esplorazione del giro 8 di #1619: ripristino dalla chat su dati dell'utente, annullo nel riquadro, già di serie.

import { test, expect } from '../../fixtures/electron.mjs';
import { clickConfirm, confirmState, fillConfirmInput, scrollConfirmToEnd, CONFIRM_HOST } from '../../helpers/confirm.mjs';

async function trovaPagina(app, prova, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const p = app.windows().find((w) => { try { return prova(w.url()); } catch (_) { return false; } });
    if (p) { await p.waitForLoadState('domcontentloaded'); return p; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pagina non trovata');
}
const homeDi = (app) => trovaPagina(app, (u) => u.startsWith('filo://newtab') && !u.includes('incognito') && !u.includes('accoglienza'));

async function configura(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
}
async function modelloFinto(app, giri) {
  await app.evaluate(async (_e, g) => {
    const orig = globalThis.SN_PROVIDERS.streamCompleteWithFallback;
    globalThis.__pp_restore = () => { globalThis.SN_PROVIDERS.streamCompleteWithFallback = orig; };
    globalThis.__pp_tool = [];
    let n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta, onToolCall }) => {
      const giro = g[Math.min(n, g.length - 1)];
      n += 1;
      const ultimo = [...messages].reverse().find((m) => m.role === 'tool');
      if (ultimo) globalThis.__pp_tool.push(String(ultimo.content || ''));
      const calls = giro.toolCalls || [];
      for (const c of calls) { try { onToolCall && onToolCall({ id: c.id, name: c.name }); } catch (_) {} }
      if (giro.text) { try { onDelta && onDelta(giro.text); } catch (_) {} }
      return {
        model: attempts[0].model, provider: attempts[0].provider, usage: {},
        text: giro.text || '', toolCalls: calls, reasoningDetails: [], finishReason: calls.length ? 'tool_calls' : 'stop',
      };
    };
  }, giri);
}
const ripristina = (app) => app.evaluate(() => { try { globalThis.__pp_restore?.(); } catch (_) {} });
const premi = (pulsante, text = '', extra = {}, id = 'p1') => ({
  text, toolCalls: [{ id, name: 'PULSANTE_PREFERENZE', arguments: JSON.stringify({ pulsante, ...extra }) }],
});
const impostazioni = (app) => app.evaluate(async () => globalThis.SN_STORAGE.getSettings());
async function scrivi(page, testo) {
  await page.bringToFront();
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('esplora: ripristino su stile, tetto di spesa, cartelle e scorciatoie, poi annullo dal segno', async ({ app, shell }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  const id = await app.evaluate(() => globalThis.SN_TASTI.AZIONI_FILO[0].id);
  await app.evaluate(async (_e, sid) => {
    const P = globalThis.SN_PREF;
    const b = P.buildPreferencePartial('scorciatoia', `${sid} Ctrl+Shift+Y`);
    globalThis.__sc = b;
    await globalThis.SN_STORAGE.updateSettings({
      theme: 'dark', agentStyle: { text: 'Scrivi come un pirata' }, monthlyLimitEur: 3,
      ...(b && b.partial ? b.partial : {}),
    });
  }, id);
  const prima = await impostazioni(app);
  console.log('SC', JSON.stringify(await app.evaluate(() => globalThis.__sc)), JSON.stringify(prima.scorciatoie), JSON.stringify(prima.agentStyle), prima.monthlyLimitEur);

  await modelloFinto(app, [premi('ripristina_tutto', 'Ti chiedo conferma.'), { text: 'Fatto.' }]);
  await scrivi(chat, 'rimetti tutte le impostazioni di serie');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 10_000 }).toContain('tema: scuro');
  const testo = (await confirmState(chat)).text;
  console.log('BOX', testo);
  await chat.screenshot({ path: 'tests/.shots/g8-box.png' });
  await fillConfirmInput(chat, 'conferma');
  await scrollConfirmToEnd(chat);
  await clickConfirm(chat, 'danger');
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('system');
  const dopo = await impostazioni(app);
  console.log('DOPO', JSON.stringify(dopo.scorciatoie), JSON.stringify(dopo.agentStyle), dopo.monthlyLimitEur);
  await expect.poll(() => app.evaluate(() => globalThis.__pp_tool), { timeout: 8_000 }).toHaveLength(1);
  console.log('TOOL', await app.evaluate(() => globalThis.__pp_tool));
  await chat.screenshot({ path: 'tests/.shots/g8-dopo.png' });

  const bolla = chat.locator('.dash-bubble-user', { hasText: 'rimetti tutte le impostazioni di serie' });
  const segno = bolla.locator('.dash-cambi-segno');
  await expect(segno).toBeVisible({ timeout: 5_000 });
  await segno.hover();
  const pop = bolla.locator('.dash-cambi-pop');
  console.log('POP', await pop.innerText());
  await chat.screenshot({ path: 'tests/.shots/g8-pop.png' });
  await pop.locator('.dash-cambi-annulla').click();
  await expect.poll(async () => (await impostazioni(app)).theme, { timeout: 5_000 }).toBe('dark');
  const rimesse = await impostazioni(app);
  console.log('RIMESSE', JSON.stringify(rimesse.scorciatoie), JSON.stringify(rimesse.agentStyle), rimesse.monthlyLimitEur);
  expect(rimesse.agentStyle).toEqual(prima.agentStyle);
  expect(rimesse.monthlyLimitEur).toEqual(prima.monthlyLimitEur);
  expect(rimesse.scorciatoie).toEqual(prima.scorciatoie);
  await ripristina(app);
});

test('esplora: «Annulla» nel riquadro del ripristino non cambia niente e il modello lo sa', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await app.evaluate(async () => globalThis.SN_STORAGE.updateSettings({ theme: 'dark' }));
  await modelloFinto(app, [premi('ripristina_tutto', 'Ti chiedo conferma.'), { text: 'Va bene.' }]);
  await scrivi(chat, 'rimetti tutte le impostazioni di serie');
  await expect.poll(async () => (await confirmState(chat))?.text || '', { timeout: 10_000 }).toContain('tema: scuro');
  await clickConfirm(chat, 'cancel');
  await expect(chat.locator(CONFIRM_HOST)).toBeHidden({ timeout: 5_000 });
  await new Promise((r) => setTimeout(r, 1500));
  expect((await impostazioni(app)).theme).toBe('dark');
  console.log('TOOL-ANNULLA', await app.evaluate(() => globalThis.__pp_tool));
  await chat.screenshot({ path: 'tests/.shots/g8-annulla.png' });
  await ripristina(app);
});

test('esplora: già tutto di serie, e un tono che non esiste', async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const chat = await homeDi(app);
  await configura(app);
  await modelloFinto(app, [premi('ripristina_aspetto', ''), premi('prova_suoneria', '', { tono: '<b>pippo</b>' }, 'p2'), { text: 'Ok.' }]);
  await scrivi(chat, 'rimetti l\'aspetto di serie e fammi sentire la suoneria pippo');
  await expect(chat.locator('.dash-bubble-filo', { hasText: 'Ok.' })).toBeVisible({ timeout: 15_000 });
  console.log('TOOL-GIA', await app.evaluate(() => globalThis.__pp_tool));
  await chat.screenshot({ path: 'tests/.shots/g8-gia.png' });
  await ripristina(app);
});
