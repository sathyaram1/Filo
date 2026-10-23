// Verifica #1273.5 giro 1: dopo il popup di una lezione (sì o no, clic vero, invio subito) la risposta dopo compare in chat.
import { test, expect } from '../../fixtures/electron.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { CONFIRM_HOST, aspettaConfermaPronta, clickConfirm, mouseClickConfirm, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

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

async function prepara(app, testoDelGiro) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
  });
  await livelloAutonomia(app, 'conservativo');
  await app.evaluate(async (_e, { apreChat, testoDelGiro }) => {
    globalThis.__n = 0;
    const finto = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (!String(messages[0]?.content || '').startsWith(apreChat)) return { ...base, text: 'NULLA DA IMPARARE', toolCalls: [], finishReason: 'stop' };
      const n = ++globalThis.__n;
      if (n === 1) {
        try { if (testoDelGiro) onDelta && onDelta(testoDelGiro); } catch (_) {}
        return { ...base, text: testoDelGiro, finishReason: 'tool_calls', toolCalls: [{ id: 'l1', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L\'utente ama il tè.' }) }] };
      }
      const t = n === 2 && testoDelGiro ? 'Aspetto il tuo OK.' : `Risposta ${n}.`;
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
  }, { apreChat: APRE_CHAT, testoDelGiro });
}

for (const [nome, { testo, scelta, vero }] of Object.entries({
  'lezione rifiutata, turno chiuso sul popup': { testo: '', scelta: 'cancel', vero: false },
  'lezione rifiutata con testo': { testo: 'Te lo segno.', scelta: 'cancel', vero: false },
  'lezione confermata col clic vero, invio subito': { testo: '', scelta: 'ok', vero: true },
})) test(nome, async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await prepara(app, testo);
  await page.locator('#input').fill('ricordati che amo il tè');
  await page.locator('#sendBtn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await scrollConfirmToEnd(page);
  if (vero) { await aspettaConfermaPronta(page); await mouseClickConfirm(page, scelta); } else await clickConfirm(page, scelta);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('#sendBtn')).toBeEnabled({ timeout: 15_000 });
  await page.locator('#input').fill('e adesso?');
  await page.locator('#sendBtn').click();
  const atteso = `Risposta ${testo ? 3 : 2}.`;
  await expect(page.locator('.dash-bubble-filo', { hasText: atteso })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: `tests/.shots/1273.5-${scelta}-${testo ? 't' : 'v'}.png` });
});
