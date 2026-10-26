import { test, expect } from '../../fixtures/electron.mjs';

test.use({ riservaNuovaScheda: true });

const home = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora.home || {})) out[c] = (out[c] || 0) + n;
  return out;
});

test('esplora: con la home pronta accesa, quante home si contano senza aprire niente', async ({ app }) => {
  test.setTimeout(60_000);
  await new Promise((r) => setTimeout(r, 8000));
  const prima = await home(app);
  const tipi = await app.evaluate(({ webContents }) => webContents.getAllWebContents().map((w) => w.getURL()));
  console.log('HOME', JSON.stringify(prima), JSON.stringify(tipi));
  expect(true).toBe(true);
});
