// Sonda del verificatore #495: sulla pagina gemella (filo://feedback) il numero
// accanto alla sezione segue il filtro di ricerca, o resta il totale mentre la
// lista mostra tutt'altro?
//
// Il pattern scritto per #495 dice: "il numero è la LUNGHEZZA della lista che
// quella scheda mostrerebbe… se la scheda ha dei filtri, il conteggio li segue".
// Qui si guarda se la casella di ricerca della pagina feedback è uno di quei
// filtri.

import { test, expect } from './fixtures/electron.mjs';

const URL = 'filo://feedback/feedback.html';

test('sonda: col filtro di ricerca attivo, cosa dice il numero della sezione?', async ({ openTab }) => {
  const page = await openTab(URL);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => typeof SN_FEEDBACK !== 'undefined' && window.__fbTest);

  await page.evaluate(() => {
    const items = [];
    for (let i = 0; i < 12; i++) {
      items.push({
        _id: `s${i}`, text: i === 0 ? 'aghinunpagliaio' : `segnalazione ordinaria ${i}`,
        name: i === 0 ? 'aghinunpagliaio' : `segnalazione ordinaria ${i}`,
        seq: i + 1, subSeq: 0, status: 'unlabeled', clientId: 'tester@example.com',
        createdAt: '2026-06-20T10:00:00Z', images: [],
      });
    }
    window.__fbTest.setData(items);
  });

  const inbox = page.locator('[data-tab="inbox"]');
  await expect(inbox).toHaveText('Ricevuti (12)');

  const search = page.locator('#fbSearch, input[type="search"], .fb-search input').first();
  await search.fill('aghinunpagliaio');
  await page.waitForTimeout(400);

  const mostrati = await page.locator('.fb-item, .fb-card, #fbList > *').count();
  const etichetta = (await inbox.textContent()).trim();
  console.log(`[sonda 495] la sezione dice "${etichetta}" mentre in lista se ne vedono ${mostrati}`);

  // Caso limite peggiore: una ricerca che non trova NULLA in questa sezione.
  await search.fill('zzz-nessuna-corrispondenza-zzz');
  await page.waitForTimeout(400);
  const mostrati2 = await page.locator('.fb-item, .fb-card, #fbList > *').count();
  const etichetta2 = (await inbox.textContent()).trim();
  console.log(`[sonda 495] con zero risultati la sezione dice "${etichetta2}" e in lista se ne vedono ${mostrati2}`);
  await page.screenshot({ path: 'tests/.shots/495-sonda-ricerca.png' });
});
