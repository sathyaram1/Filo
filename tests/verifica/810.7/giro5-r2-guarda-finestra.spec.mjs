// Verifica #810.7, giro 5, rilievo 2: chiesto in chat di guardare una finestra di Filo, la pagina col numero di carta
// scritto arriva al modello che legge le immagini con le cifre leggibili.

import { test, expect } from '../../fixtures/electron.mjs';
import { modulo, superaAvviso, pixelDiversi } from './aiuti.mjs';

test('r2 guardare la finestra di Filo con la pagina di pagamento: il numero di carta è coperto', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const page = await testServer.openReady(openTab, modulo('<label for="c">Numero della carta</label> '
    + '<input id="c" autocomplete="cc-number" style="width:280px;font-size:18px;outline:0;caret-color:transparent">'));
  await superaAvviso(page);
  const immagini = [];
  for (const valore of ['4111 1111 1111 1111', '5500 0000 0000 0004']) {
    await page.fill('#c', valore);
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    const img = await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x._filoTabs && !x._filoIncognito);
      let visto = null;
      const action = { domanda: 'cosa c’è scritto?', _finestra: { id: `filo:${w.id}`, tipo: 'finestra', filo: true, nome: 'Filo: Pagamento' } };
      await globalThis.SN_SCHERMO.guarda(action, { chiave: 'prova', leggi: ({ dataUrl }) => { visto = dataUrl; return 'una pagina di pagamento'; } });
      return visto;
    });
    expect(img, 'la foto della finestra arriva al modello').toMatch(/^data:image\//);
    immagini.push(img);
  }
  const r = await page.evaluate(() => {
    const b = document.querySelector('#c').getBoundingClientRect();
    return { left: b.left + 3, top: b.top + 3, width: b.width - 6, height: b.height - 6 };
  });
  expect(await pixelDiversi(page, immagini, r), 'il numero si legge nella foto per il modello').toBe(0);
});
