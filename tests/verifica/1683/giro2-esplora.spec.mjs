// Verifica #1683 giro 2 — esplorazione: documento col permesso d'esecuzione, Bash che chiede, apostrofo, tema scuro.

import { test, expect } from '../../fixtures/electron.mjs';
import { CONFIRM_HOST, clickConfirm } from '../../helpers/confirm.mjs';
import { cartellaTemporanea } from '../../helpers/percorsi.mjs';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
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

async function filoFinto(app) {
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

test.skip(process.platform === 'win32', 'Linux e Mac');

test('pdf col permesso d\'esecuzione: la frase va a Filo', async ({ app }) => {
  const dir = cartellaTemporanea('filo-1683-g2-');
  const pdf = path.join(dir, 'lettera.pdf');
  writeFileSync(pdf, '%PDF-1.4\n');
  chmodSync(pdf, 0o777);
  const page = await newtabPage(app);
  await filoFinto(app);
  const frasi = [`/${pdf} che cos'è?`, `/${pdf}`];
  for (const [i, frase] of frasi.entries()) {
    await page.locator('#input').fill(frase);
    await expect(page.locator('#input'), frase).toHaveClass(/is-cmd-unknown/, { timeout: 8_000 });
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-bubble-filo', { hasText: `Risposta ${i + 1} di Filo.` }), frase).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(CONFIRM_HOST)).toHaveCount(0);
  }
});

for (const shell of ['bash', 'sh']) {
  test(`${shell}: cp -i con la risposta, read, apostrofo, poi un comando normale`, async ({ app }) => {
    const dir = cartellaTemporanea('filo-1683-g2-');
    writeFileSync(path.join(dir, 'bozza.txt'), 'nuovo');
    writeFileSync(path.join(dir, 'lettera.txt'), 'vecchio');
    await app.evaluate(async (_e, s) => globalThis.__filoHandlers.handleMessage({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { terminal: { enabled: true, shell: s } } }, { url: 'filo://preferences/preferences.html' }), shell);
    const page = await newtabPage(app);
    const input = page.locator('#input');
    const ultimaUscita = () => page.locator('.dash-term-out').last();
    const fermo = () => expect(page.locator('.dash-term-controls')).toHaveCount(0, { timeout: 12_000 });

    await input.fill(`/cd "${dir}"`);
    await input.press('Enter');
    await fermo();

    await input.fill('/cp -i bozza.txt lettera.txt');
    await input.press('Enter');
    await clickConfirm(page, 'ok', { timeout: 10_000 });
    const stdin = page.locator('.dash-term-stdin').last();
    await expect(stdin).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(500);
    await stdin.fill('y');
    await stdin.press('Enter');
    await fermo();
    expect(readFileSync(path.join(dir, 'lettera.txt'), 'utf8')).toBe('nuovo');

    await input.fill('/read x; echo "letto=$x"');
    await input.press('Enter');
    await clickConfirm(page, 'ok', { timeout: 10_000 });
    await expect(page.locator('.dash-term-stdin').last()).toBeVisible({ timeout: 8_000 });
    await page.waitForTimeout(300);
    await page.locator('.dash-term-stdin').last().fill('ciao 🙂');
    await page.locator('.dash-term-stdin').last().press('Enter');
    await expect(ultimaUscita()).toContainText('letto=ciao 🙂', { timeout: 8_000 });
    await fermo();

    await input.fill("/echo l'altro");
    await input.press('Enter');
    await fermo();
    await input.fill('/echo dopo-1683');
    await input.press('Enter');
    await expect(ultimaUscita()).toHaveText(/^dopo-1683\s*$/, { timeout: 12_000 });
    await fermo();

    await input.fill('/ls ./non-ce-1683; echo fine-1683');
    await input.press('Enter');
    await expect(ultimaUscita()).toContainText('fine-1683', { timeout: 12_000 });
    await expect(ultimaUscita()).toContainText('non-ce-1683');
    await fermo();
    await page.screenshot({ path: `tests/.shots/1683-g2-${shell}.png` }).catch(() => {});
  });
}

test('tema scuro: la barra del comando, schermata', async ({ app }) => {
  const page = await newtabPage(app);
  for (const t of ['dark', 'light']) {
    await app.evaluate(async (_e, v) => globalThis.__filoHandlers.handleMessage({ type: globalThis.SN_MSG.MSG.UPDATE_SETTINGS, settings: { theme: v } }, { url: 'filo://preferences/preferences.html' }), t);
    await expect(page.locator('html')).toHaveAttribute('data-sn-theme', t, { timeout: 5_000 });
    await page.locator('#input').fill(`/echo tema-${t}`);
    await page.locator('#input').press('Enter');
    await expect(page.locator('.dash-term-out').last()).toContainText(`tema-${t}`, { timeout: 12_000 });
    await page.waitForTimeout(800);
    await page.locator('.dash-term-cmd').last().screenshot({ path: `tests/.shots/1683-g2-cmd-${t}.png` });
  }
});
