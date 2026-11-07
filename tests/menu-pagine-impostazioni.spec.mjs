// #2096 — il tasto destro nelle altre pagine di Filo: una voce delle impostazioni offre «Rimetti di serie», «Spiega cosa
// fa» e «Chiedi a Filo» (Preferenze e Modelli, dallo stesso fornitore); una voce dell'elenco documenti dell'Editor apre il
// menu di QUEL documento, non di quello aperto.

import { test, expect } from './fixtures/electron.mjs';
import { menuDi } from './helpers/menuContestuale.mjs';

const etichette = (page) => menuDi(page).voci.evaluateAll((vs) => vs.map((v) => v.textContent.trim()));

test('Preferenze: «Rimetti di serie» rimette il valore, e la voce si spiega o si chiede all’Aiuto', async ({ app, openTab }) => {
  test.setTimeout(90_000);
  await app.evaluate(() => globalThis.SN_STORAGE.updateSettings({ tabPreview: { enabled: false } }));
  const page = await openTab('filo://preferences/preferences.html');
  const casella = page.locator('#tabPreviewEnabled');
  await expect(casella).not.toBeChecked({ timeout: 10_000 });

  await page.locator('label', { has: casella }).click({ button: 'right' });
  const voci = await etichette(page);
  for (const v of ['Rimetti di serie', 'Spiega cosa fa', 'Chiedi a Filo']) expect(voci).toContain(v);
  await page.screenshot({ path: 'tests/.shots/2096-preferenze-menu.png' });
  await menuDi(page).voce('Rimetti di serie').first().click();
  await expect.poll(() => app.evaluate(async () => (await globalThis.SN_STORAGE.getSettings()).tabPreview.enabled)).toBe(true);
  await expect(casella).toBeChecked();

  // «Chiedi a Filo» apre l'Aiuto con la domanda da finire, che nomina la voce.
  await page.locator('label', { has: casella }).click({ button: 'right' });
  await menuDi(page).voce('Chiedi a Filo').first().click();
  const campo = page.locator('.sn-sidebar-input textarea');
  await expect(campo).toBeVisible({ timeout: 8_000 });
  await expect(campo).toHaveValue(/^Sull'impostazione «.*Anteprima.*»: $/i);
  await expect(campo).toBeFocused();
});

test('Modelli: la stessa voce sulle impostazioni della pagina', async ({ openTab }) => {
  const page = await openTab('filo://options/options.html');
  const casella = page.locator('#useDefaultModels');
  await expect(casella).toBeAttached({ timeout: 10_000 });
  await page.locator('label', { has: casella }).first().click({ button: 'right' });
  expect(await etichette(page)).toContain('Rimetti di serie');
});

test('Editor: il tasto destro su un documento dell’elenco è di quel documento: Duplica, Rinomina, Elimina', async ({ openTab }) => {
  test.setTimeout(90_000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  // Due documenti: «primo» e quello aperto, «secondo».
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').first().locator('.ed-doc-rename').click();
  await page.locator('.ed-doc-item-input').fill('primo');
  await page.locator('.ed-doc-item-input').press('Enter');
  await page.click('#docSwitch');
  await page.click('#docSwitch');
  await page.locator('#docNew').click();
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item.active .ed-doc-rename').click();
  await page.locator('.ed-doc-item-input').fill('secondo');
  await page.locator('.ed-doc-item-input').press('Enter');
  await expect(page.locator('#docTitle')).toHaveText('secondo');
  if (await page.locator('#docPop').isHidden()) await page.click('#docSwitch');

  const primo = page.locator('.ed-doc-item', { hasText: 'primo' });
  await primo.click({ button: 'right' });
  const menu = page.locator('.ed-title-ctxmenu .sn-select-option');
  await expect(menu).toHaveText(['Apri', 'Rinomina', 'Duplica', 'Elimina']);
  await page.screenshot({ path: 'tests/.shots/2096-editor-menu-documento.png' });
  await menu.filter({ hasText: 'Duplica' }).click();
  // La copia è di «primo», non del documento aperto.
  if (await page.locator('#docPop').isHidden()) await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item', { hasText: 'primo (copia)' })).toHaveCount(1);
  await expect(page.locator('.ed-doc-item', { hasText: 'secondo (copia)' })).toHaveCount(0);

  await page.locator('.ed-doc-item', { hasText: 'primo (copia)' }).click({ button: 'right' });
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Rinomina' }).click();
  await page.locator('.ed-doc-item-input').fill('terzo');
  await page.locator('.ed-doc-item-input').press('Enter');
  if (await page.locator('#docPop').isHidden()) await page.click('#docSwitch');
  await expect(page.locator('.ed-doc-item', { hasText: 'terzo' })).toHaveCount(1);

  // Sul titolo del documento aperto resta il menu di sempre.
  await page.keyboard.press('Escape');
  await page.locator('#docSwitch').click({ button: 'right' });
  await expect(page.locator('.ed-title-ctxmenu .sn-select-option').first()).toHaveText('Rigenera titolo');
});
