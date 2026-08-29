// VERIFICA INDIPENDENTE #444 — conteggio delle porte del difetto di adozione.
// File temporaneo del verificatore, da rimuovere a fine verifica.

import { test, expect } from './fixtures/electron.mjs';

async function rightClickAt(page, x, y) {
  await page.mouse.click(x, y, { button: 'right' });
  const menu = page.locator('.sn-menu');
  await expect(menu).toBeVisible();
  return menu;
}

async function countLinkItems(menu) {
  return menu.getByText('Apri in nuova tab').count();
}

// PORTA C — riquadro cookie a BARRA (striscia bassa a tutta larghezza) sopra
// una riga di link a tutta larghezza.
test('porta C: barra cookie in basso sopra una riga-link a tutta larghezza', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <div style="height:400px"></div>
    <a id="row" href="https://esempio.test/riga-sotto-cookie" style="display:block;position:absolute;left:0;right:0;top:520px;height:28px;font:18px sans-serif">Riga di collegamento finita sotto il banner</a>
    <div id="cookie" style="position:fixed;left:0;right:0;bottom:0;height:180px;background:#fff;border-top:1px solid #ccc;z-index:50;font:15px sans-serif;padding:20px">
      Usiamo i cookie per migliorare il servizio.
    </div>
  </body></html>`);

  // clic dentro il banner, nel punto dove sotto passa la riga-link
  const vh = await page.evaluate(() => window.innerHeight);
  const rowY = await page.evaluate(() => document.getElementById('row').getBoundingClientRect().top + 10);
  // se la riga non è sotto il banner, sistemiamo il clic dove si sovrappongono
  const y = Math.max(rowY, vh - 170);
  const menu = await rightClickAt(page, 200, y);
  const n = await countLinkItems(menu);
  console.log('PORTA C — voci link adottate:', n, '(0 = corretto)');
});

// PORTA D — barra fissa in alto, riga-link CENTRATA (con margini) parzialmente
// scivolata sotto la barra (scroll): il rettangolo della riga sborda sopra la
// barra, quindi la barra non la "circonda".
test('porta D: riga centrata parzialmente scivolata sotto la barra fissa', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <div id="bar" style="position:fixed;top:0;left:0;right:0;height:64px;background:#123;z-index:10"></div>
    <div style="max-width:600px;margin:0 auto;padding-top:80px">
      <a id="row" href="https://esempio.test/riga-scrollata" style="display:block;height:40px;font:20px sans-serif">Titolo che scorrendo finisce sotto la barra</a>
      <div style="height:2000px"></div>
    </div>
  </body></html>`);

  // Scrolla finché la riga sta per metà sotto la barra (top della riga sopra il
  // bordo alto della finestra NO: sopra il top della barra = negativo in viewport).
  await page.evaluate(() => {
    const r = document.getElementById('row').getBoundingClientRect();
    window.scrollTo(0, r.top + 20); // metà riga sopra il bordo, metà sotto la barra
  });
  const rect = await page.evaluate(() => {
    const r = document.getElementById('row').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  });
  console.log('PORTA D — rect riga in viewport:', JSON.stringify(rect));
  // clic sulla barra, nel punto dove sotto c'è la riga
  const menu = await rightClickAt(page, (rect.left + rect.right) / 2, Math.max(4, rect.top + 4));
  const n = await countLinkItems(menu);
  console.log('PORTA D — voci link adottate:', n, '(0 = corretto)');
});

// PORTA B2 — manto-link invisibile su tutta la pagina, testo con margini
// laterali realistici ma che parte dal bordo alto.
test('porta B2: manto invisibile sotto testo con margini laterali', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <a id="manto" href="https://esempio.test/manto2" style="position:absolute;inset:0;z-index:0"></a>
    <div style="position:relative;z-index:1;margin:0 40px;background:#fff">
      <p id="testo" style="font:18px sans-serif;padding:8px">Testo normale della pagina con margini ai lati.</p>
      <div style="height:800px"></div>
    </div>
  </body></html>`);

  const box = await page.locator('#testo').boundingBox();
  const menu = await rightClickAt(page, box.x + 100, box.y + 12);
  const n = await countLinkItems(menu);
  console.log('PORTA B2 — voci link adottate:', n, '(0 = corretto)');
});

// CONTROPROVA — con margini su TUTTI i lati la difesa geometrica funziona?
test('controprova: riga-link ben dentro la barra (margini su ogni lato)', async ({ openTab, testServer }) => {
  const page = await testServer.openReady(openTab, `<!doctype html><html><body style="margin:0">
    <div id="bar" style="position:fixed;top:0;left:0;right:0;height:120px;background:#123;z-index:10"></div>
    <a id="row" href="https://esempio.test/riga-interna" style="display:block;position:absolute;left:200px;top:40px;width:400px;height:30px;font:18px sans-serif">Riga interna alla barra</a>
    <div style="height:2000px"></div>
  </body></html>`);

  const menu = await rightClickAt(page, 300, 55);
  const n = await countLinkItems(menu);
  console.log('CONTROPROVA — voci link adottate:', n, '(0 = corretto)');
});
