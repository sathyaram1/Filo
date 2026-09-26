// Verifica #515 — giro 4.
//
// Il giro 3 ha reso cliccabili le sezioni non ancora scritte: chi le tocca
// adesso legge che non ci sono, invece di restare sul documento di prima. Qui
// si guarda cosa succede DOPO quel clic (si esce da lì? si arriva alle altre?)
// e se quelle voci si vedono abbastanza da venire cliccate.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = 'filo://transparency/transparency.html';

async function aree(app) {
  return app.evaluate(() => {
    const T = globalThis.SN_TRANSPARENCY;
    const scritti = T.ids();
    return {
      mancanti: T.NAV.filter((n) => !scritti.includes(n.id)).map((n) => ({ id: n.id, label: n.label })),
      scritti,
    };
  });
}

test('dalla sezione non scritta si arriva alle altre e al documento che c\'è', async ({ app, openTab }) => {
  const { mancanti, scritti } = await aree(app);
  expect(mancanti.length, 'tutte le aree hanno un documento: qui non c\'è niente da provare').toBeGreaterThan(1);

  const page = await openTab(`${PAGINA}?doc=${mancanti[0].id}`);
  await expect(page.locator('#subtitle')).toContainText('non è ancora scritta');

  // Dalla pagina di una sezione vuota si deve poter passare a un'altra sezione
  // vuota: se la barra funzionasse solo dal documento, ogni vicolo ne aprirebbe
  // un altro.
  await page.locator(`#nav a[href*="doc=${mancanti[1].id}"]`).click();
  await expect(page.locator('#title')).toHaveText(mancanti[1].label);
  await expect(page.locator('#subtitle')).toContainText('non è ancora scritta');

  // Ricliccare la sezione dove già si è non deve lasciare una pagina muta.
  await page.locator(`#nav a[href*="doc=${mancanti[1].id}"]`).click();
  await expect(page.locator('#subtitle')).toContainText('non è ancora scritta');

  // E da lì si arriva a quello che è scritto davvero, con il suo contenuto.
  await page.locator(`#nav a[href*="doc=${scritti[0]}"]`).click();
  await expect(page.locator('#subtitle')).not.toContainText('non è ancora scritta');
  const parole = await page.locator('#doc-body').evaluate((el) => (el.textContent || '').trim().length);
  expect(parole, 'il documento arriva vuoto').toBeGreaterThan(500);
});
