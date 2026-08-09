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
async function makeVersions(page, texts) {
  for (const t of texts) {
    await setDocText(page, t);
    await filoAutoEdit(page);
    await page.waitForTimeout(80);
  }
}
async function openHistory(page) {
  await page.click('#docSwitch');
  await page.waitForSelector('#docPop:not([hidden])');
  await page.locator('#docPop .ed-doc-pop-item, #docPop > *').filter({ hasText: /^Storico versioni$/ }).first().click();
  await page.waitForSelector('.ed-vh-list');
}
async function boxText(page) {
  return (await page.locator('#overlayBox').textContent()) || '';
}

test('1) doppio clic su «Ripristina»: si resta nella lista, nessuna anteprima a sorpresa', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await makeVersions(page, ['alfa uno', 'beta due', 'gamma tre']);
  await openHistory(page);
  expect(await page.locator('.ed-vh-item').count()).toBeGreaterThan(1);

  const versBefore = await page.evaluate(() => window.__filoEditorVersions.list().length);
  await page.locator('.ed-vh-restore').nth(1).dblclick();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v415-1-ripristina-dblclick.png' });
  const t = await boxText(page);
  expect(t).not.toMatch(/Anteprima versione/i);
  expect(await page.locator('.ed-vh-list').count()).toBe(1);
  // un solo ripristino → una sola nuova versione di sicurezza
  const versAfter = await page.evaluate(() => window.__filoEditorVersions.list().length);
  expect(versAfter - versBefore).toBeLessThanOrEqual(1);
});

test('2) doppio clic su «Chiudi» dello storico: non si apre nulla dietro', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await makeVersions(page, ['uno', 'due']);
  await openHistory(page);
  await page.locator('#ovClose').dblclick();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'tests/.shots/v415-2-chiudi-dblclick.png' });
  const hidden = await page.locator('#overlay').evaluate((e) => e.hidden);
  expect(hidden).toBe(true);
});

test('3) doppio clic sulla × di un documento nel menu: ne elimina UNO solo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  // crea 4 documenti
  for (let i = 0; i < 3; i += 1) {
    await page.click('#docSwitch');
    await page.waitForSelector('#docPop:not([hidden])');
    await page.locator('#docPop > *').filter({ hasText: /Nuovo documento/ }).first().click();
    await page.waitForTimeout(200);
  }
  await page.click('#docSwitch');
  await page.waitForSelector('#docPop:not([hidden])');
  const before = await page.locator('#docPop .ed-doc-item').count();
  console.log('documenti nel menu prima:', before);
  await page.locator('#docPop .ed-doc-del').first().dblclick();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/v415-3-x-dblclick.png' });
  if (await page.locator('#docPop').evaluate((e) => e.hidden)) {
    await page.click('#docSwitch');
    await page.waitForSelector('#docPop:not([hidden])');
  }
  const after = await page.locator('#docPop .ed-doc-item').count();
  console.log('documenti nel menu dopo:', after);
  expect(before - after).toBe(1);
});

test('4) doppio clic su «Annulla» di un avviso: l\'annullamento regge', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await setDocText(page, 'Cappuccetto Rosso');
  const before = await page.locator('#doc').textContent();
  await filoAutoEdit(page);
  await expect(page.locator('#doc strong')).toHaveCount(1);
  const undo = page.locator('.ed-toast .ed-toast-action').last();
  await expect(undo).toHaveText('Annulla');
  await undo.dblclick();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/v415-4-annulla-dblclick.png' });
  await expect(page.locator('#doc strong')).toHaveCount(0);
  await expect(page.locator('#doc')).toHaveText(before.trim());
});

test('5) clic voluti ripetuti (lenti) continuano a funzionare', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await makeVersions(page, ['aaa', 'bbb', 'ccc']);
  await openHistory(page);
  // clic singolo su una riga → si apre l'anteprima (comportamento voluto)
  await page.locator('.ed-vh-item').nth(1).click();
  await page.waitForTimeout(300);
  expect(await boxText(page)).toMatch(/Anteprima versione/i);
  // torna indietro con un clic voluto
  const back = page.locator('#overlayBox button').filter({ hasText: /Indietro/i }).first();
  await back.click();
  await page.waitForTimeout(300);
  expect(await page.locator('.ed-vh-list').count()).toBe(1);
  // due ripristini distinti, lenti, devono funzionare entrambi
  const v0 = await page.evaluate(() => window.__filoEditorVersions.list().length);
  await page.locator('.ed-vh-restore').nth(0).click();
  await page.waitForTimeout(1500);
  await page.locator('.ed-vh-restore').nth(0).click();
  await page.waitForTimeout(600);
  const v1 = await page.evaluate(() => window.__filoEditorVersions.list().length);
  console.log('versioni', v0, '→', v1);
  expect(v1).toBeGreaterThan(v0);
});
