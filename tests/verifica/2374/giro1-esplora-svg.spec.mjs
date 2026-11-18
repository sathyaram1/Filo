// Esplorazione: si cancella prima del verdetto.
import { test, expect } from '../../fixtures/electron.mjs';
import { paginaDelloStrato } from '../../helpers/riquadri.mjs';
import { menuDi } from '../../helpers/menuContestuale.mjs';

const SVG = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><rect width="600" height="120" fill="#fff"/><text x="20" y="70" font-size="32" font-family="sans-serif">Fattura numero 4821</text></svg>');

test('esplora svg', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0;padding:60px 40px">
<img id="foto" width="600" height="120" src="data:image/svg+xml,${SVG}"></body></html>`);
  await page.waitForFunction(() => document.getElementById('foto').complete);
  await app.evaluate(async () => {
    const C = globalThis.SN_CONST;
    await globalThis.SN_STORAGE.updateSettings({ useDefaultModels: false, apiKeys: { openrouter: 'k-test' }, models: { [C.ACTIONS.TRANSCRIBE_IMAGE]: 'gemma' }, modelRegistry: globalThis.SN_TEST_MODELS.registry });
    globalThis.__letture = 0;
    const P = globalThis.SN_PROVIDERS;
    const vc = P.completeWithFallback;
    P.completeWithFallback = async (o) => {
      if (!JSON.stringify(o.messages || '').includes('Trascrivi ESATTAMENTE')) return vc(o);
      globalThis.__letture++;
      return { text: '{"righe":[{"testo":"Fattura numero 4821","x1":33,"y1":330,"x2":600,"y2":650}]}', model: 'f', provider: 'f', costEur: 0, usage: {} };
    };
  });
  await page.locator('#foto').click({ button: 'right', position: { x: 10, y: 10 } });
  await menuDi(page).locator('.sn-menu button', { hasText: 'Trascrivi' }).first().click();
  await page.waitForTimeout(4000);
  const strato = await paginaDelloStrato(app, page).catch(() => null);
  console.log('STRATO', !!strato, 'OVERLAY', strato ? await strato.locator('.sn-tr-overlay').count() : -1, 'LETTURE', await app.evaluate(() => globalThis.__letture));
  if (strato) await strato.screenshot({ path: 'tests/.shots/v2374-svg.png' });
  await page.screenshot({ path: 'tests/.shots/v2374-svg-pagina.png' });
});
