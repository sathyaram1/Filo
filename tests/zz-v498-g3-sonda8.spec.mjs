// Sonda 8 — il solo riquadro di sola lettura in cima, senza altro.
import { test, expect } from './fixtures/electron.mjs';
const URL = 'filo://manage/manage.html';
const setSize = (app, w, h) => app.evaluate(async ({ BrowserWindow }, [a, b]) => {
  const win = BrowserWindow.getAllWindows()[0]; if (win) win.setContentSize(a, b);
}, [w, h]);
const geo = (page) => page.evaluate(() => {
  const doc = document.documentElement;
  const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
  return {
    gridH: Math.round(g.height),
    fuori: Math.round(g.bottom) - doc.clientHeight,
    scroll: doc.scrollHeight - doc.clientHeight,
    viewport: doc.clientHeight,
  };
});

test('sonda8: solo banner', async ({ app, openTab }) => {
  test.setTimeout(120000);
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = false; });
  await page.waitForTimeout(300);
  for (const [w, h] of [[1280, 800], [1200, 600], [900, 560], [720, 470]]) {
    await setSize(app, w, h); await page.waitForTimeout(400);
    console.log(`BANNER ${w}x${h}`, JSON.stringify(await geo(page)));
  }
  await page.locator('#mgSearchToggle').click(); await page.waitForTimeout(300);
  for (const [w, h] of [[1200, 600], [900, 560], [720, 520], [720, 470]]) {
    await setSize(app, w, h); await page.waitForTimeout(400);
    console.log(`BANNER+RICERCA ${w}x${h}`, JSON.stringify(await geo(page)));
  }
  // e la riga "sezioni non disegnabili" in più
  await page.evaluate(() => {
    const p = document.getElementById('mgNoSections');
    p.hidden = false;
    p.textContent = 'Le segnalazioni sono cifrate: su questo computer manca la chiave, quindi le sezioni non si disegnano.';
  });
  for (const [w, h] of [[1200, 600], [900, 560], [720, 470]]) {
    await setSize(app, w, h); await page.waitForTimeout(400);
    console.log(`BANNER+STATO+RICERCA ${w}x${h}`, JSON.stringify(await geo(page)));
  }
});
