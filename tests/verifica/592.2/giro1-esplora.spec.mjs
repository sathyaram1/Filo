// Esplorazione della verifica #592.2, giro 1: lo stile del benvenuto con «Userò questo stile» e Annulla.
import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState } from '../../helpers/confirm.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function prepara(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: {
        [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_LESSON]: 'deepseek-flash',
        [C.ACTIONS.FILO_COMPACT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash',
      },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    globalThis.__chatReplies = [];
    const reply = (messages) => {
      const all = JSON.stringify(messages || []);
      if (all.includes('integrare le nuove lezioni')) return 'PROFILO:\nAnna.\n\nPREFERENZE:\nBreve.';
      if (all.includes('analizzare l')) return 'LEZIONE: niente.';
      if (all.includes('preparare la dashboard')) return JSON.stringify({ message: 'Ciao.', suggestions: [] });
      return globalThis.__chatReplies.shift() || JSON.stringify({ text: 'Dimmi pure.', actions: [] });
    };
    P.streamCompleteWithFallback = async ({ attempts, messages, onDelta }) => {
      const text = reply(messages);
      try { onDelta && onDelta(text); } catch (_) {}
      return { text, model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    P.completeWithFallback = async ({ attempts, messages }) => ({ text: reply(messages), model: attempts[0].model, provider: attempts[0].provider, usage: {} });
  });
}

const queueChat = (app, ...replies) => app.evaluate((_e, rs) => { globalThis.__chatReplies.push(...rs); }, replies.map((r) => JSON.stringify(r)));
const stileSalvato = (app) => app.evaluate(() => globalThis.SN_STORAGE.getSettings().then((s) => s.agentStyle || ''));
const risposta = (stile) => ({ text: 'Va bene, ti scrivo così.', actions: [{ type: 'IMPOSTA_PREFERENZA', chiave: 'stile_agente', valore: stile }] });

async function apri(app, shell) {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await prepara(app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('body')).toHaveAttribute('data-state', 'thread', { timeout: 15_000 });
  return page;
}

async function manda(page, testo) {
  await page.locator('#input').fill(testo);
  await page.locator('#sendBtn').click();
}

test('Annulla rimette lo stile che c’era prima, non lo svuota', async ({ app, shell }) => {
  test.setTimeout(120_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ agentStyle: 'Scrivi formale, dai del lei.' }));
  const page = await apri(app, shell);
  await queueChat(app, risposta('Risposte brevi, dà del tu.'));
  await manda(page, 'scrivimi breve e dammi del tu');
  const riga = page.locator('.dash-stile-accoglienza');
  await expect(riga).toContainText('Userò questo stile', { timeout: 30_000 });
  await expect.poll(() => stileSalvato(app)).toBe('Risposte brevi, dà del tu.');
  await riga.getByRole('button', { name: 'Annulla' }).click();
  await expect(riga).toContainText('Stile annullato');
  await expect.poll(() => stileSalvato(app), { timeout: 10_000 }).toBe('Scrivi formale, dai del lei.');
});

test('due stili di fila: Annulla sul primo, poi sul secondo', async ({ app, shell }) => {
  test.setTimeout(150_000);
  const page = await apri(app, shell);
  await queueChat(app, risposta('Breve.'));
  await manda(page, 'scrivimi breve');
  await expect(page.locator('.dash-stile-accoglienza').first()).toContainText('«Breve.»', { timeout: 30_000 });
  await queueChat(app, risposta('Breve e con le emoji 🎉.'));
  await manda(page, 'anzi metti anche le emoji');
  await expect(page.locator('.dash-stile-accoglienza')).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(() => stileSalvato(app)).toBe('Breve e con le emoji 🎉.');
  await page.locator('.dash-stile-accoglienza').nth(1).getByRole('button', { name: 'Annulla' }).click();
  await expect.poll(() => stileSalvato(app), { timeout: 10_000 }).toBe('Breve.');
  console.log('dopo secondo annulla, primo bottone visibile:', await page.locator('.dash-stile-accoglienza').first().getByRole('button').isVisible());
  await page.locator('.dash-stile-accoglienza').first().getByRole('button', { name: 'Annulla' }).click();
  await expect.poll(() => stileSalvato(app), { timeout: 10_000 }).toBe('');
});

test('stile con markup e lunghissimo: si legge come testo; foto chiaro e scuro', async ({ app, shell }) => {
  test.setTimeout(150_000);
  const page = await apri(app, shell);
  const lungo = '<b>grassetto</b><img src=x onerror="window.__xss=1"> ' + 'Rispondi sempre in modo molto dettagliato e cordiale. '.repeat(20);
  await queueChat(app, risposta(lungo));
  await manda(page, 'scrivimi così');
  const riga = page.locator('.dash-stile-accoglienza');
  await expect(riga).toContainText('<b>grassetto</b>', { timeout: 30_000 });
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  console.log('stile salvato lungo:', (await stileSalvato(app)).length, 'atteso', lungo.trim().length);
  console.log('confirm presente:', await page.locator(CONFIRM_HOST).count(), JSON.stringify(await confirmState(page)).slice(0, 200));
  const box = await riga.boundingBox();
  const vw = await page.evaluate(() => document.documentElement.clientWidth);
  console.log('riga box', JSON.stringify(box), 'vw', vw);
  await page.screenshot({ path: 'tests/.shots/592.2-stile-chiaro.png' });
  await page.evaluate((m) => new Promise((ok) => chrome.runtime.sendMessage({ type: m, settings: { theme: 'dark' } }, ok)), await page.evaluate(() => globalThis.SN_MSG?.MSG?.UPDATE_SETTINGS || 'update_settings'));
  await page.waitForTimeout(800);
  await riga.getByRole('button', { name: 'Annulla' }).hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'tests/.shots/592.2-stile-scuro.png' });
});

test('la riga con Annulla dopo un ricaricamento della home', async ({ app, shell }) => {
  test.setTimeout(120_000);
  const page = await apri(app, shell);
  await queueChat(app, risposta('Breve.'));
  await manda(page, 'scrivimi breve');
  await expect(page.locator('.dash-stile-accoglienza')).toContainText('«Breve.»', { timeout: 30_000 });
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'ti scrivo così' })).toBeVisible({ timeout: 15_000 });
  console.log('righe stile dopo reload:', await page.locator('.dash-stile-accoglienza').count());
  console.log('testi bolle:', JSON.stringify(await page.locator('.dash-bubble-filo').allInnerTexts()));
});
