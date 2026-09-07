// TEMPORANEO — diagnosi del verificatore (#563, giro 3). Da rimuovere.
// La tendina del font viene riportata dentro la finestra all'APERTURA.
// Domanda: e se la finestra si stringe (o si zooma) MENTRE è aperta?
import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/';

test('tendina font: finestra stretta a tendina APERTA', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.locator('.ed-cell-empty').first().click();
  await page.locator('.ed-overlay [data-add="font"]').click();
  await page.waitForSelector('.ed-module[data-type="font"]');

  const mod = page.locator('.ed-module[data-type="font"]');
  await mod.locator('.ed-font-button').click();
  await expect(page.locator('.ed-font-pop')).toBeVisible();

  const leggi = () => page.evaluate(() => {
    const el = document.querySelector('.ed-font-pop');
    if (!el || el.hidden) return { chiusa: true };
    const p = el.getBoundingClientRect();
    return { chiusa: false, vw: innerWidth, left: Math.round(p.left), right: Math.round(p.right), zoom: devicePixelRatio };
  });

  console.log('DIAG prima:', JSON.stringify(await leggi()));

  // (A) La finestra si stringe mentre la tendina è aperta.
  await page.setViewportSize({ width: 520, height: 800 });
  await page.waitForTimeout(700);
  console.log('DIAG dopo restringimento:', JSON.stringify(await leggi()));

  // (B) Zoom della pagina a tendina aperta (in Filo si zooma di continuo).
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  if (!(await page.locator('.ed-font-pop').isVisible())) {
    await mod.locator('.ed-font-button').click();
    await expect(page.locator('.ed-font-pop')).toBeVisible();
  }
  console.log('DIAG prima dello zoom:', JSON.stringify(await leggi()));
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await page.waitForTimeout(500);
  console.log('DIAG dopo zoom 200%:', JSON.stringify(await leggi()));
});
