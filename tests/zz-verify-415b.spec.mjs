// VERIFICA #415 batch 2 (temporaneo, verifier) — caccia ai punti scoperti.
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
async function openPop(page) {
  if (await page.locator('#docPop').evaluate((e) => e.hidden)) {
    await page.click('#docSwitch');
    await page.waitForSelector('#docPop:not([hidden])');
  }
}
async function newDocs(page, n) {
  for (let i = 0; i < n; i += 1) {
    await openPop(page);
    await page.locator('#docNew').click();
    await page.waitForTimeout(200);
  }
}
async function boxText(page) {
  return (await page.locator('#overlayBox').textContent().catch(() => '')) || '';
}
async function overlayHidden(page) {
  return page.locator('#overlay').evaluate((e) => e.hidden);
}

test('A) doppio clic su «Nuovo documento»: ne crea UNO solo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await openPop(page);
  const before = await page.locator('#docPop .ed-doc-item').count();
  await page.locator('#docNew').dblclick();
  await page.waitForTimeout(600);
  await openPop(page);
  const after = await page.locator('#docPop .ed-doc-item').count();
  console.log('doc', before, '→', after);
  await page.screenshot({ path: 'tests/.shots/v415b-A-nuovo-doc.png' });
  expect(after - before).toBe(1);
});

test('B) doppio clic su un modulo di «Aggiungi modulo»: non si riapre nulla', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  // apri "Aggiungi modulo" dalla via reale: doppio clic su una cella vuota
  // della griglia (o via API interna se non esiste l'affordance).
  const opened = await page.evaluate(() => {
    const cells = document.querySelectorAll('#grid .ed-cell-empty, #grid .ed-grid-empty, #grid [data-empty]');
    if (cells.length) { cells[0].click(); return 'cell'; }
    return '';
  });
  console.log('apertura via', opened || 'nessuna cella vuota');
  if (await overlayHidden(page)) test.skip(true, 'nessuna via UI per Aggiungi modulo in questo stato');
  expect(await boxText(page)).toMatch(/Aggiungi modulo/i);
  const first = page.locator('#overlayBox [data-add]').first();
  await first.dblclick();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'tests/.shots/v415b-B-aggiungi-modulo.png' });
  expect(await overlayHidden(page)).toBe(true);
});

test('C) doppio clic su «Ripristina» nel cestino: recupera un documento solo e non apre altro', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await newDocs(page, 3);
  // elimina due documenti (finiscono nel cestino)
  for (let i = 0; i < 2; i += 1) {
    await openPop(page);
    await page.locator('#docPop .ed-doc-del').first().click();
    await page.waitForTimeout(900); // oltre la finestra della guardia
  }
  await openPop(page);
  await expect(page.locator('#docTrash')).toHaveCount(1);
  await page.locator('#docTrash').click();
  await page.waitForSelector('.ed-tr-restore');
  const before = await page.locator('.ed-tr-restore').count();
  console.log('nel cestino:', before);
  await page.locator('.ed-tr-restore').first().dblclick();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/.shots/v415b-C-cestino-ripristina.png' });
  // il pannello si chiude dopo il ripristino: dietro non deve aprirsi nulla
  expect(await overlayHidden(page)).toBe(true);
  await openPop(page);
  const left = await page.locator('#docTrash').count();
  console.log('cestino ancora presente?', left);
});

test('D) doppio clic su «Elimina definitivamente»: la conferma non si brucia', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await newDocs(page, 2);
  await openPop(page);
  await page.locator('#docPop .ed-doc-del').first().click();
  await page.waitForTimeout(900);
  await openPop(page);
  await page.locator('#docTrash').click();
  await page.waitForSelector('.ed-tr-purge');
  const before = await page.locator('.ed-tr-purge').count();
  await page.locator('.ed-tr-purge').first().dblclick();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/.shots/v415b-D-purge.png' });
  const after = await page.locator('.ed-tr-purge').count();
  console.log('voci cestino', before, '→', after);
  expect(after).toBe(before); // niente cancellazione definitiva in un gesto solo
});

