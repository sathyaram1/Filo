// Verifica #872 giro 2: esplorazione (Esc nel campo, × durante la correzione, campo svuotato, riga troppo lunga).

import { test, expect } from '../../fixtures/electron.mjs';

const QUADERNO = 'filo://quaderno/quaderno.html';
const esatto = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const riga = (page, testo) => page.locator('.qd-riga').filter({ has: page.locator('.qd-testo', { hasText: esatto(testo) }) });
const memoria = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());

test('Esc lascia com\'era e la scheda resta', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta\nVive a Lisbona', PREFERENZE: 'Ama il tè' }));
  const page = await openTab(QUADERNO);
  await riga(page, 'Vive a Lisbona').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('Vive a Roma');
  await page.locator('.qd-campo').press('Escape');
  await expect(riga(page, 'Vive a Lisbona')).toHaveCount(1);
  expect((await memoria(app)).PROFILO).toBe('Si chiama Marta\nVive a Lisbona');
  await expect(shell.locator('.tab')).toHaveCount(2);

  // Campo svuotato e Invio.
  await riga(page, 'Vive a Lisbona').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('   ');
  await page.locator('.qd-campo').press('Enter');
  console.log('VUOTO', JSON.stringify({ campo: await page.locator('.qd-campo').count(), mem: (await memoria(app)).PROFILO, esito: await page.locator('#esito').textContent() }));
  if (await page.locator('.qd-campo').count()) await page.locator('.qd-campo').press('Escape');

  // Troppo lunga.
  await riga(page, 'Ama il tè').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('Ama il tè '.repeat(100));
  await page.locator('.qd-campo').press('Enter');
  await page.waitForTimeout(500);
  console.log('LUNGA', JSON.stringify({ errore: await page.locator('.qd-errore:visible').allTextContents(), mem: (await memoria(app)).PREFERENZE.length }));
  await page.locator('.qd-campo').press('Escape');

  // × mentre il campo è aperto e cambiato.
  await riga(page, 'Ama il tè').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('Ama il caffè');
  await riga(page, 'Ama il tè').hover().catch(() => {});
  const via = page.locator('.qd-riga').filter({ has: page.locator('.qd-campo') }).locator('.qd-tasto[title="Togli dalla memoria"]');
  await via.click();
  await page.waitForTimeout(800);
  console.log('XAPERTO', JSON.stringify({ mem: await memoria(app), esito: await page.locator('#esito').textContent(), righe: await page.locator('.qd-testo').allTextContents() }));
});
