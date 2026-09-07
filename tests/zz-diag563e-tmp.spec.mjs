// TEMPORANEO — diagnosi del verificatore (#563, giro 3). Da rimuovere.
// La tendina del font viene riportata dentro la finestra all'APERTURA.
// Domanda: e se la finestra si stringe (o si zooma) MENTRE è aperta?
import { test, expect } from './fixtures/electron.mjs';

const EDITOR = 'filo://editor/';

test('tendina font: finestra stretta a tendina APERTA', async ({ openTab }) => {
  const page = await openTab(EDITOR);
  await page.waitForSelector('.ed-grid');
  await page.setViewportSize({ width: 1280, height: 800 });

  // Aggiunge il modulo font (stessa via dello spec vero).
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button, .ed-add, [data-add]')]
      .find((x) => /font/i.test(x.textContent || x.dataset.add || ''));
    if (b) b.click();
  });
  const mod = page.locator('.ed-module[data-type="font"]');
  if (!(await mod.count())) {
    console.log('DIAG: nessun modulo font, provo la palette');
    const palette = page.locator('[data-type="font"]');
    console.log('DIAG palette count', await palette.count());
  }
  await expect(mod.first()).toBeVisible({ timeout: 8000 });
  await mod.first().locator('.ed-font-button').click();
  await expect(page.locator('.ed-font-pop')).toBeVisible();

  const prima = await page.evaluate(() => {
    const p = document.querySelector('.ed-font-pop').getBoundingClientRect();
    return { vw: innerWidth, left: p.left, right: p.right, zoom: devicePixelRatio };
  });
  console.log('DIAG prima:', JSON.stringify(prima));

  // La finestra si stringe mentre la tendina è aperta.
  await page.setViewportSize({ width: 520, height: 800 });
  await page.waitForTimeout(600);
  const dopo = await page.evaluate(() => {
    const el = document.querySelector('.ed-font-pop');
    if (!el || el.hidden) return { chiusa: true };
    const p = el.getBoundingClientRect();
    return { chiusa: false, vw: innerWidth, left: p.left, right: p.right };
  });
  console.log('DIAG dopo restringimento:', JSON.stringify(dopo));

  // Zoom della pagina a tendina aperta.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  const el2 = page.locator('.ed-font-pop');
  if (!(await el2.isVisible())) {
    await mod.first().locator('.ed-font-button').click();
    await expect(el2).toBeVisible();
  }
  await page.evaluate(() => { document.body.style.zoom = ''; });
  const zoomInfo = await page.evaluate(async () => {
    const el = document.querySelector('.ed-font-pop');
    if (!el || el.hidden) return { chiusa: true };
    const p = el.getBoundingClientRect();
    return { chiusa: false, vw: innerWidth, left: p.left, right: p.right };
  });
  console.log('DIAG zoom:', JSON.stringify(zoomInfo));
});
