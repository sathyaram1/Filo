import { test, expect } from '../../fixtures/electron.mjs';
import { mkdirSync } from 'node:fs';

const SHOTS = 'tests/.shots/verifica-256.4';
const FRASE = 'riassumi il secondo paragrafo e dimmi se il tono è adatto a una lettera';

for (const [w, h, tema] of [[1024, 640, 'dark'], [900, 520, 'dark'], [1280, 720, 'light']]) {
  test(`aspetto ${w}x${h} ${tema}`, async ({ app, shell, openTab }) => {
    test.setTimeout(60_000);
    await app.evaluate(({ BrowserWindow }, [w, h]) => { BrowserWindow.getAllWindows()[0].setSize(w, h); }, [w, h]);
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
    await app.evaluate(async (_e, t) => {
      await globalThis.SN_STORAGE.updateSettings({
        useDefaultModels: false, apiKeys: { openrouter: 'k-test' },
        models: { ...globalThis.SN_TEST_MODELS.models, [globalThis.SN_CONST.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
        modelRegistry: globalThis.SN_TEST_MODELS.registry, theme: t,
      });
      globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({ text: 'Il secondo paragrafo parla del contratto e ha un tono cordiale.', model: attempts[0].model, provider: attempts[0].provider, usage: {} });
    }, tema);
    const ed = await openTab('filo://editor/editor.html');
    await ed.waitForSelector('.ed-module[data-type="switch"]');
    await ed.locator('.ed-switch-icon').nth(1).click();
    const chat = ed.locator('.ed-module[data-type="chat"]');
    const casella = chat.locator('[data-chat="input"]');
    await casella.fill('domanda');
    await casella.press('Enter');
    await expect(chat.locator('.ed-chat-msg.assistant')).toHaveCount(1, { timeout: 8_000 });
    await casella.fill(FRASE);
    await ed.waitForTimeout(200);
    mkdirSync(SHOTS, { recursive: true });
    await chat.screenshot({ path: `${SHOTS}/aspetto-${w}x${h}-${tema}.png` });
    // Dopo l'invio la casella torna piccola e la risposta nuova è in vista.
    await casella.press('Enter');
    await expect(chat.locator('.ed-chat-msg.assistant')).toHaveCount(2, { timeout: 8_000 });
    await ed.waitForTimeout(200);
    await chat.screenshot({ path: `${SHOTS}/aspetto-${w}x${h}-${tema}-dopo.png` });
    const m = await ed.evaluate(() => {
      const mod = document.querySelector('.ed-module[data-type="chat"]');
      const l = mod.querySelector('[data-chat="log"]').getBoundingClientRect();
      const r = [...mod.querySelectorAll('.ed-chat-msg.assistant')].pop().getBoundingClientRect();
      const t = mod.querySelector('[data-chat="input"]');
      return { casella: t.value, logH: l.height, fondoInVista: r.bottom <= l.bottom + 1 && r.bottom >= l.top };
    });
    console.log('DOPO', w, h, JSON.stringify(m));
  });
}
