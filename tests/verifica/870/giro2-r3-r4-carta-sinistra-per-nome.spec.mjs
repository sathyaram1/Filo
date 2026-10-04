// #870 giro 2, rilievi 3 e 4: chiesto a parole, la carta di sinistra si trova anche col solo nome («il backup»): la
// richiesta in corso non è una carta fra cui scegliere (r3). Se non si trova, Filo riceve l'elenco intero delle carte
// con le chiavi e la destra com'è davvero (r4).
import { test, expect } from '../../fixtures/electron.mjs';
import { homeTab } from './_comune.mjs';

async function modelloSpia(app, risposte) {
  await app.evaluate(async (_e, risp) => {
    const C = globalThis.SN_CONST;
    await chrome.storage.local.set({ filo_onboarding: { done: true } });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' }, modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__giro = 0;
    globalThis.__visti = [];
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      globalThis.__visti.push(JSON.stringify(messages));
      const r = risp[Math.min(globalThis.__giro++, risp.length - 1)];
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (r.testo) { try { onDelta && onDelta(r.testo); } catch (_) {} }
      return { ...base, text: r.testo || '', toolCalls: r.strumenti || [], finishReason: r.strumenti ? 'tool_calls' : 'stop' };
    };
  }, risposte);
}

// Quello che lo strumento ha risposto, così come lo legge il modello.
const esitoStrumento = (v) => JSON.parse(v || '[]').filter((m) => m.role === 'tool').map((m) => String(m.content)).join('\n');

test('r3: «togli il backup dalla home»: l’avviso del backup si chiude', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await homeTab(app);
  await app.evaluate(async () => { await globalThis.SN_FILO_MEMORY.addNotification({ kind: 'info', text: 'Il backup delle foto è finito.' }); });
  await modelloSpia(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: JSON.stringify({ operazione: 'togli', carta: 'backup' }) }] },
    { testo: 'Fatto.' },
  ]);
  await page.reload();
  await homeTab(app);
  await page.locator('#input').fill('togli il backup dalla home');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Fatto' })).toBeVisible({ timeout: 10_000 });
  const esito = esitoStrumento((await app.evaluate(() => globalThis.__visti))[1]);
  expect.soft(esito, 'la richiesta in corso compare fra le carte da scegliere').not.toContain('"lavoro');
  await expect(page.locator('#accade .dash-carta[data-tipo="avviso"]')).toHaveCount(0);
});

test('r4: carta non trovata: l’esito porta tutte le carte di sinistra con la chiave, e la destra vera', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await homeTab(app);
  await page.locator('#tieni .dash-carta[data-tipo="mazzi"]').click({ button: 'right' });
  await page.locator('.dash-menu .dash-menu-voce', { hasText: 'Togli' }).click();
  await expect(page.locator('#tieni .dash-carta[data-tipo="mazzi"]')).toHaveCount(0);
  await app.evaluate(async () => {
    const M = globalThis.SN_FILO_MEMORY;
    await M.addNotification({ kind: 'info', text: 'Il backup delle foto è finito: 1.240 foto copiate sul disco esterno.' });
    await M.addNotification({ kind: 'info', text: 'La lavatrice ha finito il programma cotone.' });
    await M.addTimer({ label: 'Pasta', seconds: 600 });
  });
  await modelloSpia(app, [
    { strumenti: [{ id: 'c1', name: 'CARTA_HOME', arguments: JSON.stringify({ operazione: 'togli', carta: 'l’avviso del bucato' }) }] },
    { testo: 'Quale?' },
  ]);
  await page.reload();
  await homeTab(app);
  await page.locator('#input').fill('togli l’avviso del bucato');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Quale' })).toBeVisible({ timeout: 10_000 });
  const esito = esitoStrumento((await app.evaluate(() => globalThis.__visti))[1]);
  for (const k of await page.locator('#accade > .dash-carta').evaluateAll((ns) => ns.map((n) => n.dataset.chiave))) {
    expect.soft(esito, `l’esito non porta la chiave ${k}`).toContain(k);
  }
  expect.soft(esito, 'l’esito non descrive la colonna di destra').toMatch(/destra/);
  expect.soft(esito, 'l’esito mette i Mazzi a destra, ma l’utente li ha tolti').not.toMatch(/destra[^\]]*Mazzi/);
});
