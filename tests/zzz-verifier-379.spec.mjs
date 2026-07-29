// VERIFIER #379 — black-box. L'utente scrive/cancella molto a mano e vuole poter
// tornare a un punto precedente dallo storico. Questi test guidano il PERCORSO
// REALE (digitazione da tastiera + pausa vera del debounce, NON l'hook forzato),
// più stress test (testo enorme, emoji, XSS) e il caso anti-rumore.

import { test, expect } from './fixtures/electron.mjs';

test.setTimeout(60000);

test('REAL: scrivo a mano, mi FERMO davvero, compare da sola una versione manuale ripristinabile', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  // Nessun alert deve mai comparire (guardia XSS per tutta la prova).
  let dialogFired = false;
  page.on('dialog', (d) => { dialogFired = true; d.dismiss().catch(() => {}); });

  await page.click('#doc');
  // Digitazione REALE, carattere per carattere, ben oltre la soglia anti-rumore.
  const longText = "Cammino nel bosco all'alba e il sentiero si perde tra le felci bagnate di rugiada mentre penso a tutto quello che non ho ancora scritto oggi.";
  await page.keyboard.type(longText, { delay: 2 });

  // Nessun hook: aspetto la PAUSA vera del debounce (l'utente si ferma).
  await page.waitForFunction(
    () => window.__filoEditorVersions.list().some((v) => v.source === 'manual'),
    { timeout: 12000 },
  );

  const list = await page.evaluate(() => window.__filoEditorVersions.list());
  const manual = list.filter((v) => v.source === 'manual');
  expect(manual.length).toBe(1);
  expect(manual[0].label).toMatch(/manuale/i);
  const savedId = manual[0].id;
  const fileId = await page.evaluate(() => window.__filoEditorVersions.activeId());

  // Continuo a scrivere altro a mano, poi voglio tornare al punto precedente:
  // ripristinando quella versione il documento torna ESATTAMENTE a quel testo.
  await page.click('#doc');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Delete');
  await page.keyboard.type('Tutt altra cosa scritta dopo, molto piu breve.', { delay: 2 });

  await page.evaluate(({ f, v }) => window.__filoEditorVersions.restore(f, v), { f: fileId, v: savedId });
  await expect(page.locator('#doc')).toHaveText(longText);
  expect(dialogFired).toBe(false);
});

test('REAL: micro-correzioni continue NON accumulano versioni', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  await page.keyboard.type('Una riga breve.', { delay: 3 });
  // Tante micro-correzioni con pause vere in mezzo: nessuna supera la soglia.
  for (const ch of ['!', '?', '.', ' ', 'x']) {
    await page.keyboard.type(ch, { delay: 3 });
    await page.waitForTimeout(600);
  }
  // Lascio passare oltre il debounce completo.
  await page.waitForTimeout(4500);
  const n = await page.evaluate(() => window.__filoEditorVersions.list().length);
  expect(n).toBe(0);
});

test('STRESS: testo enorme (>10k), emoji e simboli — snapshot e ripristino identici', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  await page.click('#doc');
  // Inserisco un testo enorme con emoji/simboli via input reale (dispatch input),
  // poi valuto lo snapshot come farebbe la pausa.
  const huge = ('Riga con emoji 🐺🌲✨ e simboli <>&"\' §£€ ' .repeat(400)).slice(0, 10500);
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.textContent = t;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, huge);
  await page.evaluate(() => window.__filoEditorVersions.snapshotManual());

  const fileId = await page.evaluate(() => window.__filoEditorVersions.activeId());
  const list = await page.evaluate(() => window.__filoEditorVersions.list());
  const manual = list.filter((v) => v.source === 'manual');
  expect(manual.length).toBe(1);

  // Cambio tutto, poi ripristino: deve tornare identico (emoji comprese).
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    doc.textContent = 'svuotato';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(({ f, v }) => window.__filoEditorVersions.restore(f, v), { f: fileId, v: manual[0].id });
  const restored = await page.evaluate(() => document.getElementById('doc').textContent);
  expect(restored).toBe(huge);
});

test('XSS: testo tipo <script> viene salvato/mostrato come TESTO, mai eseguito', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());

  let dialogFired = false;
  page.on('dialog', (d) => { dialogFired = true; d.dismiss().catch(() => {}); });

  await page.click('#doc');
  // Contenuto ostile come TESTO letterale (contenteditable → nodo testo).
  const payload = '<script>window.__pwned=1;alert(9)</script><img src=x onerror=alert(7)> javascript:alert(3) '.repeat(3);
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.textContent = t;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, payload);
  await page.evaluate(() => window.__filoEditorVersions.snapshotManual());

  // Apro lo storico versioni dalla UI reale e guardo l'anteprima.
  await page.click('#docSwitch');
  await page.click('#docHistory');
  await expect(page.locator('.ed-vh-item')).toHaveCount(1);
  await page.locator('.ed-vh-item').first().click();
  await expect(page.locator('.ed-vh-fulltext')).toContainText('window.__pwned=1');

  // Nessuno script eseguito, né dalla history né dalla injection.
  const pwned = await page.evaluate(() => window.__pwned === 1 || (document.querySelector('#doc') && document.querySelector('#doc script')));
  expect(!!pwned).toBe(false);
  expect(dialogFired).toBe(false);

  // Ripristino e verifico che torni il testo letterale, non eseguito.
  await page.click('#vhRestore');
  await expect(page.locator('#doc')).toContainText('<script>window.__pwned=1');
  expect(await page.evaluate(() => window.__pwned === 1)).toBe(false);
});
