// Esplorazione del giro 1 di #1483: i criteri della richiesta, rifatti dall'utente.
import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://transparency/transparency.html';

test('breve: link, glossario e voci della barra', async ({ openTab }) => {
  const page = await openTab(URL + '?doc=privacy');
  await expect(page.locator('#title')).toHaveText('Privacy');
  const nav = await page.locator('#nav a').allTextContents();
  expect(nav.map((s) => s.trim())).toEqual(expect.arrayContaining(['Privacy', 'Privacy, tutti i dettagli']));
  expect(nav.findIndex((s) => s.trim() === 'Privacy, tutti i dettagli')).toBe(nav.findIndex((s) => s.trim() === 'Privacy') + 1);

  const glosse = await page.locator('#doc-body .sn-gloss').evaluateAll((els) => els.map((e) => e.textContent));
  console.log('GLOSSE', JSON.stringify(glosse));
  for (const t of ['modelli di intelligenza artificiale', 'alpha', 'fornitori dei modelli', 'crediti di Filo']) {
    expect(glosse.map((g) => g.toLowerCase())).toContain(t.toLowerCase());
  }

  const alpha = page.locator('#doc-body .sn-gloss', { hasText: /^alpha$/ });
  await alpha.scrollIntoViewIfNeeded();
  await alpha.hover();
  const pop = page.locator('.sn-gloss-pop, #gloss-pop, [class*="gloss"][hidden], [class*="pop"]').filter({ hasText: 'prima fase di prova' });
  await expect(pop.first()).toBeVisible();
  await page.screenshot({ path: 'tests/.shots/1483-alpha.png' });

  await page.locator('#doc-body a', { hasText: 'Tutti i dettagli' }).click();
  await expect(page.locator('#title')).toHaveText('Privacy, tutti i dettagli');
  await expect(page).toHaveURL(/doc=privacy-completa/);
  await page.goBack();
  await expect(page.locator('#title')).toHaveText('Privacy');
  await page.locator('#doc-body a', { hasText: 'politica sui modelli' }).click();
  await expect(page.locator('#title')).toHaveText('Politica sui modelli');
  await page.screenshot({ path: 'tests/.shots/1483-models.png' });
});

test('tema scuro e completa', async ({ openTab }) => {
  const page = await openTab(URL + '?doc=privacy-completa');
  await expect(page.locator('#doc-body h2', { hasText: 'Contatori e percorsi' })).toHaveCount(1);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: 'tests/.shots/1483-completa-dark.png' });
});
