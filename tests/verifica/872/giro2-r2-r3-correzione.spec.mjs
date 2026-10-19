// Verifica #872 giro 2, rilievi 2 e 3: i tasti accanto a una correzione aperta, e i rifiuti della correzione.

import { test, expect } from '../../fixtures/electron.mjs';

const QUADERNO = 'filo://quaderno/quaderno.html';
const esatto = (t) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const riga = (page, testo) => page.locator('.qd-riga').filter({ has: page.locator('.qd-testo', { hasText: esatto(testo) }) });
const memoria = (app) => app.evaluate(() => globalThis.SN_FILO_MEMORY.getMemory());

test('r2 la × accanto a una correzione aperta non salva la correzione che l\'utente stava abbandonando', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Si chiama Marta', PREFERENZE: 'Ama il tè' }));
  const page = await openTab(QUADERNO);
  await riga(page, 'Ama il tè').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('Ama il caffè');
  const aperta = page.locator('.qd-riga').filter({ has: page.locator('.qd-campo') });
  // Con il campo aperto i tasti della riga si vedono, accanto al campo.
  await expect(aperta.locator('.qd-tasti')).toHaveCSS('opacity', '1');
  await aperta.locator('.qd-tasto[title="Togli dalla memoria"]').click();
  await page.waitForTimeout(800);
  // La × chiude il campo senza scrivere la correzione: o toglie la riga, o lascia com'era. Mai «Non c'era più».
  await expect(page.locator('#esito')).not.toContainText('Non c\'era più');
  expect((await memoria(app)).PREFERENZE).not.toBe('Ama il caffè');
});

test('r3 svuotare la riga e premere Invio dice qualcosa, e il rifiuto per lunghezza parla della riga', async ({ app, shell, openTab }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  await app.evaluate(() => globalThis.SN_FILO_MEMORY.setMemory({ PROFILO: 'Vive a Lisbona', PREFERENZE: 'Ama il tè' }));
  const page = await openTab(QUADERNO);
  await riga(page, 'Vive a Lisbona').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('   ');
  await page.locator('.qd-campo').press('Enter');
  await page.waitForTimeout(400);
  const detto = `${await page.locator('#esito:visible').allTextContents()} ${await page.locator('.qd-errore:visible').allTextContents()}`.trim();
  expect(detto).not.toBe('');

  if (await page.locator('.qd-campo').count()) await page.locator('.qd-campo').press('Escape');
  await riga(page, 'Ama il tè').locator('.qd-testo').dblclick();
  await page.locator('.qd-campo').fill('Ama il tè '.repeat(100));
  await page.locator('.qd-campo').press('Enter');
  await expect(page.locator('.qd-errore:visible')).toHaveCount(1);
  await expect(page.locator('.qd-errore:visible')).not.toContainText('lezione');
});
