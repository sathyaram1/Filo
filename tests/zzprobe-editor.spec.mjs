// PROBE temporaneo (audit prober): edge case sull'editor multi-file.
import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

// Rinomina il documento attivo dal menu documenti (matita).
async function renameActive(page, name) {
  await page.click('#docSwitch');
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

  await page.click('#doc');
  await setDocText(page, 'prima stesura del testo');
  await renameActive(page, 'Bozza');
  console.log('PROBE titolo dopo rename 1:', await page.locator('.ed-doc-title').textContent());

  // Crea una versione: simuliamo una modifica di Filo registrando lo stato.
  await page.evaluate(() => window.__edTestHooks && 1);
  // Snapshot manuale: scrivi molto testo, poi forza una versione cambiando doc.
  await setDocText(page, 'prima stesura del testo. ' + 'Aggiunta molto lunga di testo per superare la soglia degli snapshot manuali. '.repeat(4));
  await page.waitForTimeout(2500); // debounce snapshot manuale

  // Rinomina DOPO la versione salvata.
  await renameActive(page, 'Relazione finale');
  console.log('PROBE titolo dopo rename 2:', await page.locator('.ed-doc-title').textContent());

  // Apri lo storico versioni.
  await page.click('#docSwitch');
  await page.click('#docHistory');
  await page.waitForTimeout(400);
  const items = page.locator('.ed-vh-item');
  const n = await items.count();
  console.log('PROBE versioni in storico:', n);
  if (n) {
    const previews = await page.locator('.ed-vh-prev').allTextContents();
    console.log('PROBE preview:', JSON.stringify(previews.map((p) => p.slice(0, 60))));
    // Ripristina la PIÙ VECCHIA
    await items.nth(n - 1).locator('.ed-vh-restore').click();
    await page.waitForTimeout(500);
    console.log('PROBE titolo DOPO ripristino:', await page.locator('.ed-doc-title').textContent());
    console.log('PROBE testo DOPO ripristino:', (await page.locator('#doc').textContent()).slice(0, 80));
    await page.screenshot({ path: 'tests/.shots/probe-restore-title.png' });
  }
});
