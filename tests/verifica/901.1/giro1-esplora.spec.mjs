// Esplorazione #901.1: la conferma di una lezione data mentre il modello sta ancora rileggendo l'esito «in attesa».
import { test, expect } from '../../fixtures/electron.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, CONFIRM_HOST, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

const NEWTAB = 'filo://newtab/';
const APRE_CHAT = 'Sei Filo, un assistente personale. L\'utente interagisce';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith(NEWTAB));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

for (const ritardo of [0, 2500]) test(`conferma data subito, seconda chiamata in ritardo di ${ritardo} ms: la seconda domanda ha la sua risposta`, async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await livelloAutonomia(app, 'conservativo');
  await app.evaluate(async (_e, { apreChat, ritardo }) => {
    globalThis.__calls = [];
    const finto = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (!String(messages[0]?.content || '').startsWith(apreChat)) return { ...base, text: 'NULLA DA IMPARARE', toolCalls: [], finishReason: 'stop' };
      const n = globalThis.__calls.push(1);
      if (n === 1) {
        try { onDelta && onDelta('Te lo segno.'); } catch (_) {}
        return { ...base, text: 'Te lo segno.', finishReason: 'tool_calls', toolCalls: [{ id: 'l1', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L\'utente è lo sviluppatore di Filo.' }) }] };
      }
      if (n === 2) await new Promise((r) => setTimeout(r, ritardo));
      const t = n === 2 ? 'Me lo segno, se mi dai l\'OK.' : `Risposta ${n}.`;
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
  }, { apreChat: APRE_CHAT, ritardo });

  await page.locator('#input').fill('ricordati che sviluppo Filo');
  await page.locator('#sendBtn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#input').fill('puoi non chiedere conferma per cosa tu debba ricordarti?');
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta 3.' })).toBeVisible({ timeout: 15_000 });
  const testi = await page.locator('.dash-bubble-filo').allInnerTexts();
  await page.screenshot({ path: `tests/.shots/901.1-ritardo${ritardo}.png` });
  expect(testi.join('\n')).toContain('Me lo segno');
});
