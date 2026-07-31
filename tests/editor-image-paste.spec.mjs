// Feedback: incollando un'immagine nel foglio dell'editor questa compare subito
// ma spariva dopo il salvataggio/ricarica, perché il modello del documento
// riconosceva solo blocchi e marche di testo: un <img> non aveva nodo
// corrispondente e veniva scartato al primo salvataggio.
//
// Questi test asseriscono il SUCCESSO della feature — l'immagine è ancora nel
// foglio, con la stessa sorgente, DOPO un salvataggio + reload — non l'assenza di
// un errore. Senza il fix (serializzatore che scarta l'<img>) l'immagine sparisce
// al reload e gli assert diventano rossi.

import { test, expect } from './fixtures/electron.mjs';

// PNG 1x1 trasparente: sorgente `data:` come quella prodotta dall'incolla.
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function saveAndReload(page) {
  await page.keyboard.press('Control+s');
  await expect(page.locator('.ed-save-state')).toHaveText('Salvato');
  await page.reload();
  await page.waitForSelector('#doc');
}

test('immagine incollata tra il testo sopravvive a salvataggio e reload', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');

  // Stato post-incolla: una riga di testo, l'immagine, altra riga. L'<img> come
  // figlio diretto del foglio è ciò che il contenteditable produce spesso.
  await page.evaluate((src) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>prima riga</p><img src="${src}"><p>dopo</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, IMG);

  // Prima del save: l'immagine c'è (lo faceva già il browser).
  await expect(page.locator('#doc img')).toHaveCount(1);

  await saveAndReload(page);

  // Dopo il reload: l'immagine è ANCORA lì, con la stessa sorgente, e il testo
  // attorno è intatto. Questo è il punto che falliva.
  await expect(page.locator('#doc img')).toHaveCount(1);
  await expect(page.locator('#doc img')).toHaveAttribute('src', IMG);
  await expect(page.locator('#doc')).toContainText('prima riga');
  await expect(page.locator('#doc')).toContainText('dopo');
});

test('immagine incollata dentro un paragrafo (inline) sopravvive al reload', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await page.evaluate((src) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>testo <img src="${src}"> ancora</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, IMG);
  await saveAndReload(page);
  await expect(page.locator('#doc img')).toHaveCount(1);
  await expect(page.locator('#doc img')).toHaveAttribute('src', IMG);
  await expect(page.locator('#doc')).toContainText('testo');
  await expect(page.locator('#doc')).toContainText('ancora');
});

test('foglio con la sola immagine non viene svuotato al reload', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await page.evaluate((src) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<img src="${src}">`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, IMG);
  await saveAndReload(page);
  // Un documento con solo l'immagine (nessun testo) NON è vuoto: deve restare.
  await expect(page.locator('#doc img')).toHaveCount(1);
  await expect(page.locator('#doc img')).toHaveAttribute('src', IMG);
});

test('sorgenti immagine non ammesse vengono scartate (niente javascript:)', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await page.evaluate(() => {
    const doc = document.getElementById('doc');
    // Sorgenti fuori dalla allowlist (data:image/, http(s), blob:): non devono
    // sopravvivere al round-trip.
    doc.innerHTML = '<p>testo</p><img src="javascript:alert(1)"><img src="data:text/html,<b>x</b>">';
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await saveAndReload(page);
  await expect(page.locator('#doc img')).toHaveCount(0);
  await expect(page.locator('#doc')).toContainText('testo');
});
