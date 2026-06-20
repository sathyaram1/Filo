// AUDIT (routine, throwaway): esercita il modulo "Cerca e sostituisci"
// dell'editor con testo a parole ripetute e verifica che find + replace-all
// facciano la cosa giusta (highlight, conteggio, sostituzione, persistenza).
import { test, expect } from './fixtures/electron.mjs';

test('editor find & replace: highlight + sostituisci tutto', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');

  // Scrivi un documento con la parola "alpha" ripetuta 3 volte.
  await page.click('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.innerHTML = '<p>alpha beta alpha gamma alpha</p>';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Passa a pagina 1 dove vive il modulo Cerca e sostituisci.
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('.ed-module[data-type="search-replace"]');

  const find = page.locator('[data-sr="find"]');
  const repl = page.locator('[data-sr="repl"]');
  const count = page.locator('[data-sr="count"]');

  // Cerca "alpha": attesi 3 hit, conteggio "1/3".
  await find.fill('alpha');
  await page.waitForTimeout(200);
  console.log('COUNT after find >>>', await count.textContent());
  const hits = await page.locator('#doc mark.ed-find-hit').count();
  console.log('HIGHLIGHTS >>>', hits);
  await page.screenshot({ path: 'tests/.shots/audit-find-replace.png' }).catch(() => {});

  // Sostituisci tutto con "GAMMA".
  await repl.fill('OMEGA');
  await page.locator('[data-sr="all"]').click();
  await page.waitForTimeout(300);

  const text = await page.locator('#doc').innerText();
  console.log('DOC TEXT after replace-all >>>', JSON.stringify(text));

  // Verifica persistenza: leggi localStorage del documento salvato.
  const saved = await page.evaluate(() => {
    // STORAGE_KEY interno: cerca la chiave dell'editor
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.toLowerCase().includes('editor')) return localStorage.getItem(k);
    }
    return null;
  });
  console.log('SAVED has ed-find-hit >>>', saved ? saved.includes('ed-find-hit') : 'no-key');
  console.log('SAVED snippet >>>', saved ? saved.slice(0, 400) : 'null');

  // Asserzioni di SUCCESSO: nessun "alpha" deve restare, 3 "OMEGA" presenti.
  expect(hits).toBe(3);
  expect(text).not.toContain('alpha');
  expect((text.match(/OMEGA/g) || []).length).toBe(3);
});
