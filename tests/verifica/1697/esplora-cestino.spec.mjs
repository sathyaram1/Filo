// Esplorazione (si cancella): la conferma di «Elimina definitivamente» tiene ferma la scatola, e il secondo clic elimina.
import { test, expect } from '../../fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}

for (const tema of ['light', 'dark']) {
  test(`cestino: secondo clic nel terzo sinistro elimina (${tema})`, async ({ openTab }) => {
    const page = await openTab('filo://editor/editor.html');
    await page.waitForSelector('#doc');
    await page.evaluate((t) => { localStorage.removeItem('filo.editor.trash'); document.documentElement.dataset.snTheme = t; }, tema);
    await page.click('#doc');
    await setDocText(page, 'contenuto ALFA');
    await page.click('#docSwitch');
    await page.click('#docNew');
    await setDocText(page, 'contenuto BETA');
    await page.click('#docSwitch');
    await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
    await page.click('#docTrash');
    const purge = page.locator('.ed-tr-purge');
    const b0 = await purge.boundingBox();
    const x = b0.x + b0.width / 6, y = b0.y + b0.height / 2;
    await page.mouse.click(x, y);
    await expect(purge).toHaveText('Confermi?');
    const b1 = await purge.boundingBox();
    console.log(tema, JSON.stringify({ b0, b1 }));
    await page.screenshot({ path: `tests/.shots/v1697-cestino-${tema}.png` });
    expect(Math.abs(b1.width - b0.width)).toBeLessThan(1);
    expect(Math.abs(b1.x - b0.x)).toBeLessThan(1);
    await page.waitForTimeout(600);
    await page.mouse.click(x, y);
    await expect(page.locator('.ed-tr-item')).toHaveCount(0);
    const testi = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('filo.editor.collection')).files.map((f) => f.content)));
    expect(testi).not.toContain('ALFA');
  });
}
