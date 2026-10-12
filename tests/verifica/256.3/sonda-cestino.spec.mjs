// Sonda: la conferma sul posto del cestino dell'editor tiene ferma la sua scatola?
import { expect, test } from '../../fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

test('cestino: il secondo clic nello stesso punto di «Elimina definitivamente» elimina', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(async () => {
    localStorage.removeItem('filo.editor.trash');
    localStorage.removeItem('filo.editor.collection');
    try { await chrome.storage.local.remove('filo.editor.collection'); } catch (_) {}
  });
  await page.reload();
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await setDocText(page, 'da buttare');
  await page.click('#docSwitch');
  await page.click('#docNew');
  await setDocText(page, 'resta');
  await page.click('#docSwitch');
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await page.click('#docTrash');
  await expect(page.locator('.ed-tr-item')).toHaveCount(1);

  const purge = page.locator('.ed-tr-purge');
  const prima = await purge.boundingBox();
  const punto = { x: prima.x + prima.width * 0.3, y: prima.y + prima.height / 2 };
  await page.mouse.click(punto.x, punto.y);
  await expect(purge).toHaveText('Confermi?');
  const armato = await purge.boundingBox();
  console.log('prima', JSON.stringify(prima), 'armato', JSON.stringify(armato));
  await page.waitForTimeout(700);
  await page.mouse.click(punto.x, punto.y);
  await expect(page.locator('.ed-tr-item')).toHaveCount(0);
});
