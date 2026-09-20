// #553 giro 3 — la lettura da una scheda già aperta ha un confine.
//
// Filo si rifiuta di scaricare un indirizzo che non è un sito pubblico: il
// router di casa, un pannello dell'ufficio, il computer stesso. Se la pagina è
// aperta in una scheda la lettura la prende da lì, e quella è una scelta
// dichiarata nel manifesto per chi legge dalla chat. Ma a chiedere la lettura
// può essere l'assistente che vive dentro un'altra pagina web, dove l'indirizzo
// lo sceglie un modello che ha appena letto parole di altri: di lì si arrivava
// al contenuto di qualsiasi scheda aperta.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!DOCTYPE html><html><head><title>Pannello</title></head><body><main>'
  + '<p>Chiave della rete di casa: 7781-SEGRETO-9920</p></main></body></html>';

const leggiDa = (app, url, origine) => app.evaluate(
  (_e, [u, o]) => globalThis.SN_HANDLE_MESSAGE(
    { type: 'filo_run_action', action: { type: 'LEGGI_PAGINA', url: u } },
    { url: o },
  ),
  [url, origine],
);

test('l\'assistente di una pagina qualunque non legge il contenuto di un\'altra scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA);
  await openTab(url);

  const daFuori = await leggiDa(app, url, 'https://ostile.example/articolo');
  expect(String(daFuori.output.text || '')).not.toContain('7781-SEGRETO-9920');
  // E nemmeno scaricando: quell'indirizzo non è un sito pubblico.
  expect(daFuori.output.ok).toBe(false);
  expect(String(daFuori.output.detail || '')).toContain('non è un sito pubblico');
});

test('la stessa pagina, chiesta dalla chat dell\'utente, si legge dalla scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA);
  await openTab(url);

  const daFilo = await leggiDa(app, url, 'filo://dashboard/dashboard.html');
  expect(daFilo.output.ok).toBe(true);
  expect(String(daFilo.output.text)).toContain('7781-SEGRETO-9920');
});

test('senza la scheda aperta nessuno legge la rete privata', async ({ app, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA);

  const daFilo = await leggiDa(app, url, 'filo://dashboard/dashboard.html');
  expect(daFilo.output.ok).toBe(false);
  expect(String(daFilo.output.detail || '')).toContain('non è un sito pubblico');
});