test('E) doppio clic su una voce del menu tasto destro del titolo: non apre due schermate', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await setDocText(page, 'testo di prova');
  await filoAutoEdit(page);
  await page.waitForTimeout(1200);
  await page.locator('#docTitle').click({ button: 'right' });
  await page.waitForSelector('.ed-title-ctxmenu');
  const item = page.locator('.ed-title-ctxmenu .sn-select-option').filter({ hasText: /^Storico versioni$/ }).first();
  await item.dblclick();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/.shots/v415b-E-ctxmenu.png' });
  const t = await boxText(page);
  console.log('overlay:', t.slice(0, 60));
  expect(t).toMatch(/Storico versioni/i);
  expect(t).not.toMatch(/Aggiungi modulo/i);
});

test('F) doppio clic su «Ripristina questa versione» nell\'anteprima', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  for (const t of ['uno', 'due', 'tre']) { await setDocText(page, t); await filoAutoEdit(page); await page.waitForTimeout(80); }
  await openPop(page);
  await page.locator('#docHistory').click();
  await page.waitForSelector('.ed-vh-list');
  await page.locator('.ed-vh-item').nth(1).click();
  await page.waitForTimeout(300);
  expect(await boxText(page)).toMatch(/Anteprima versione/i);
  const btn = page.locator('#overlayBox button').filter({ hasText: /Ripristina/i }).first();
  const vBefore = await page.evaluate(() => window.__filoEditorVersions.list().length);
  await btn.dblclick();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'tests/.shots/v415b-F-anteprima-ripristina.png' });
  const vAfter = await page.evaluate(() => window.__filoEditorVersions.list().length);
  console.log('versioni', vBefore, '→', vAfter);
  expect(vAfter - vBefore).toBeLessThanOrEqual(1);
  expect(await boxText(page)).not.toMatch(/Aggiungi modulo/i);
});

test('G) il doppio clic NORMALE resta vivo: rinomina dal menu e selezione parola', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await setDocText(page, 'parola magica qui');
  // doppio clic su una parola seleziona la parola (a inizio riga, sul testo)
  await page.locator('#doc p').dblclick({ position: { x: 18, y: 8 } });
  const sel = await page.evaluate(() => String(window.getSelection()));
  console.log('selezione:', JSON.stringify(sel));
  expect(sel.trim().length).toBeGreaterThan(0);

  // …e continua a funzionare SUBITO DOPO che qualcosa è cambiato a schermo
  // (apro e chiudo il menu documenti, poi doppio clic entro la finestra di guardia)
  await openPop(page);
  await page.keyboard.press('Escape').catch(() => {});
  await page.click('#doc');
  await page.locator('#doc p').dblclick({ position: { x: 18, y: 8 } });
  const sel2 = await page.evaluate(() => String(window.getSelection()));
  console.log('selezione dopo cambio schermo:', JSON.stringify(sel2));
  expect(sel2.trim().length).toBeGreaterThan(0);
  // rinomina inline: matita (un clic) e doppio clic sul nome
  await newDocs(page, 1);
  await openPop(page);
  const names = page.locator('#docPop .ed-doc-item-name');
  console.log('documenti:', await names.count());
  await page.locator('#docPop .ed-doc-rename').first().click();
  await page.waitForTimeout(300);
  const viaMatita = await page.locator('#docPop .ed-doc-item-input').count();
  console.log('rinomina via matita:', viaMatita);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  await openPop(page);
  await page.locator('#docPop .ed-doc-item-name').first().dblclick();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'tests/.shots/v415b-G-rinomina.png' });
  const viaDbl = await page.locator('#docPop .ed-doc-item-input').count();
  console.log('rinomina via doppio clic su doc NON attivo:', viaDbl);
  expect(viaMatita).toBeGreaterThan(0);
});
