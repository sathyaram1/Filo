// Verifica #1337.3, giro 1: dopo l'OK a una cosa da ricordare, il messaggio dopo riceve la sua risposta anche
// quando il modello è lento, quando l'OK arriva prima della frase del turno, e dopo un rifiuto.
import { test, expect } from '../../fixtures/electron.mjs';
import { livelloAutonomia } from '../../helpers/autonomia.mjs';
import { clickConfirm, CONFIRM_HOST, scrollConfirmToEnd } from '../../helpers/confirm.mjs';

const NEWTAB = 'filo://newtab/';
const APRE_CHAT = 'Sei Filo, un assistente personale. L\'utente interagisce';
const DOMANDA = 'puoi non chiedere conferma per cosa tu debba ricordarti?';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const win = app.windows().find((w) => w.url().startsWith(NEWTAB));
    if (win) { await win.waitForLoadState('domcontentloaded'); return win; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('newtab non trovata');
}

async function prepara(app, { testo, ritardoEsito }) {
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
  await app.evaluate(async (_e, { apreChat, testo, domanda, ritardoEsito }) => {
    globalThis.__calls = [];
    const finto = async ({ attempts, messages, onDelta }) => {
      const base = { model: attempts[0].model, provider: attempts[0].provider, usage: {}, reasoningDetails: [] };
      if (!String(messages[0]?.content || '').startsWith(apreChat)) {
        return { ...base, text: 'NULLA DA IMPARARE', toolCalls: [], finishReason: 'stop' };
      }
      globalThis.__calls.push(JSON.parse(JSON.stringify(messages)));
      const c = (m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
      const ultimoUtente = [...messages].reverse().find((m) => m.role === 'user');
      if (ultimoUtente && c(ultimoUtente).includes(domanda)) {
        try { onDelta && onDelta('Va bene.'); } catch (_) {}
        return { ...base, text: 'Va bene.', toolCalls: [], finishReason: 'stop' };
      }
      if (messages.some((m) => m.role === 'tool' && m.tool_call_id === 'l1')) {
        await new Promise((r) => setTimeout(r, ritardoEsito));
        try { onDelta && onDelta('Me lo segno, se mi dai l\'OK.'); } catch (_) {}
        return { ...base, text: 'Me lo segno, se mi dai l\'OK.', toolCalls: [], finishReason: 'stop' };
      }
      try { if (testo) onDelta && onDelta(testo); } catch (_) {}
      return {
        ...base, text: testo, finishReason: 'tool_calls',
        toolCalls: [{ id: 'l1', name: 'SALVA_LEZIONE', arguments: JSON.stringify({ testo: 'L\'utente è lo sviluppatore di Filo.' }) }],
      };
    };
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
  }, { apreChat: APRE_CHAT, testo, domanda: DOMANDA, ritardoEsito });
}

async function sottoUltimoUtente(page) {
  const bolle = await page.locator('.dash-bubble').evaluateAll((els) => els.map((b) => ({
    utente: b.classList.contains('dash-bubble-user'), testo: b.textContent,
  })));
  const i = bolle.map((b) => b.utente).lastIndexOf(true);
  return { utente: bolle[i]?.testo || '', sotto: bolle.slice(i + 1).map((b) => b.testo).join('\n') };
}

const casi = [
  { nome: 'modello lento a rivedere l\'esito, OK subito e messaggio subito', testo: 'Te lo segno.', ritardoEsito: 4000, esito: 'ok' },
  { nome: 'lezione da sola, OK subito e messaggio subito', testo: '', ritardoEsito: 0, esito: 'ok' },
  { nome: 'col testo, rifiuto nel riquadro e poi il messaggio', testo: 'Te lo segno.', ritardoEsito: 0, esito: 'cancel' },
  { nome: 'lezione da sola, rifiuto nel riquadro e poi il messaggio', testo: '', ritardoEsito: 0, esito: 'cancel' },
];

for (const caso of casi) test(caso.nome, async ({ app, shell }) => {
  test.setTimeout(60_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#input')).toBeVisible();
  await prepara(app, caso);

  await page.locator('#input').fill('ricordati che sviluppo Filo');
  await page.locator('#sendBtn').click();
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 15_000 });
  await scrollConfirmToEnd(page);
  await clickConfirm(page, caso.esito);
  await expect(page.locator(CONFIRM_HOST)).toHaveCount(0, { timeout: 5_000 });

  await page.locator('#input').fill(DOMANDA);
  await page.locator('#sendBtn').click();
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Va bene.' }), 'la risposta al messaggio dopo il riquadro non compare')
    .toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(caso.ritardoEsito + 500);
  const { utente, sotto } = await sottoUltimoUtente(page);
  expect(utente).toContain('puoi non chiedere conferma');
  expect(sotto).toContain('Va bene.');
  expect(sotto, 'sotto il secondo messaggio arriva un pezzo del turno di prima').not.toContain('Me lo segno');
  await page.screenshot({ path: `tests/.shots/1337.3-${casi.indexOf(caso)}.png` });
});
