// Verifica #1467 giro 2, r1: la scheda chiusa dalla pulizia e riaperta col clic sulla sua voce nella home si conta fra le
// riaperte, come quella riaperta dal tasto destro.
import { test, expect } from '../../fixtures/electron.mjs';

const misura = (app, m) => app.evaluate(async (_e, m) => {
  const s = await globalThis.SN_CONTATORI_MAIN.letto();
  const out = {};
  for (const ora of Object.values(s.ore || {})) for (const [c, n] of Object.entries(ora[m] || {})) out[c] = (out[c] || 0) + n;
  return out;
}, m);

test('r1 la scheda chiusa dalla pulizia, riaperta col clic sulla sua voce nella home, si conta fra le riaperte', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(90_000);
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const url = testServer.html('<title>Ricetta</title><p>La ricetta della pasta.</p>', { pubblico: true });
  await openTab(url);
  await openTab(url);
  const prima = await openTab('filo://newtab/?prova=pulizia');
  const r = await prima.evaluate(() => chrome.runtime.sendMessage({ type: 'run_tab_triage' }));
  expect(r.archived).toBeGreaterThanOrEqual(1);
  expect(await misura(app, 'riaperte')).toEqual({});

  // La persona apre una scheda nuova e ritrova la pagina nel filo della home.
  const home = await openTab('filo://newtab/?prova=riapri');
  const voce = home.locator(`.dash-pagina[href="${url}"]`).first();
  await expect(voce).toHaveCount(1, { timeout: 15_000 });
  const gruppo = home.locator('.dash-pagine', { has: voce }).first();
  await gruppo.locator('.dash-pagine-testa').click();
  await expect(voce).toBeVisible();
  await voce.click();
  await expect.poll(() => misura(app, 'riaperte'), { timeout: 8_000 }).toEqual({ 'duplicato|min10': 1 });
});
