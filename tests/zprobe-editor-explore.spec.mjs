// SPEC TEMPORANEO DI AUDIT (prober) — non va committato come test permanente.

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

async function rename(page, idx, name) {
  await openPop(page);
  await page.locator('.ed-doc-item').nth(idx).locator('.ed-doc-rename').click();
  await page.locator('.ed-doc-item-input').fill(name);
  await page.keyboard.press('Enter');
}

test('REPRO: due eliminazioni ravvicinate — il primo documento è perso per sempre', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  await setDocText(page, 'TESTO DELLA TESI');
  await rename(page, 0, 'Tesi');

  await openPop(page);
  await page.click('#docNew');
  await setDocText(page, 'TESTO DELLA SPESA');
  await rename(page, 1, 'Spesa');

  await openPop(page);
  await page.click('#docNew');
  await setDocText(page, 'TESTO DEGLI APPUNTI');
  await rename(page, 2, 'Appunti');

  await openPop(page);
  await expect(page.locator('.ed-doc-item')).toHaveCount(3);

  // L'utente elimina due documenti di fila (uno per sbaglio).
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();  // Tesi
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'tests/.shots/probe-del1.png' });
  await openPop(page);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();  // Spesa
  await page.waitForTimeout(200);

  // Il toast parla solo dell'ULTIMO eliminato.
  console.log('TOAST:', JSON.stringify(await page.locator('#edToast').innerText()));
  await page.screenshot({ path: 'tests/.shots/probe-editor-doppia-eliminazione.png' });

  // Annulla → torna solo "Spesa". "Tesi" non è più recuperabile in nessun modo.
  await page.locator('.ed-toast-action').click();
  await page.waitForTimeout(300);
  await openPop(page);
  let names = await page.locator('.ed-doc-item-name').allInnerTexts();
  console.log('DOPO ANNULLA:', JSON.stringify(names));
  console.log('altri Annulla:', await page.locator('.ed-toast-action').count());

  // Anche dopo un reload: "Tesi" e il suo testo sono spariti.
  await page.keyboard.press('Control+s');
  await page.reload();
  await page.waitForSelector('#doc');
  await openPop(page);
  names = await page.locator('.ed-doc-item-name').allInnerTexts();
  console.log('DOPO RELOAD:', JSON.stringify(names));
  const all = await page.evaluate(() => {
    const raw = localStorage.getItem('sn_editor_collection') || localStorage.getItem('snEditorCollection');
    return raw ? raw.slice(0, 600) : Object.keys(localStorage);
  });
  console.log('STORAGE:', JSON.stringify(all).slice(0, 800));
  expect(names.join('|')).not.toContain('Tesi');
});

test('probe: elimina l\'unico documento e annulla', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await setDocText(page, 'UNICO');
  await rename(page, 0, 'Solo');
  await openPop(page);
  await page.locator('.ed-doc-item').nth(0).locator('.ed-doc-del').click();
  await page.waitForTimeout(200);
  console.log('dopo delete unico, doc:', JSON.stringify(await page.locator('#doc').innerText()));
  await page.locator('.ed-toast-action').click();
  await page.waitForTimeout(300);
  console.log('dopo annulla, doc:', JSON.stringify(await page.locator('#doc').innerText()));
  await openPop(page);
  console.log('file:', JSON.stringify(await page.locator('.ed-doc-item-name').allInnerTexts()));
});
