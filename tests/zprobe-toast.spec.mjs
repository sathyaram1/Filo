// SPEC TEMPORANEO DI AUDIT (prober).
import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}
async function openPop(page) {
  const hidden = await page.locator('#docPop').evaluate((el) => el.hidden);
  if (hidden) await page.click('#docSwitch');
  await expect(page.locator('#docPop')).toBeVisible();
}

test('probe: un avviso qualsiasi dopo l\'eliminazione cancella l\'Annulla', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await setDocText(page, 'CONTENUTO IMPORTANTE');
  await openPop(page);
  await page.click('#docNew');           // secondo file vuoto (attivo)
  await openPop(page);
  // elimina il PRIMO file (quello col contenuto)
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await page.waitForTimeout(200);
  console.log('toast dopo delete:', JSON.stringify(await page.locator('#edToast').innerText()));

  // Ora un avviso qualunque: "Rigenera riassunto" su un file vuoto.
  await page.locator('#docTitle').click({ button: 'right' });
  await page.waitForTimeout(200);
  await page.locator('.ed-title-ctxmenu .sn-select-option', { hasText: 'Rigenera riassunto' }).click();
  await page.waitForTimeout(600);
  console.log('toast dopo altro avviso:', JSON.stringify(await page.locator('#edToast').innerText()));
  console.log('pulsanti Annulla rimasti:', await page.locator('.ed-toast-action').count());
  await page.screenshot({ path: 'tests/.shots/probe-toast-overwrite.png' });
});
