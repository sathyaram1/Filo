// VERIFIER (black-box, adversarial). Sintomo utente: incollo un'immagine nel
// foglio dell'editor, la vedo, ma sparisce al salvataggio + reload.
// Qui provo a ROMPERE il fix con input ostili/limite, non solo l'happy path.
// File temporaneo del verificatore: non fa parte del lavoro del risolutore.

import { test, expect } from './fixtures/electron.mjs';

const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function saveAndReload(page) {
  await page.keyboard.press('Control+s');
  await expect(page.locator('.ed-save-state')).toHaveText('Salvato');
  await page.reload();
  await page.waitForSelector('#doc');
}

// XSS: un <img> con src AMMESSA (data:image) ma con handler onerror ostile.
// La src passa la allowlist quindi l'immagine deve sopravvivere, MA l'onerror
// non deve sopravvivere al round-trip né eseguire codice quando il foglio si
// ricostruisce dopo il reload.
test('onerror ostile su immagine ammessa non sopravvive e non esegue', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await page.evaluate((src) => {
    window.__pwned = false;
    const doc = document.getElementById('doc');
    // src valida per forzare la sopravvivenza dell'<img>; onerror ostile.
    doc.innerHTML = `<p>ciao</p><img src="${src}" onerror="window.__pwned=true">`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, IMG);
  await saveAndReload(page);
  // L'immagine (src ammessa) resta...
  await expect(page.locator('#doc img')).toHaveCount(1);
  await expect(page.locator('#doc img')).toHaveAttribute('src', IMG);
  // ...ma senza attributo onerror e senza aver eseguito codice.
  const onerr = await page.locator('#doc img').getAttribute('onerror');
  expect(onerr).toBeNull();
  const pwned = await page.evaluate(() => window.__pwned === true);
  expect(pwned).toBe(false);
});

// Immagine remota http(s): src ammessa, deve persistere identica al reload
// (indipendentemente dal fatto che l'host risponda o meno: conta la persistenza
// della sorgente nel documento).
test('immagine con URL http(s) persiste al reload', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  const url = 'https://example.com/foto.png';
  await page.evaluate((u) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>prima</p><img src="${u}"><p>dopo</p>`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, url);
  await saveAndReload(page);
  await expect(page.locator('#doc img')).toHaveCount(1);
  await expect(page.locator('#doc img')).toHaveAttribute('src', url);
  await expect(page.locator('#doc')).toContainText('prima');
  await expect(page.locator('#doc')).toContainText('dopo');
});

// Molte immagini nello stesso foglio: tutte devono sopravvivere, nell'ordine.
test('molte immagini nello stesso foglio sopravvivono tutte', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await page.evaluate((src) => {
    const doc = document.getElementById('doc');
    let html = '';
    for (let i = 0; i < 8; i++) html += `<p>r${i}</p><img src="${src}">`;
    doc.innerHTML = html;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, IMG);
  await saveAndReload(page);
  await expect(page.locator('#doc img')).toHaveCount(8);
});

// Mix ostile: src valide + src fuori allowlist + tag <script>. Solo le valide
// sopravvivono; niente script, niente esecuzione.
test('mix di sorgenti valide e ostili: sopravvivono solo le valide', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await page.evaluate((src) => {
    window.__ran = false;
    const doc = document.getElementById('doc');
    doc.innerHTML =
      `<p>testo</p>` +
      `<img src="${src}">` +                                   // valida
      `<img src="javascript:window.__ran=true">` +             // ostile
      `<img src="data:text/html,<script>1</script>">` +        // ostile
      `<img src="vbscript:msgbox(1)">` +                        // ostile
      `<img src="">`;                                           // vuota
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, IMG);
  await saveAndReload(page);
  await expect(page.locator('#doc img')).toHaveCount(1);
  await expect(page.locator('#doc img')).toHaveAttribute('src', IMG);
  await expect(page.locator('#doc')).toContainText('testo');
  expect(await page.evaluate(() => window.__ran === true)).toBe(false);
});

// Traccia visiva: foglio con immagine dopo il reload.
test('traccia visiva foglio con immagine', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await page.waitForSelector('#doc');
  await page.click('#doc');
  await page.evaluate((src) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = `<p>Screenshot immagine nel foglio</p><img src="${src}" style="width:120px">`;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, IMG);
  await saveAndReload(page);
  await page.screenshot({ path: 'tests/.shots/verifier-editor-image.png' });
  await expect(page.locator('#doc img')).toHaveCount(1);
});
