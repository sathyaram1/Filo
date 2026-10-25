// #892.1 giro 3 — la porta del giro 2 (una cancellazione incollata vuole la parola «conferma») ri-provata dalle altre
// strade che portano un testo d'altri nella barra: l'Incolla del menu, il trascinamento, l'invio mentre Filo risponde.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, confirmState, clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function newtabPage(app) {
  let win = null;
  await expect.poll(() => {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab')) || null;
    return Boolean(win);
  }, { timeout: 10_000 }).toBe(true);
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('#input')).toBeVisible({ timeout: 8_000 });
  await expect.poll(() => win.evaluate(() => window.SN_DASH_TERMINALE?.isEnabled?.() === true), { timeout: 8_000 }).toBe(true);
  return win;
}

function bersaglio() {
  const b = path.join(cartellaTemporanea('filo-892-1-g3-'), 'da-cancellare');
  mkdirSync(b);
  writeFileSync(path.join(b, 'dentro.txt'), 'x');
  return b;
}
const rmDi = (c) => (process.platform === 'win32' ? `Remove-Item -Recurse -Force "${c}"` : `rm -rf "${c}"`);

async function vuoleLaParola(page, b) {
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  expect((await confirmState(page)).hasInput, 'una cancellazione portata da fuori vuole la parola «conferma»').toBe(true);
  await clickConfirm(page, 'cancel');
  expect(existsSync(b)).toBe(true);
}

test('Incolla dal menu del tasto destro: la cancellazione vuole «conferma»', async ({ app }) => {
  const b = bersaglio();
  const page = await newtabPage(app);
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), `/${rmDi(b)}`);
  await page.locator('#input').focus();
  await app.evaluate(({ webContents }) => webContents.getAllWebContents().find((w) => w.getURL().startsWith('filo://newtab')).paste());
  await expect(page.locator('#input')).toHaveValue(`/${rmDi(b)}`);
  await page.locator('#input').press('Enter');
  await vuoleLaParola(page, b);
});

test('una riga trascinata nella barra: la cancellazione vuole «conferma»', async ({ app }) => {
  const b = bersaglio();
  const page = await newtabPage(app);
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    const input = document.getElementById('input');
    input.focus();
    input.form.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, `/${rmDi(b)}`);
  await expect(page.locator('#input')).toHaveValue(new RegExp('rm|Remove'));
  await page.locator('#input').press('Enter');
  await vuoleLaParola(page, b);
});

test('incollata e mandata mentre Filo risponde: parte a turno finito e vuole «conferma»', async ({ app }) => {
  const b = bersaglio();
  const page = await newtabPage(app);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      await new Promise((r) => setTimeout(r, 4000));
      const text = 'Risposta lenta di Filo.';
      try { onDelta && onDelta(text); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
  await page.locator('#input').fill('ciao come va');
  await page.locator('#input').press('Enter');
  await page.waitForTimeout(600);
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), `/${rmDi(b)}`);
  await page.locator('#input').focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V');
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-bubble-filo', { hasText: 'Risposta lenta di Filo.' })).toBeVisible({ timeout: 15_000 });
  await vuoleLaParola(page, b);
});
