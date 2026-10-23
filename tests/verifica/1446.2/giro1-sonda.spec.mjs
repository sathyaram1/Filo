// Sonda: secondo messaggio mandato subito dopo il sì nel riquadro della lezione, a varie distanze e latenze.
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

const casi = [];
for (const testo of ['Te lo segno.', '']) for (const attesa of [0, 400, 1500]) for (const latenza of [0, 800]) casi.push({ testo, attesa, latenza });

for (const { testo, attesa, latenza } of casi) test(`sonda testo=${JSON.stringify(testo)} attesa=${attesa} latenza=${latenza}`, async ({ app, shell }) => {
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
  await app.evaluate(async (_e, { apreChat, testo, latenza }) => {
    globalThis.__t = [];
    let n = 0;
    const finto = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (!String(messages[0]?.content || '').startsWith(apreChat)) return { ...base, text: 'NULLA DA IMPARARE', toolCalls: [], finishReason: 'stop' };
      n += 1;
      globalThis.__t.push([n, Date.now()]);
      if (latenza) await new Promise((r) => setTimeout(r, latenza));
      if (n === 1) {
        try { if (testo) onDelta && onDelta(testo); } catch (_) {}
        return { ...base, text: testo, finishReason: 'tool_calls', toolCalls: [{ id: 'l1', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L\'utente è lo sviluppatore di Filo.' }) }] };
      }
      const last = [...messages].reverse().find((m) => m.role === 'user');
      const t = /chiedere conferma/.test(String(last?.content || '')) ? 'RISPOSTA ALLA SECONDA' : 'Me lo segno, se mi dai l\'OK.';
      try { onDelta && onDelta(t); } catch (_) {}
      return { ...base, text: t, toolCalls: [], finishReason: 'stop' };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
  }, { apreChat: APRE_CHAT, testo, latenza });

  await page.locator('#input').fill('ricordati che sviluppo Filo');
  await page.locator('#sendBtn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await scrollConfirmToEnd(page);
  await clickConfirm(page, 'ok');
  const t0 = Date.now();
  if (attesa) await page.waitForTimeout(attesa);
  const spunta = await page.locator('.dash-bubble-filo', { hasText: 'Ricordato' }).count();
  await page.locator('#input').fill('puoi non chiedere conferma per cosa tu debba ricordarti?');
  await page.locator('#sendBtn').click();
  let ok = true;
  try {
    await expect.poll(async () => {
      const bolle = await page.locator('.dash-bubble').evaluateAll((els) => els.map((b) => ({ u: b.classList.contains('dash-bubble-user'), t: b.textContent })));
      const ultima = bolle.map((b) => b.u).lastIndexOf(true);
      return bolle.slice(ultima + 1).map((b) => b.t).join('\n');
    }, { timeout: 15_000 }).toContain('RISPOSTA ALLA SECONDA');
  } catch (_) { ok = false; }
  const bolle = await page.locator('.dash-bubble').evaluateAll((els) => els.map((b) => `${b.classList.contains('dash-bubble-user') ? 'U' : 'F'}: ${b.textContent.slice(0, 70)}`));
  const tt = await app.evaluate(() => globalThis.__t);
  console.log(JSON.stringify({ testo, attesa, latenza, ok, spuntaPrimaDiScrivere: spunta, calls: tt.map(([k, t]) => [k, t - t0]), bolle }));
  expect(ok).toBe(true);
});
