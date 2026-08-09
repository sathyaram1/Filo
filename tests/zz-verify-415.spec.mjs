// VERIFICA #415 (temporaneo, verifier) — doppio clic nell'editor.
import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}
async function filoAutoEdit(page) {
  return page.evaluate(() => window.__filoEditorFormat.applyFormatActions([{ style: 'bold', target: 'all' }]));
}

// Crea N versioni facendo modifiche automatiche di Filo con testi diversi.
async function makeVersions(page, texts) {
  for (const t of texts) {
    await setDocText(page, t);
    await filoAutoEdit(page);
    await page.waitForTimeout(60);
  }
}

async function openHistory(page) {
  await page.click('#docsBtn').catch(() => {});
  await page.waitForTimeout(150);
}

test('1) doppio clic su Ripristina: nessuna anteprima a sorpresa, si resta nella lista', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await makeVersions(page, ['alfa uno', 'beta due', 'gamma tre']);

  // Apri lo storico versioni come farebbe l'utente.
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button, [role="button"], .ed-menu-item, li')];
    const b = btns.find((x) => /storico versioni/i.test(x.textContent || ''));
    if (b) b.click();
  });
  const opened = await page.locator('.ed-vh-list').count();
  console.log('storico aperto via testo?', opened);
  if (!opened) {
    // fallback: apri il menu documenti prima
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('*')].find((x) => x.id && /docs|files|title/i.test(x.id) && x.tagName === 'BUTTON');
      if (t) t.click();
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button, [role="button"], .ed-menu-item, li, div')];
      const b = btns.find((x) => /^\s*storico versioni\s*$/i.test(x.textContent || ''));
      if (b) b.click();
    });
  }
  await expect(page.locator('.ed-vh-list')).toHaveCount(1);
  const nRows = await page.locator('.ed-vh-item').count();
  console.log('righe versioni:', nRows);
  expect(nRows).toBeGreaterThan(1);

  const restore = page.locator('.ed-vh-restore').nth(1);
  await restore.dblclick();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v415-1-dopo-dblclick-ripristina.png' });
  // Deve restare nella LISTA, non nell'anteprima.
  expect(await page.locator('.ed-vh-list').count()).toBe(1);
  expect(await page.locator('.ed-vh-preview, .ed-vh-prevbox').count()).toBe(0);
  const bodyTxt = await page.locator('#ovBox, .ed-overlay-box').first().textContent();
  expect(bodyTxt).not.toMatch(/Anteprima versione/i);
});
