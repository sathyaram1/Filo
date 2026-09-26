import { test } from '../../fixtures/electron.mjs';

test('foto elenco scorciatoie', async ({ openTab }) => {
  const page = await openTab('filo://options/altro.html');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/.shots/685-scorciatoie.png', fullPage: true });
  const testo = await page.evaluate(() => {
    const el = document.getElementById('shortcutsList');
    return el ? el.innerText : 'NIENTE';
  });
  console.log('ELENCO>>>', JSON.stringify(testo));
});
