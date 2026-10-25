// #892.1 giro 6 — esplorazione: dove va una barra seguita da frasi e percorsi, e da dove si perde «incollato».

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

async function finto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.setRaw(C.STORAGE_KEYS.FILO_ONBOARDING, { done: true, closedAt: Date.now() });
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__n = 0;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = async ({ attempts, onDelta }) => {
      globalThis.__n += 1;
      const text = `Risposta ${globalThis.__n} di Filo.`;
      try { onDelta && onDelta(text); } catch (_) {}
      return { model: attempts[0].model, provider: attempts[0].provider, usage: {}, text, toolCalls: [], reasoningDetails: [], finishReason: 'stop' };
    };
  });
}

async function dove(page, app, frase) {
  const prima = await app.evaluate(() => globalThis.__n);
  const cmdPrima = await page.locator('.dash-term-cmd').count();
  await page.locator('#input').fill(frase);
  await page.waitForTimeout(1500);
  const classe = await page.locator('#input').getAttribute('class');
  await page.locator('#input').press('Enter');
  let esito = 'niente';
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    if (await page.locator(CONFIRM_HOST).count()) { esito = 'conferma'; break; }
    if ((await app.evaluate(() => globalThis.__n)) > prima) { esito = 'filo'; break; }
    if ((await page.locator('.dash-term-cmd').count()) > cmdPrima) { esito = 'shell'; break; }
  }
  if (esito === 'conferma') await clickConfirm(page, 'cancel');
  await page.locator('#input').fill('');
  return { frase, classe, esito };
}

test('esplora: frasi e percorsi dopo la barra', async ({ app }) => {
  const dir = cartellaTemporanea('filo-892-1-g6-');
  mkdirSync(path.join(dir, 'Documenti'));
  writeFileSync(path.join(dir, 'Documenti', 'lettera.pdf'), 'x');
  const page = await newtabPage(app);
  await finto(app);
  await page.locator('#input').fill(`/cd "${dir}"`);
  await page.locator('#input').press('Enter');
  await expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 12_000 });
  const frasi = ['/Documenti/lettera.pdf che cos\'è?', '/Documenti/', '/Documenti/nonce.pdf', '/:) grazie', '/. punto', '/#todo latte',
    '/*importante* domani', '/«ciao» dice', "/'ciao' dice lui", '/1+1?', '/e/o cosa?', '/🙂 ciao', '/su questo punto', '/test domani'];
  const out = [];
  for (const f of frasi) out.push(await dove(page, app, f));
  console.log(JSON.stringify(out, null, 1));
});

test('esplora: annulla dopo aver svuotato una riga incollata', async ({ app }) => {
  const b = path.join(cartellaTemporanea('filo-892-1-g6-'), 'da-cancellare');
  mkdirSync(b);
  writeFileSync(path.join(b, 'dentro.txt'), 'x');
  const page = await newtabPage(app);
  const comando = `/rm -rf "${b}"`;
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), comando);
  await page.locator('#input').focus();
  await page.keyboard.press('Control+V');
  await expect(page.locator('#input')).toHaveValue(comando);
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await expect(page.locator('#input')).toHaveValue('');
  await page.keyboard.press('Control+Z');
  await expect(page.locator('#input')).toHaveValue(comando);
  await page.locator('#input').press('Enter');
  await expect(page.locator(CONFIRM_HOST)).toBeVisible({ timeout: 10_000 });
  console.log('UNDO hasInput', (await confirmState(page)).hasInput);
  await clickConfirm(page, 'cancel');
  expect(existsSync(b)).toBe(true);
});
