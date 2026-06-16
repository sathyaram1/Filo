// Feedback #185 — "Filo (dalla chat) deve poter modificare l'estetica del testo
// della pagina: un comando come 'scrivi in grassetto tutti i titoli'".
//
// Filo emette l'azione STILE_PAGINA con regole {selettore, css}; il main le
// SANIFICA e le inietta nella scheda WEB attiva (insertCSS, che ignora la CSP
// del sito). La modifica è live, vale solo per quella pagina ed è reversibile
// (RIPRISTINA_STILE_PAGINA, o un reload).
//
// Gli assert verificano il SUCCESSO (il titolo della pagina diventa davvero
// grassetto) e la reversibilità (RIPRISTINA lo riporta normale), non l'assenza
// di un errore. Senza il fix l'azione non è registrata → executed:false e lo
// stile non cambia: il primo assert diventa rosso.

import { test, expect } from './fixtures/electron.mjs';

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>restyle-probe</title>
<style>h1{font-weight:400} a{color:rgb(0,0,238)}</style></head>
<body><h1 id="t">Titolo</h1><a id="lnk" href="#">un link</a><p id="p">testo</p></body></html>`;

const weightOf = (page, sel) => page.evaluate(
  (s) => getComputedStyle(document.querySelector(s)).fontWeight,
  sel,
);
const colorOf = (page, sel) => page.evaluate(
  (s) => getComputedStyle(document.querySelector(s)).color,
  sel,
);

test('STILE_PAGINA mette in grassetto i titoli della pagina attiva (e RIPRISTINA li riporta normali)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // Stato iniziale: il titolo NON è grassetto.
  expect(await weightOf(page, '#t')).toBe('400');

  // Filo esegue l'azione come farebbe rispondendo "scrivi in grassetto i titoli".
  const res = await app.evaluate(async () => globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'STILE_PAGINA',
    descrizione: 'titoli in grassetto',
    regole: [{ selettore: 'h1,h2,h3,h4,h5,h6', css: 'font-weight: 700' }],
  }));
  expect(res.executed).toBe(true);

  // Il titolo è diventato grassetto sulla pagina reale.
  await expect.poll(() => weightOf(page, '#t'), { timeout: 5000 }).toBe('700');

  // Reversibilità: Filo toglie le modifiche → il titolo torna normale.
  const undo = await app.evaluate(async () => globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'RIPRISTINA_STILE_PAGINA',
  }));
  expect(undo.executed).toBe(true);
  await expect.poll(() => weightOf(page, '#t'), { timeout: 5000 }).toBe('400');
});

test('STILE_PAGINA applica più regole insieme (titoli grassetto + link rossi)', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  const res = await app.evaluate(async () => globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'STILE_PAGINA',
    regole: [
      { selettore: 'h1', css: 'font-weight: 700' },
      { selettore: 'a', css: 'color: rgb(255, 0, 0)' },
    ],
  }));
  expect(res.executed).toBe(true);

  await expect.poll(() => weightOf(page, '#t'), { timeout: 5000 }).toBe('700');
  await expect.poll(() => colorOf(page, '#lnk'), { timeout: 5000 }).toBe('rgb(255, 0, 0)');
});

test('SICUREZZA: una regola con tentativo di breakout via graffe non viene applicata', async ({ app, openTab, testServer }) => {
  const page = await testServer.openReady(openTab, PAGE);

  // Il css prova a chiudere la regola e nascondere tutta la pagina: il
  // sanificatore lo scarta → nessun CSS valido → executed:false, pagina intatta.
  const res = await app.evaluate(async () => globalThis.SN_EXECUTE_FILO_ACTION({
    type: 'STILE_PAGINA',
    regole: [{ selettore: 'h1', css: 'color:red} body{display:none' }],
  }));
  expect(res.executed).toBe(false);

  // La pagina è ancora visibile (il body non è stato nascosto).
  const bodyDisplay = await page.evaluate(() => getComputedStyle(document.body).display);
  expect(bodyDisplay).not.toBe('none');
});
