// #1054 giro 3, rilievo 2: un collegamento scritto dal modello nella spiegazione si apre col menu nella pagina, non
// con quello nello strato.
import { test, expect } from '../../fixtures/electron.mjs';
import { menuDi, paginaDelloStrato, statoDelloStrato } from '../../helpers/menuContestuale.mjs';

test.use({ stratoDelMenu: true });

test('r2 il collegamento di una spiegazione nello strato apre la pagina in una scheda nuova', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(60_000);
  await paginaDelloStrato(app);
  await expect.poll(async () => (await statoDelloStrato(app))?.pronta).toBe(true);
  const dest = testServer.html('<!doctype html><title>Destinazione</title><p>ok</p>');
  await app.evaluate(async (_, t) => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({
      useDefaultModels: false,
      apiKeys: { openrouter: 'k-test' },
      models: { [C.ACTIONS.EXPLAIN]: 'deepseek-flash' },
      modelRegistry: globalThis.SN_TEST_MODELS.registry,
    });
    const finto = async ({ messages }) => {
      const s = JSON.stringify(messages);
      return { text: s.includes('ha selezionato un testo') ? t : 'ok', model: 'finto', provider: 'openrouter', costEur: 0, usage: {} };
    };
    globalThis.SN_PROVIDERS.completeWithFallback = finto;
    globalThis.SN_PROVIDERS.streamCompleteWithFallback = finto;
  }, `Vedi [la fonte](${dest}) per saperne di più.`);
  const page = await testServer.openReady(openTab, `<!doctype html><body style="font:18px sans-serif;padding:40px">
    <p id="testo">Il fotone è la particella elementare della luce.</p></body>`, { pubblico: true });
  await page.waitForFunction(() => document.documentElement.dataset.filoContentReady === '1', null, { timeout: 8000 });
  const p = await page.evaluate(() => {
    const t = document.getElementById('testo').firstChild;
    const r = document.createRange();
    r.setStart(t, 3);
    r.setEnd(t, 9);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const b = r.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const sezione = menuDi(page).locator('.sn-menu-inline-explain');
  await expect(sezione).toContainText('la fonte', { timeout: 8000 });
  const schede = () => shell.evaluate(() => document.querySelectorAll('.tab').length);
  const prima = await schede();
  await sezione.locator('a', { hasText: 'la fonte' }).click();
  await expect.poll(schede, { timeout: 8000 }).toBeGreaterThan(prima);
});
