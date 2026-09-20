// Verifica avversariale #498 — controprova: le correzioni sono davvero quello
// che tiene? Qui si rimettono a mano le misure di PRIMA (colonna della pagina
// che cresce col contenuto, barra di ricerca che si tira su di 12px fissi) e si
// controlla che gli stessi assert diventino rossi. Se non diventano rossi, i
// test nuovi non stanno guardando niente.

import { test, expect } from '../../fixtures/electron.mjs';

const URL = 'filo://manage/manage.html';

// Il riquadro delle fusioni in attesa non sta più sopra le aree: la
// pre-approvazione l'ha spostato nella scheda Automazioni, dove la pagina è
// libera di allungarsi, e l'ha diviso in tre riquadri con nomi nuovi. Questa
// controprova frugava il riquadro unico di allora, quindi dal giorno dello
// spostamento non provava più niente e cascava.
//
// Delle due misure di #498 ne resta una, ed è quella che tiene: la colonna
// della pagina è ALTA QUANTO LA FINESTRA finché la scheda lista è quella
// aperta, quindi qualunque cosa stia sopra le aree le accorcia invece di
// spingerle fuori. È questa che la controprova rimette a com'era.
test('senza l\'altezza fissa della colonna le aree uscivano dallo schermo', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.__mgTest && window.__mgTest.whenReady);
  await page.evaluate(() => window.__mgTest.whenReady());
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.evaluate(() => window.__mgTest.setAdmin(true));
  await page.evaluate(() => window.__mgTest.setData([]));

  // Qualcosa di alto sopra le aree, come lo era il blocco delle fusioni.
  async function conUnBloccoAlto() {
    await page.evaluate(() => {
      let blocco = document.getElementById('bloccoDiProva498');
      if (!blocco) {
        blocco = document.createElement('div');
        blocco.id = 'bloccoDiProva498';
        const grid = document.getElementById('mgReviewGrid');
        grid.parentNode.insertBefore(blocco, grid);
      }
      // Alto in proporzione alla finestra: con la colonna ferma a 100vh le aree
      // si accorciano e restano dentro; senza, la somma sborda di sicuro.
      blocco.style.cssText = 'height:calc(100vh - 420px);flex:0 0 auto;border:1px solid #999;border-radius:8px';
      blocco.textContent = 'Fusione ferma: ramo claude/prova, in attesa del tuo via libera';
    });
    await page.waitForTimeout(250);
    return page.evaluate(() => {
      const doc = document.documentElement;
      const g = document.getElementById('mgReviewGrid').getBoundingClientRect();
      return {
        gridH: Math.round(g.height), gridBottom: Math.round(g.bottom),
        viewport: doc.clientHeight, scrollH: doc.scrollHeight,
      };
    });
  }

  // Com'è adesso: un blocco alto sopra le aree e le aree restano dentro.
  const adesso = await conUnBloccoAlto();
  console.log('ADESSO blocco alto', JSON.stringify(adesso));
  expect(adesso.scrollH).toBeLessThanOrEqual(adesso.viewport + 1);
  expect(adesso.gridBottom).toBeLessThanOrEqual(adesso.viewport + 1);

  // Com'era prima: la colonna torna a crescere con il contenuto invece di
  // stare dentro la finestra, e la stessa scena rompe gli stessi assert.
  await page.addStyleTag({ content: `
    .sn-page { height: auto !important; min-height: 100vh !important; }
    #mgReviewGrid { min-height: calc(100vh - 280px) !important; }
  ` });
  await page.waitForTimeout(250);
  const prima = await conUnBloccoAlto();
  console.log('PRIMA blocco alto', JSON.stringify(prima));
  expect(prima.scrollH, 'senza altezza fissa la pagina DEVE tornare a scorrere').toBeGreaterThan(prima.viewport + 1);
  expect(prima.gridBottom, 'senza altezza fissa le aree DEVONO uscire dalla finestra').toBeGreaterThan(prima.viewport + 1);
});

test('col vecchio margine fisso la barra di ricerca tornava appiccicata', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { document.getElementById('mgBanner').hidden = true; });
  await page.locator('#mgSearchToggle').click();
  await expect(page.locator('#mgSearchBar')).toBeVisible();

  const misura = () => page.evaluate(() => {
    const t = document.getElementById('mgTabs').getBoundingClientRect();
    const b = document.getElementById('mgSearchBar').getBoundingClientRect();
    return Math.round(b.top - t.bottom);
  });

  const adesso = await misura();
  console.log('STACCO adesso', adesso);
  expect(adesso).toBeGreaterThanOrEqual(6);

  await page.addStyleTag({ content: '#mgSearchBar { margin-top: -12px !important; }' });
  await page.waitForTimeout(200);
  const prima = await misura();
  console.log('STACCO col margine fisso di prima', prima);
  expect(prima, 'col numero ricopiato a mano lo stacco DEVE tornare quasi zero').toBeLessThan(6);
});
