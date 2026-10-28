// Verifica #1467, giro 7, rilievo 1: con la home pronta accesa (com'è per chi usa Filo), all'avvio senza aprire niente
// si conta una sola home, quella che si vede; la home preparata dietro si conta quando diventa una scheda.

import { test, expect } from '../../fixtures/electron.mjs';

test.use({ riservaNuovaScheda: true });

const homeContate = (app) => app.evaluate(async () => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  let n = 0;
  for (const ora of Object.values(s.ore || {})) for (const v of Object.values(ora.home || {})) n += v;
  return n;
});

test('r1 avvio senza aprire niente: si conta solo la home che si vede, non quella pronta dietro', async ({ app }) => {
  test.setTimeout(60_000);
  // La home pronta dietro c'è davvero: due pagine della home caricate, una sola è una scheda.
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents()
    .filter((w) => w.getURL().startsWith('filo://newtab')).length), { timeout: 15_000 }).toBe(2);
  await expect.poll(() => homeContate(app), { timeout: 10_000 }).toBeGreaterThan(0);
  await new Promise((r) => setTimeout(r, 4000));
  expect(await homeContate(app)).toBe(1);
});
