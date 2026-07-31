// PROBE temporaneo (audit prober): edge case sull'editor multi-file.
import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

async function renameActive(page, name) {
  const open = await page.locator('#docPop').isVisible().catch(() => false);
  if (!open) await page.click('#docSwitch');
  await page.locator('.ed-doc-item.active .ed-doc-rename').click();
  const input = page.locator('.ed-doc-item input');
  await input.fill(name);
  await input.press('Enter');
  await page.waitForTimeout(200);
}

test('probe A: ripristinare una vecchia versione riporta indietro anche il NOME', async ({ openTab }) => {
  test.setTimeout(120000);
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await setDocText(page, 'Prima stesura del racconto, ancora molto breve.');
  await renameActive(page, 'Bozza');
  console.log('PROBE titolo dopo rename 1:', await page.locator('.ed-doc-title').textContent());

  const longText = "C'era una volta, in un bosco fitto e silenzioso, una bambina che portava sempre un mantello rosso cucito dalla nonna, e ogni mattina attraversava il sentiero.";
  await setDocText(page, longText);
  const created = await page.evaluate(() => window.__filoEditorVersions.snapshotManual());
  console.log('PROBE versione creata:', JSON.stringify(!!created));

  // Rinomina DOPO la versione salvata: il nome nuovo non è versionato.
  await renameActive(page, 'Relazione finale');
  console.log('PROBE titolo dopo rename 2:', await page.locator('.ed-doc-title').textContent());

  // Continua a scrivere (così ripristinare ha senso).
  await setDocText(page, 'Testo completamente diverso, scritto dopo aver rinominato il file.');

  // Apri lo storico versioni dal menu documenti (cammino utente).
  const popOpen = await page.locator('#docPop').isVisible().catch(() => false);
  if (!popOpen) await page.click('#docSwitch');
  await page.click('#docHistory');
  await page.waitForTimeout(400);
  const items = page.locator('.ed-vh-item');
  const n = await items.count();
  console.log('PROBE versioni in storico:', n);
  const previews = await page.locator('.ed-vh-prev').allTextContents();
  console.log('PROBE preview:', JSON.stringify(previews.map((p) => p.slice(0, 70))));
  await page.screenshot({ path: 'tests/.shots/probe-vh-list.png' });

  // Ripristina la più vecchia (quella salvata quando il file si chiamava "Bozza").
  await items.nth(n - 1).locator('.ed-vh-restore').click();
  await page.waitForTimeout(600);
  console.log('PROBE titolo DOPO ripristino:', await page.locator('.ed-doc-title').textContent());
  console.log('PROBE testo DOPO ripristino:', (await page.locator('#doc').textContent()).slice(0, 90));
  await page.screenshot({ path: 'tests/.shots/probe-restore-title.png' });
});
