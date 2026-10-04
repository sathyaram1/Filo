// #946 giro 1: l'immagine che il tasto destro dice «generata con l'AI», copiata col menu
// e incollata nella chat della Home, deve arrivare al modello con lo stesso esito.

import { test, expect } from '../../fixtures/electron.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'provenienza');

async function modelloFinto(app) {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.FILO_CHAT]: 'deepseek-flash', [C.ACTIONS.FILO_DASHBOARD]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__turni = [];
    const finto = async ({ attempts, messages }) => {
      globalThis.__turni.push(JSON.stringify(messages));
      return { text: JSON.stringify({ text: 'Ecco.', status: 'done' }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  });
}

for (const [nome, tipo] of [['c2pa-ufficiale-ai.png', 'image/png'], ['c2pa-ufficiale-ai.jpg', 'image/jpeg']]) {
  test(`copia immagine dal menu e incolla in chat: ${nome}`, async ({ app, openTab, testServer }) => {
    await modelloFinto(app);
    const src = testServer.asset(readFileSync(join(FIXTURE, nome)), tipo);
    const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
      <img id="foto" src="${src}" width="160" height="160"></body></html>`);
    await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
    const menu = page.locator('.sn-menu');
    await expect(menu.locator('.sn-menu-origine')).toHaveAttribute('aria-label', /Generata con l’AI/, { timeout: 10000 });
    await menu.getByText('Copia immagine', { exact: true }).click();
    await expect.poll(() => app.evaluate(({ clipboard }) => !clipboard.readImage().isEmpty()), { timeout: 8000 }).toBe(true);

    const home = await openTab('filo://newtab/');
    await expect(home.locator('#input')).toBeVisible({ timeout: 10000 });
    await home.locator('#input').focus();
    await home.keyboard.press('Control+v');
    await expect(home.locator('#imgPreviews .dash-img-preview img')).toHaveCount(1, { timeout: 5000 });
    await home.locator('#input').fill('questa è fatta con l’AI?');
    await home.locator('#sendBtn').click();

    const cerca = () => globalThis.__turni.find((t) => t.includes('questa è fatta con')) || '';
    await expect.poll(() => app.evaluate(cerca), { timeout: 20000 }).not.toBe('');
    const prompt = await app.evaluate(cerca);
    expect(prompt).not.toContain('non ne porta nessuna');
    expect(prompt).toContain('Generata con l’AI');
  });
}
