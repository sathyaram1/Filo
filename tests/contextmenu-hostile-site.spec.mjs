import { test, expect } from './fixtures/electron.mjs';

// Feedback alpha: «il tasto destro non funziona su YouTube». Causa: alcuni siti
// (YouTube, Reddit…) registrano il PROPRIO listener `contextmenu` in cattura al
// primo script di pagina e lo bloccano con stopImmediatePropagation/preventDefault
// per mostrare il loro menu. Il nostro content script si registrava solo a
// DOMContentLoaded → arrivava DOPO l'handler del sito → il menu Filo non compariva.
// Fix: il page-preload installa il listener window+capture a document_start (prima
// di ogni script di pagina), così siamo sempre i primi a ricevere l'evento, e con
// stopPropagation interrompiamo gli handler del sito su document/elementi.
//
// La pagina di test simula un sito ostile: registra il proprio handler su
// `document` in cattura e mostra il suo menu (#site-menu) bloccando l'evento.
const mkHTML = (target) => `<!doctype html><html><head><script>
  ${target}.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    var d = document.createElement('div');
    d.id = 'site-menu';
    d.textContent = 'menu del sito';
    document.body.appendChild(d);
  }, { capture: true });
</script></head><body style="padding:40px">
  <video id="player" width="320" height="180" style="background:#000"></video>
</body></html>`;

test('right-click su sito ostile (handler su document) apre il menu Filo, non quello del sito', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mkHTML('document'));
  await page.locator('#player').click({ button: 'right' });
  await page.waitForTimeout(300);
  // Il menu Filo compare…
  await expect(page.locator('.sn-menu')).toBeVisible();
  // …e quello del sito NO: l'abbiamo pre-emptato registrandoci per primi.
  await expect(page.locator('#site-menu')).toHaveCount(0);
});

test('right-click su sito ostile (handler su body) apre il menu Filo, non quello del sito', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mkHTML('document.body'));
  await page.locator('#player').click({ button: 'right' });
  await page.waitForTimeout(300);
  await expect(page.locator('.sn-menu')).toBeVisible();
  await expect(page.locator('#site-menu')).toHaveCount(0);
});

test('Shift + right-click su sito ostile resta escape hatch (nessun menu Filo)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, mkHTML('document'));
  await page.keyboard.down('Shift');
  await page.locator('#player').click({ button: 'right' });
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  await expect(page.locator('.sn-menu')).toHaveCount(0);
});
