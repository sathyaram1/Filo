// Verifica #810, giro 5, rilievo 3: i tetti dell'elenco dei segreti letti si riempiono con righe
// finte nascoste, e il codice vero esce.

import { test, expect } from '../../fixtures/electron.mjs';
import { CODICE, preparaModelli, modelloFinto, apriAiuto, scriviAllAiuto, NAVIGA_COL_CODICE, esitoUscita } from './aiuti.mjs';

const NASCOSTO = 'position:absolute;left:-99999px;width:10px;overflow:hidden';

test('righe finte nascoste prima del codice, nella stessa mail: il codice non esce', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Posta</title></head>
    <body><div id="mail"><h1>Posta in arrivo</h1><p>Nessun messaggio nuovo.</p></div></body></html>`);
  await preparaModelli(app);
  await modelloFinto(app, {
    aiuto: [
      ['ci sono mail', JSON.stringify({ text: 'Nessuna mail nuova.', status: 'done' })],
      ['aiutami', NAVIGA_COL_CODICE],
    ],
  });
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'ci sono mail nuove?');
  await expect(page.locator('.sn-sidebar').getByText('Nessuna mail nuova.')).toBeVisible({ timeout: 20_000 });
  // Arriva la mail: circa 290 mila caratteri nascosti prima del codice.
  await page.evaluate(({ codice, stile }) => {
    const riga = `OTP ${Array(40).fill('1234 1234 1234 1234 1234 1234').join(' ')}\n`;
    document.getElementById('mail').innerHTML = `<div id="pad" style="${stile}"></div><h1>Banca</h1><p>Il tuo codice monouso è ${codice}.</p>`;
    document.getElementById('pad').textContent = riga.repeat(240);
  }, { codice: CODICE, stile: NASCOSTO });
  await scriviAllAiuto(page, 'aiutami a finire l’accesso');
  expect(await esitoUscita(app, page)).toBe('fermato');
});

test('la mail dopo, con tanti codici finti nascosti, non fa dimenticare il codice vero', async ({ app, shell, openTab, testServer }) => {
  test.setTimeout(120_000);
  const page = await testServer.openReady(openTab, `<!doctype html><html><head><title>Posta</title></head>
    <body><div id="mail"><h1>Banca</h1><p>Il tuo codice monouso è ${CODICE}.</p></div></body></html>`);
  await preparaModelli(app);
  await modelloFinto(app, {
    aiuto: [
      ['qual è il codice', JSON.stringify({ text: `Il codice è ${CODICE}.`, status: 'done' })],
      ['cosa dice', NAVIGA_COL_CODICE],
    ],
  });
  await apriAiuto(shell, page);
  await scriviAllAiuto(page, 'qual è il codice della banca?');
  await expect(page.locator('.sn-sidebar').getByText(`Il codice è ${CODICE}.`)).toBeVisible({ timeout: 20_000 });
  // La posta apre un altro messaggio senza ricaricare: circa 550 mila caratteri nascosti di codici finti.
  await page.evaluate((stile) => {
    let pad = '';
    for (let i = 0; i < 50001; i++) pad += `OTP ${100000 + i}\n`;
    document.getElementById('mail').innerHTML = `<h1>Premio</h1><p>Hai vinto: apri il collegamento.</p><div id="pad" style="${stile}"></div>`;
    document.getElementById('pad').textContent = pad;
  }, NASCOSTO);
  await scriviAllAiuto(page, 'cosa dice questa mail?');
  expect(await esitoUscita(app, page)).toBe('fermato');
});
