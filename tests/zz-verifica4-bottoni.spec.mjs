// VERIFICA indipendente (temporaneo): i bottoni delle azioni in chat.
import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function setup(app, script) {
  await app.evaluate(async (electron, arg) => {
    await globalThis.SN_STORAGE.updateSettings({
      provider: 'openrouter', apiKeys: { openrouter: 'k-test' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const Onb = globalThis.SN_ONBOARDING;
    if (Onb) await globalThis.SN_FILO_MEMORY.setOnboarding(Onb.close(Onb.emptyState()));
    globalThis.__v = { i: 0, script: arg.script };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ tools, onDelta, onToolCall }) => {
      if (!Array.isArray(tools) || !tools.length) {
        return { text: '{"text":""}', toolCalls: [], reasoningDetails: [], usage: {}, provider: 'openrouter', model: 'finto' };
      }
      const V = globalThis.__v;
      const step = V.script[V.i] || V.script[V.script.length - 1];
      V.i += 1;
      if (step.text && onDelta) onDelta(step.text);
      const calls = (step.toolCalls || []).map((c) => ({ ...c }));
      if (onToolCall) for (const c of calls) onToolCall(c);
      return { text: step.text || '', toolCalls: calls, reasoningDetails: [], usage: {}, provider: 'openrouter', model: 'finto' };
    };
  }, { script });
}

test('chiedo un colore: resta il controllo per aggiustare la tinta?', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'e1', name: 'IMPOSTA_ESTETICA', arguments: JSON.stringify({ token: 'accent', valore: '#3366cc' }) }] },
    { text: 'Accento blu.' },
  ]);
  await page.locator('#input').fill("metti l'accento blu");
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Accento blu', { timeout: 20_000 });
  const vista = await page.evaluate(() => ({
    righe: Array.from(document.querySelectorAll('.dash-activity-row')).map((r) => r.textContent),
    bottoni: Array.from(document.querySelectorAll('.dash-bubble-actions button, .dash-bubble-actions a, .sn-refine-trigger')).map((b) => b.textContent),
  }));
  console.log('ESTETICA', JSON.stringify(vista));
  expect(vista.bottoni.length, 'controllo per raffinare il colore').toBeGreaterThan(0);
});

test('chiedo un evento di calendario: resta il bottone per aggiungerlo?', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 10_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await setup(app, [
    { toolCalls: [{ id: 'k1', name: 'EVENTO_CALENDARIO', arguments: JSON.stringify({ data: '2026-09-20', ora: '18:00', titolo: 'Dentista' }) }] },
    { text: 'Ecco l\'evento.' },
  ]);
  await page.locator('#input').fill('segna il dentista il 20 settembre alle 18');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo').last()).toContainText('Ecco', { timeout: 20_000 });
  const vista = await page.evaluate(() => ({
    righe: Array.from(document.querySelectorAll('.dash-activity-row')).map((r) => r.textContent),
    bottoni: Array.from(document.querySelectorAll('.dash-bubble-actions button, .dash-bubble-actions a')).map((b) => b.textContent),
  }));
  console.log('CALENDARIO', JSON.stringify(vista));
  expect(vista.bottoni.length, 'bottone per aggiungere l\'evento').toBeGreaterThan(0);
});
