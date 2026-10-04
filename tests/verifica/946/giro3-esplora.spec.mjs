// #946 giro 3: esplorazione visiva (tema chiaro e scuro) della riga d'origine.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pngConTesto, pngSpoglio } from '../../helpers/immagineFirmata.mjs';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'provenienza');

async function modelloVista(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      modelRegistry: { mio: { provider: 'openrouter', model: 'test/vista', inputs: ['text', 'image'], outputs: ['text'] } },
      models: { [C.ACTIONS.DESCRIBE_IMAGE]: ['mio'] },
    });
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts }) => ({
      text: 'Un quadrato arancione su fondo chiaro.\nSecondo paragrafo della descrizione, abbastanza lungo da andare a capo più volte nel riquadro del menu.',
      model: attempts[0].model, provider: attempts[0].provider, usage: {},
    });
  });
}

for (const tema of ['light', 'dark']) {
  test(`aspetto ${tema}`, async ({ app, shell, openTab, testServer }) => {
    await modelloVista(app);
    await shell.evaluate((t) => window.filoShell.message({ type: 'update_settings', settings: { theme: t } }), tema);
    const firmata = testServer.asset(readFileSync(join(FIXTURE, 'c2pa-ufficiale-ai.jpg')), 'image/jpeg').replace('127.0.0.1', 'localhost');
    const debole = testServer.asset(pngConTesto(pngSpoglio(), 'parameters', 'un gatto\nSteps: 30'), 'image/png');
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px;font:16px sans-serif">
      <img id="a" src="${firmata}" width="160" height="160"> <img id="b" src="${debole}" width="160" height="160" style="background:#e07b39"></body></html>`);
    await page.waitForFunction((t) => document.documentElement.dataset.snTheme === t || t === 'light', tema, { timeout: 8000 }).catch(() => {});
    for (const id of ['a', 'b']) {
      await page.locator('#' + id).click({ button: 'right', position: { x: 20, y: 20 } });
      const menu = page.locator('.sn-menu');
      await expect(menu.locator('.sn-menu-origine')).toBeVisible({ timeout: 10000 });
      await expect(menu.locator('.sn-menu-link-body')).toHaveAttribute('aria-label', /quadrato/, { timeout: 10000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `tests/.shots/946-g3-${tema}-${id}.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  });
}
