// Sonde extra #385 (verifier, temporanee): casi che potrebbero ancora rompersi.
import { test, expect } from './fixtures/electron.mjs';

async function setupDoc(page, html) {
  await page.waitForSelector('#doc');
  await page.evaluate((h) => {
    const doc = document.getElementById('doc');
    doc.innerHTML = h;
    doc.dispatchEvent(new Event('input', { bubbles: true }));
  }, html);
  await page.locator('.ed-switch-icon').nth(1).click();
  await page.waitForSelector('[data-sr="find"]');
}
async function clickArrow(page, label) {
  await page.evaluate((lb) => {
    const h = [...document.querySelectorAll('#doc h1, #doc h2, #doc h3')]
      .find((x) => x.textContent.includes(lb));
    h.querySelector('.ed-collapse-toggle').click();
  }, label);
}
async function curBox(page) {
  return page.evaluate(() => {
    const mk = document.querySelector('#doc mark.ed-find-hit.current');
    if (!mk) return { w: -1 };
    const r = mk.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
}

// A) match dentro una LISTA / citazione annidata in sezione chiusa
test('probe A: match dentro lista e citazione in sezione chiusa', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>Chiusa</h2><ul><li>voce con ornitorinco</li></ul>'
    + '<blockquote><p>citazione con ornitorinco</p></blockquote>');
  await clickArrow(page, 'Chiusa');
  await page.fill('[data-sr="find"]', 'ornitorinco');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/2');
  expect((await curBox(page)).w).toBeGreaterThan(0);
  await page.click('[data-sr="next"]');
  expect((await curBox(page)).w).toBeGreaterThan(0);
});

// B) match nel TITOLO di una sotto-sezione a sua volta nascosta da un capitolo chiuso
test('probe B: match nel titolo di una sotto-sezione nascosta', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h1>Libro</h1><p>intro</p><h2>Capitolo ornitorinco</h2><p>testo</p>');
  await clickArrow(page, 'Libro');
  await expect(page.locator('#doc h2')).toBeHidden();
  await page.fill('[data-sr="find"]', 'ornitorinco');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  expect((await curBox(page)).w).toBeGreaterThan(0);
});

// C) digitazione carattere per carattere: quante sezioni chiuse si aprono per strada?
test('probe C: ricerca incrementale non spalanca sezioni non pertinenti', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>S1</h2><p>ottimo risultato</p>'
    + '<h2>S2</h2><p>orso bruno</p>'
    + '<h2>S3</h2><p>qui vive ornitorinco</p>');
  for (const s of ['S1', 'S2', 'S3']) await clickArrow(page, s);
  await page.click('[data-sr="find"]');
  await page.keyboard.type('ornitorinco', { delay: 30 });
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  const open = await page.evaluate(() => [...document.querySelectorAll('#doc h2')]
    .filter((h) => h.dataset.collapsed !== '1').map((h) => h.textContent.trim()));
  console.log('SEZIONI APERTE DOPO DIGITAZIONE INCREMENTALE:', JSON.stringify(open));
  expect((await curBox(page)).w).toBeGreaterThan(0);
});

// D) "Sostituisci tutto" con termine che compare SOLO in sezioni chiuse annidate a più livelli
test('probe D: sostituisci tutto su piu livelli annidati chiusi', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h1>L</h1><p>x1 tigre</p><h2>C</h2><p>x2 tigre</p><h3>P</h3><p>x3 tigre</p>');
  await clickArrow(page, 'P');
  await clickArrow(page, 'C');
  await clickArrow(page, 'L');
  await page.fill('[data-sr="find"]', 'tigre');
  await page.fill('[data-sr="repl"]', 'leone');
  await page.click('[data-sr="all"]');
  for (const t of ['x1 leone', 'x2 leone', 'x3 leone']) {
    await expect(page.locator('#doc p', { hasText: t })).toBeVisible();
  }
});

// E) lo stato riaperto sopravvive al reload/serializzazione del documento
test('probe E: dopo reveal+replace il documento salvato non ha righe nascoste', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>Chiusa</h2><p>alfa qui</p>');
  await clickArrow(page, 'Chiusa');
  await page.fill('[data-sr="find"]', 'alfa');
  await page.fill('[data-sr="repl"]', 'beta');
  await page.click('[data-sr="all"]');
  const html = await page.evaluate(() => document.getElementById('doc').innerHTML);
  console.log('HTML SALVATO:', html);
  expect(html).not.toContain('ed-hidden-by-collapse');
  expect(html).not.toContain('data-collapsed="1"');
  expect(html).toContain('beta qui');
});

// F) termine che matcha il titolo stesso di una sezione chiusa (freccia inclusa nel DOM del titolo)
test('probe F: match sul titolo di una sezione chiusa e successiva sostituzione', async ({ openTab }) => {
  const page = await openTab('filo://editor/editor.html');
  await setupDoc(page, '<h2>Capitolo segreto</h2><p>testo dentro</p>');
  await clickArrow(page, 'Capitolo segreto');
  await page.fill('[data-sr="find"]', 'segreto');
  await expect(page.locator('[data-sr="count"]')).toHaveText('1/1');
  expect((await curBox(page)).w).toBeGreaterThan(0);
  await page.fill('[data-sr="repl"]', 'pubblico');
  await page.click('[data-sr="all"]');
  await expect(page.locator('#doc h2')).toContainText('Capitolo pubblico');
  // la freccia del titolo non deve essere stata mangiata dalla sostituzione
  await expect(page.locator('#doc h2 .ed-collapse-toggle')).toHaveCount(1);
  // e la sezione deve essere ancora richiudibile
  await clickArrow(page, 'Capitolo pubblico');
  await expect(page.locator('#doc p', { hasText: 'testo dentro' })).toBeHidden();
});
