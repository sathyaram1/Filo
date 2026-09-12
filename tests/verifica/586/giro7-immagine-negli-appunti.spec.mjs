// Verifica #586, giro 7 — l'immagine negli appunti, dopo lo spostamento della
// lettura nel processo principale.
//
// Il giro 6 ha tolto la lettura degli appunti dal mondo della pagina e l'ha
// portata dentro Filo, per chiudere la corsa con cui un sito se li prendeva.
// La prova scritta allora per tenere aperto l'altro lato — un'IMMAGINE negli
// appunti che si incolla lo stesso — è rossa. Qui si separa il guasto
// dell'ambiente dal difetto: prima si guarda se gli appunti del computer
// tengono davvero un'immagine (senza, la prova non dice niente), e solo dopo si
// prova a incollarla, su un sito severo e su uno qualunque.

import { test, expect } from '../../fixtures/electron.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFklEQVR4nGP8//8/AzZgYsAB'
  + 'RiQGABGvAgP1L1XAAAAAAElFTkSuQmCC';

const SEVERO = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; connect-src 'self'">
</head><body style="margin:0;padding:20px">
<div id="ce" contenteditable="true" style="min-height:120px;border:1px solid #999"></div>
</body></html>`;

const NORMALE = `<!doctype html><html><body style="margin:0;padding:20px">
<div id="ce" contenteditable="true" style="min-height:120px;border:1px solid #999"></div>
</body></html>`;

async function incolla(page) {
  await page.click('#ce');
  await page.click('#ce', { button: 'right' });
  await page.waitForTimeout(900);
  const voce = page.locator('.sn-menu-paste-main').first();
  const c = await voce.count();
  if (!c) return { menu: false, immagini: [] };
  await voce.click();
  await page.waitForTimeout(2500);
  const immagini = await page.evaluate(() => {
    const ce = document.getElementById('ce');
    return [...ce.querySelectorAll('img')].map((i) => (i.src || '').slice(0, 24));
  });
  return { menu: true, immagini };
}

test('un\'immagine negli appunti si incolla col menu di Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(240_000);

  // 1) Gli appunti del computer tengono davvero un'immagine? Senza questo, il
  //    resto non prova niente.
  const appunti = await app.evaluate(({ clipboard, nativeImage }, png) => {
    clipboard.writeImage(nativeImage.createFromDataURL('data:image/png;base64,' + png));
    const letta = clipboard.readImage();
    return { vuota: !letta || letta.isEmpty(), lunghezza: (letta && !letta.isEmpty()) ? letta.toDataURL().length : 0 };
  }, PNG);
  console.log('[586 g7] gli appunti dopo la scrittura:', JSON.stringify(appunti));
  test.skip(appunti.vuota, 'gli appunti di questo computer non tengono un\'immagine: la prova non direbbe niente');

  // 2) Sito qualunque.
  const normale = await testServer.openReady(openTab, NORMALE);
  const esitoNormale = await incolla(normale);
  console.log('[586 g7] sito qualunque:', JSON.stringify(esitoNormale));

  // 3) Sito con la politica di sicurezza stretta.
  const severo = await testServer.openReady(openTab, SEVERO);
  const esitoSevero = await incolla(severo);
  console.log('[586 g7] sito severo:', JSON.stringify(esitoSevero));

  expect(
    esitoNormale.immagini.length,
    'un\'immagine copiata non si incolla più col menu del tasto destro di Filo: si preme Incolla '
    + 'e nel campo non arriva niente',
  ).toBeGreaterThan(0);
  expect(
    esitoSevero.immagini.length,
    'un\'immagine copiata non si incolla col menu di Filo dove il sito ha una politica di '
    + 'sicurezza stretta',
  ).toBeGreaterThan(0);
});
