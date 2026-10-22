// Verifica #1475, giro 1, rilievo 1: con un modello dalla finestra stretta un documento lungo deve avere comunque una
// risposta (sulla parte che ci sta) e l'avviso del taglio, non un errore. Il modello finto rifiuta come il router vero.
import { test, expect } from '../../fixtures/electron.mjs';

const INIZIO = 'Il verbale si apre con la nomina di Giulia come segretaria.';
const RIEMPIMENTO = 'Si discute di ferie, turni e di una caldaia che perde nel locale tecnico del secondo piano. ';
const FINESTRA_CARATTERI = 100_000;

async function prepara(app) {
  await app.evaluate(async (_electron, { inizio, finestra }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EDITOR_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const tutto = messages.map((m) => String(m.content || '')).join('\n');
      if (tutto.length > finestra) {
        const chiesti = Math.round(tutto.length / 3);
        const e = new Error(`OpenRouter 400: {"error":{"message":"This endpoint's maximum context length is 32768 tokens. However, you requested about ${chiesti + 1000} tokens (${chiesti} of text input, 1000 in the output). Please reduce the length of either one, or use the \\"middle-out\\" transform to compress your prompt automatically.","code":400}}`);
        e.status = 400;
        throw e;
      }
      return { text: tutto.includes(inizio) ? 'Giulia fa la segretaria.' : 'Non lo trovo.', finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  }, { inizio: INIZIO, finestra: FINESTRA_CARATTERI });
}

test('r1 documento di 200.000 caratteri e modello da 32.000 token: la chat risponde sull\'inizio e dice il taglio', async ({ app, openTab }) => {
  test.setTimeout(120_000);
  await prepara(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.evaluate(({ inizio, riempimento }) => {
    const d = document.getElementById('doc');
    const corpo = Array.from({ length: 220 }, () => `<p>${riempimento.repeat(10)}</p>`).join('');
    d.innerHTML = `<p>${inizio}</p>${corpo}`;
    d.dispatchEvent(new Event('input', { bubbles: true }));
  }, { inizio: INIZIO, riempimento: RIEMPIMENTO });
  await expect.poll(() => editor.evaluate(() => document.getElementById('doc').innerText.length)).toBeGreaterThan(190_000);

  const chat = editor.locator('.ed-module[data-type="chat"]');
  if (!await chat.count()) await editor.locator('.ed-switch-icon').nth(1).click();
  await chat.locator('[data-chat="input"]').fill('Chi fa la segretaria?');
  await chat.locator('[data-chat="send"]').click();
  await expect(chat.locator('.ed-chat-msg.assistant').last()).toHaveText('Giulia fa la segretaria.', { timeout: 20_000 });
  await expect(chat.locator('.ed-chat-note')).toContainText('ho letto i primi');
});
