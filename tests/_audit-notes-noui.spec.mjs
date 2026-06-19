// TEMP audit repro — appunti salvati (SALVA_APPUNTO) senza alcuna UI per
// vederli o eliminarli. Da rimuovere dopo aver depositato il feedback.
import { test, expect } from './fixtures/electron.mjs';

async function newtabPage(app) {
  const deadline = Date.now() + 10_000;
  let win = null;
  while (Date.now() < deadline) {
    win = app.windows().find((w) => w.url().startsWith('filo://newtab'));
    if (win) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(win, 'newtab non trovata').toBeTruthy();
  await win.waitForLoadState('domcontentloaded');
  return win;
}

test('appunto salvato: persiste ma non ha alcuna UI per vederlo/eliminarlo', async ({ app, shell }) => {
  await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 8_000 });
  const page = await newtabPage(app);
  await expect(page.locator('#homeMessage')).toBeVisible({ timeout: 8_000 });

  const NOTE = 'PROMEMORIA-AUDIT-XYZ comprare il latte';

  // 1) Salva un appunto, ESATTAMENTE come fa l'azione SALVA_APPUNTO della chat.
  const add = await page.evaluate(async (text) => {
    const MSG = window.SN_MSG.MSG;
    return await new Promise((res) => {
      chrome.runtime.sendMessage({ type: MSG.FILO_ADD_NOTE, text }, (r) => res(r));
    });
  }, NOTE);
  expect(add?.ok, 'addNote dovrebbe riuscire').toBeTruthy();

  // 2) È persistito davvero (recuperabile via FILO_GET_NOTES).
  const got = await page.evaluate(async () => {
    const MSG = window.SN_MSG.MSG;
    return await new Promise((res) => {
      chrome.runtime.sendMessage({ type: MSG.FILO_GET_NOTES }, (r) => res(r));
    });
  });
  const notes = (got?.ok && got.notes) || [];
  expect(notes.some((n) => n.text === NOTE), 'l\'appunto è salvato nello store').toBeTruthy();

  // 3) Ricarica la home e dài tempo alla colonna live di popolarsi.
  await page.reload();
  await expect(page.locator('#homeMessage')).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(1500);

  // 4) DIMOSTRAZIONE DEL BUG: da nessuna parte nella UI compare l'appunto, e non
  //    esiste alcun controllo per vederlo o eliminarlo. Cerchiamo il testo
  //    dell'appunto ovunque nel DOM visibile e un eventuale pulsante di delete.
  const visibleText = await page.evaluate(() => document.body.innerText || '');
  const hasNoteAnywhere = visibleText.includes('PROMEMORIA-AUDIT-XYZ');
  const deleteControls = await page.evaluate(() => {
    // qualsiasi controllo che faccia riferimento agli appunti / note
    const all = Array.from(document.querySelectorAll('button, [role=button], a'));
    return all.filter((el) => /appunt|nota|note/i.test(el.textContent || '')).map((el) => el.textContent.trim());
  });

  await page.screenshot({ path: 'tests/.shots/audit-notes-noui.png', fullPage: true });

  console.log('[AUDIT] appunto visibile nella UI?', hasNoteAnywhere);
  console.log('[AUDIT] controlli appunti trovati:', JSON.stringify(deleteControls));
  console.log('[AUDIT] totale appunti nello store:', notes.length);

  // Il "successo" dell'audit = riprodurre il problema: appunto salvato, zero UI.
  expect(hasNoteAnywhere, 'l\'appunto NON è mostrato da nessuna parte (write-only)').toBeFalsy();
  expect(deleteControls.length, 'nessun controllo per gestire gli appunti').toBe(0);
});
