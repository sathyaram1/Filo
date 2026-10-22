// Verifica #1475, giro 1: esplorazione. La chat del documento su un documento lungo incollato, con emoji e markup.
import { test, expect } from '../../fixtures/electron.mjs';

const FONDO = 'La chiave del magazzino sta sotto il vaso di gerani 🌺 <b>non</b> nel cassetto.';

async function prepara(app) {
  await app.evaluate(async (_electron, { fondo }) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EDITOR_CHAT]: 'deepseek-flash', [C.ACTIONS.EDITOR_TITLE]: 'deepseek-flash', [C.ACTIONS.EDITOR_SUMMARY]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__viste = [];
    const P = globalThis.SN_PROVIDERS;
    const risposta = ({ attempts, messages }) => {
      const tutto = messages.map((m) => String(m.content || '')).join('\n');
      globalThis.__viste.push({ lung: tutto.length, vede: tutto.includes(fondo) });
      return { text: tutto.includes(fondo) ? 'Sotto il vaso di gerani.' : 'Non lo trovo.', finishReason: 'stop', model: attempts[0].model, provider: attempts[0].provider, usage: {}, toolCalls: [], reasoningDetails: [] };
    };
    P.completeWithFallback = async (o) => risposta(o);
    P.streamCompleteWithFallback = async (o) => { const r = risposta(o); try { o.onDelta && o.onDelta(r.text); } catch (_) {} return r; };
  }, { fondo: FONDO });
}

async function chiedi(editor, domanda) {
  const chat = editor.locator('.ed-module[data-type="chat"]');
  if (!await chat.count()) await editor.locator('.ed-switch-icon').nth(1).click();
  await chat.locator('[data-chat="input"]').fill(domanda);
  await chat.locator('[data-chat="send"]').click();
  return chat;
}

test('incollato a mano, 150.000 caratteri: la chat trova la frase in fondo anche dopo aver riaperto la pagina', async ({ app, openTab }) => {
  test.setTimeout(180_000);
  await prepara(app);
  const editor = await openTab('filo://editor/editor.html');
  await editor.waitForSelector('#doc');
  await editor.evaluate((fondo) => {
    const d = document.getElementById('doc');
    d.focus();
    const riga = 'Verbale della riunione: si discute di ferie, turni e di una caldaia che perde. ';
    const testo = Array.from({ length: 1900 }, (_, i) => `${i}. ${riga}`).join('\n') + '\n' + fondo;
    const dt = new DataTransfer();
    dt.setData('text/plain', testo);
    d.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, FONDO);
  await expect.poll(() => editor.evaluate(() => document.getElementById('doc').innerText.length), { timeout: 10_000 }).toBeGreaterThan(150_000);
  const chat = await chiedi(editor, 'Dove sta la chiave?');
  await expect(chat.locator('.ed-chat-msg.assistant').last()).toHaveText('Sotto il vaso di gerani.', { timeout: 20_000 });
  await expect(chat.locator('.ed-chat-note')).toHaveCount(0);

  await editor.waitForTimeout(2500);
  await editor.reload();
  await editor.waitForSelector('#doc');
  const chat2 = await chiedi(editor, 'E adesso, dove sta?');
  await expect(chat2.locator('.ed-chat-msg.assistant').last()).toHaveText('Sotto il vaso di gerani.', { timeout: 20_000 });
});
