// Verifica #2662 giro 2: la porta del rilievo 1 del giro 1 ri-provata (valore che spariva dietro i puntini).

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

const STILE = 'Rispondi in modo breve, diretto e senza giri di parole, dammi del tu';

const misura = (riga) => riga.evaluate((r) => {
  const t = r.querySelector('.dash-cambio-testo').getBoundingClientRect();
  const q = r.querySelector('.dash-cambio-testo .dash-altrui');
  const b = q ? q.getBoundingClientRect() : null;
  return { testo: Math.round(t.right), riquadro: b ? Math.round(b.right) : null, inizio: b ? Math.round(b.left) : null };
});

test('il valore scritto in una frase resta leggibile nella riga della cronologia, anche col tasto annulla davanti', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate((_e, v) => globalThis.SN_STORAGE.updateSettings({ agentStyle: v }), STILE);
  const prima = page.locator('.dash-cambio', { hasText: 'stile dell' }).last();
  await expect(prima).toBeVisible({ timeout: 10_000 });
  const riga = page.locator(`.dash-cambio[data-id="${await prima.getAttribute('data-id')}"]`);

  const ferma = await misura(riga);
  await riga.hover();
  await expect(riga.locator('.dash-cambio-annulla')).toBeVisible();
  const sopra = await misura(riga);
  await page.screenshot({ path: 'tests/.shots/v2662g2-r1-sopra.png' });
  expect(ferma.riquadro).toBeLessThanOrEqual(ferma.testo + 1);
  expect(sopra.riquadro).toBeLessThanOrEqual(sopra.testo + 1);
  expect(sopra.testo - sopra.inizio).toBeGreaterThan(40);

  await riga.locator('.dash-cambio-annulla').click();
  await expect(riga.locator('.dash-cambio-stato')).toHaveText('annullato', { timeout: 10_000 });
  await page.mouse.move(5, 5);
  const annullata = await misura(riga);
  await riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v2662g2-r1-annullata.png' });
  expect(annullata.riquadro).toBeLessThanOrEqual(annullata.testo + 1);

  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w._filoTabs) w.setSize(1000, 760); });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1100);
  const stretta = await misura(riga);
  await page.screenshot({ path: 'tests/.shots/v2662g2-r1-stretta.png' });
  expect(stretta.riquadro).toBeLessThanOrEqual(stretta.testo + 1);
  expect(stretta.testo - stretta.inizio).toBeGreaterThan(20);
});
