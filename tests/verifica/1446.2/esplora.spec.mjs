// Esplorazione: messaggio scritto subito dopo il sì nel riquadro della lezione, a diverse distanze.
import { test, expect } from '../../fixtures/electron.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { aspettaConfermaPronta, mouseClickConfirm, CONFIRM_HOST, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

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

for (const testo of ['']) for (const attesa of [0]) test(`esplora testo=${JSON.stringify(testo)} attesa=${attesa}`, async ({ app, shell }) => {
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
  await app.evaluate(async (_e, { apreChat, testo }) => {
    globalThis.__calls = [];
    globalThis.__t = [];
    const finto = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (!String(messages[0]?.content || '').startsWith(apreChat)) return { ...base, text: 'NULLA DA IMPARARE', toolCalls: [], finishReason: 'stop' };
      const n = globalThis.__calls.push(messages.length);
      globalThis.__t.push([n, Date.now()]);
      if (n === 1) {
        try { if (testo) onDelta && onDelta(testo); } catch (_) {}
        return { ...base, text: testo, finishReason: 'tool_calls', toolCalls: [{ id: 'l1', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L\'utente è lo sviluppatore di Filo.' }) }] };
      }
      await new Promise((r) => setTimeout(r, 2500));
      const last = [...messages].reverse().find((m) => m.role === 'user');
      const t = /conferma/.test(String(last?.content || '')) ? 'RISPOSTA ALLA SECONDA' : `risposta n${n}`;
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
  }, { apreChat: APRE_CHAT, testo });

  await page.locator('#input').fill('ricordati che sviluppo Filo');
  await page.locator('#sendBtn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await scrollConfirmToEnd(page);
  const t0 = Date.now();
  await aspettaConfermaPronta(page);
  if (attesa) await page.waitForTimeout(attesa);
  const tSend = Date.now();
  await page.locator('#input').click();
  await page.keyboard.type('puoi non chiedere conferma?');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(9000);
  const popup = await page.locator(CONFIRM_HOST).count();
  const mem = await app.evaluate(async () => JSON.stringify(await globalThis.SN_FILO_MEMORY.getMemory()).includes('sviluppatore'));
  console.log('POPUP', popup, 'MEM', mem);
  const bolle = await page.locator('.dash-bubble').evaluateAll((els) => els.map((b) => `${b.classList.contains('dash-bubble-user') ? 'U' : 'F'}: ${b.textContent.slice(0, 80)}`));
  const tt = await app.evaluate(() => globalThis.__t);
  console.log(JSON.stringify({ testo, attesa, sendAfterClick: tSend - t0, calls: tt.map(([n, t]) => [n, t - t0]), bolle }, null, 1));
  const ultima = bolle.map((b) => b.startsWith('U')).lastIndexOf(true);
  expect(bolle.slice(ultima + 1).join('\n')).toContain('RISPOSTA ALLA SECONDA');
});
