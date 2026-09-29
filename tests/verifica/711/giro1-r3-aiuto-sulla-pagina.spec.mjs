// Verifica #711, giro 1, rilievo 3: «questa foto è fatta con l'AI?» chiesto all'Aiuto della
// pagina dove la foto sta. Il modello deve ricevere lo stesso esito che il tasto destro mostra.
import { test, expect } from '../../fixtures/electron.mjs';
import { pngFirmato, certificato } from '../../helpers/immagineFirmata.mjs';

test('l’Aiuto della pagina porta al modello lo stesso esito del tasto destro', async ({ app, openTab, testServer }) => {
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.HELP]: 'deepseek-flash', [C.ACTIONS.FILO_CHAT]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    globalThis.__turni711 = [];
    globalThis.SN_PROVIDERS.completeWithFallback = async ({ attempts, messages }) => {
      globalThis.__turni711.push(JSON.stringify(messages));
      return { text: JSON.stringify({ text: 'Ecco.', status: 'done' }), model: attempts[0].model, provider: attempts[0].provider, usage: {} };
    };
  });

  const src = testServer.asset(pngFirmato({ cert: certificato({ organizzazione: 'OpenAI, Inc.' }) }), 'image/png');
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="padding:24px">
    <h1>Una foto</h1><img id="foto" src="${src}" width="160" height="160" alt="foto">
  </body></html>`);

  // Il tasto destro sulla foto dice l'esito: è quello che la chat deve ripetere.
  await page.locator('#foto').click({ button: 'right', position: { x: 20, y: 20 } });
  await expect(page.locator('.sn-menu .sn-menu-origine')).toContainText('Generata con l’AI', { timeout: 10000 });
  await page.keyboard.press('Escape');

  await page.waitForFunction(() => typeof window.SN_SIDEBAR?.open === 'function', null, { timeout: 8000 });
  await page.evaluate(() => window.SN_SIDEBAR.open());
  await page.waitForSelector('.sn-sidebar-input textarea', { timeout: 8000 });
  const prima = await app.evaluate(() => globalThis.__turni711.length);
  await page.fill('.sn-sidebar-input textarea', 'questa foto è fatta con l’AI?');
  await page.press('.sn-sidebar-input textarea', 'Enter');

  await expect.poll(() => app.evaluate((n) => globalThis.__turni711.length > n, prima), { timeout: 20000 }).toBe(true);
  const prompt = await app.evaluate((n) => globalThis.__turni711.slice(n).join('\n'), prima);
  expect(prompt).toContain('questa foto è fatta con');
  expect(prompt).toContain('Generata con l’AI');
});
