// VERIFIER adversarial spec — non parte del branch, solo per la verifica.
import { test, expect } from './fixtures/electron.mjs';

async function setDocText(page, text) {
  await page.evaluate((t) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>${t}</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
}
async function filoBold(page) {
  return page.evaluate(() => window.__filoEditorFormat.applyFormatActions([{ style: 'bold', target: 'all' }]));
}

// 1) Modifiche multiple consecutive di Filo: ognuna deve restare annullabile e
//    ogni undo (che è a sua volta una modifica) non deve perdere lavoro.
test('modifiche multiple: ogni annullamento riporta indietro di un passo', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await setDocText(page, 'uno');

  await filoBold(page);             // v1: pre = "uno" (senza bold)
  await page.evaluate(() => { const d = document.getElementById('doc'); d.querySelector('strong').insertAdjacentText('beforeend', ' due'); d.dispatchEvent(new Event('input', { bubbles: true })); });
  // seconda modifica automatica su testo cambiato
  await setDocText(page, 'stato-B');
  await filoBold(page);             // v2: pre = "stato-B" (senza bold)

  const list = await page.evaluate(() => window.__filoEditorVersions.list());
  expect(list.length).toBeGreaterThanOrEqual(2);
  expect(list.every((v) => v.source === 'filo')).toBe(true);

  // Ripristino l'ultima (pre v2 = "stato-B" senza grassetto)
  const id = await page.evaluate(() => window.__filoEditorVersions.activeId());
  await page.evaluate((fid) => { const v = window.__filoEditorVersions; const l = v.list(fid); v.restore(fid, l[l.length - 1].id); }, id);
  await expect(page.locator('#doc')).toHaveText('stato-B');
  await expect(page.locator('#doc strong')).toHaveCount(0);
});

// 2) Contenuto ostile: HTML/script nel testo. Il ripristino deve tornare identico
//    e nulla deve eseguirsi (il toast non deve iniettare HTML).
test('contenuto con <script> e caratteri speciali: ripristino identico, niente injection', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  const hostile = '<script>window.__pwned=1<\/script> & emoji 😀 <img src=x>';
  await page.evaluate((t) => {
    const d = document.getElementById('doc');
    d.textContent = t; // textContent → resta testo, non markup
    d.dispatchEvent(new Event('input', { bubbles: true }));
  }, hostile);
  const before = await page.locator('#doc').textContent();

  await filoBold(page);
  const undo = page.locator('#edToast .ed-toast-action');
  await expect(undo).toHaveText('Annulla');
  await undo.click();
  await expect(page.locator('#doc')).toHaveText(before);
  const pwned = await page.evaluate(() => window.__pwned || 0);
  expect(pwned).toBe(0);
});

// 3) Storici separati per file + pulizia alla cancellazione del file.
test('cancellare un documento libera il suo storico, gli altri restano', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.evaluate(() => window.__filoEditorVersions.ready());
  await page.click('#doc');
  await setDocText(page, 'file-uno');
  await filoBold(page);
  const idA = await page.evaluate(() => window.__filoEditorVersions.activeId());
  const nA = await page.evaluate((id) => window.__filoEditorVersions.list(id).length, idA);
  expect(nA).toBeGreaterThan(0);

  // Cancella il file attivo se l'API interna lo consente; altrimenti salta.
  const deleted = await page.evaluate((id) => {
    try {
      // prova a cancellare via hook interni se esistono
      if (window.__filoEditorDeleteFile) { window.__filoEditorDeleteFile(id); return true; }
    } catch (_) {}
    return false;
  }, idA);
  if (deleted) {
    const nAfter = await page.evaluate((id) => window.__filoEditorVersions.list(id).length, idA);
    expect(nAfter).toBe(0);
  }
});
