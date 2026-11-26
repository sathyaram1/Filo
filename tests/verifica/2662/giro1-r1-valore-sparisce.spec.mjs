// Verifica #2662 giro 1, rilievo 1: nella cronologia della home un valore che non sta sulla riga accanto al nome
// sparisce tutto, sostituito dai puntini: col riquadro in un pezzo solo, il taglio della riga lo inghiotte intero.

import { test, expect } from '../../fixtures/electron.mjs';
import { home } from '../../helpers/chatFinta.mjs';

// Uno stile come lo scrive chi lo chiede a parole: una frase, non una parola.
const STILE = 'Rispondi in modo breve, diretto e senza giri di parole, dammi del tu';

const misura = (riga) => riga.evaluate((r) => {
  const t = r.querySelector('.dash-cambio-testo').getBoundingClientRect();
  const q = r.querySelector('.dash-cambio-testo .dash-altrui');
  const b = q ? q.getBoundingClientRect() : null;
  return { testo: Math.round(t.right), riquadro: b ? Math.round(b.right) : null, inizio: b ? Math.round(b.left) : null };
});

test('r1 il valore scritto in una frase resta leggibile nella riga della cronologia, anche col tasto annulla davanti', async ({ app }) => {
  test.setTimeout(60_000);
  const page = await home(app);
  await app.evaluate((_e, v) => globalThis.SN_STORAGE.updateSettings({ agentStyle: v }), STILE);
  const riga = page.locator('.dash-cambio', { hasText: 'stile dell' }).last();
  await expect(riga).toBeVisible({ timeout: 10_000 });

  const ferma = await misura(riga);
  await riga.hover();
  await expect(riga.locator('.dash-cambio-annulla')).toBeVisible();
  const sopra = await misura(riga);
  await page.screenshot({ path: 'tests/.shots/v2662-r1-sopra.png' });
  console.log('MISURE', JSON.stringify({ ferma, sopra }));

  // Il riquadro sta dentro la riga: se ne esce, i puntini della riga lo nascondono tutto e del valore non resta niente.
  expect(ferma.riquadro, 'riga ferma: il riquadro finisce dentro la riga').toBeLessThanOrEqual(ferma.testo + 1);
  expect(sopra.riquadro, 'col mouse sopra: il riquadro finisce dentro la riga').toBeLessThanOrEqual(sopra.testo + 1);
  expect(sopra.testo - sopra.inizio, 'del valore se ne vede un pezzo').toBeGreaterThan(40);

  // Annullato, la riga dice «annullato» e offre «rifai»: lo spazio per il valore si accorcia.
  await riga.locator('.dash-cambio-annulla').click();
  await expect(riga.locator('.dash-cambio-stato')).toHaveText('annullato', { timeout: 10_000 });
  await page.mouse.move(5, 5);
  const annullata = await misura(riga);
  await riga.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tests/.shots/v2662-r1-annullata.png' });
  console.log('ANNULLATA', JSON.stringify(annullata));
  expect(annullata.riquadro, 'riga annullata: il riquadro finisce dentro la riga').toBeLessThanOrEqual(annullata.testo + 1);

  // Una finestra non a tutto schermo: la colonna del filo si stringe.
  await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w._filoTabs) w.setSize(1000, 760); });
  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(1100);
  const stretta = await misura(riga);
  await page.screenshot({ path: 'tests/.shots/v2662-r1-stretta.png' });
  console.log('STRETTA', JSON.stringify(stretta));
  expect(stretta.riquadro, 'finestra più stretta: il riquadro finisce dentro la riga').toBeLessThanOrEqual(stretta.testo + 1);
});
