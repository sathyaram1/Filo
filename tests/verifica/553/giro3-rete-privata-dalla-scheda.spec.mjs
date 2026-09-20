// #553 giro 3 — la lettura da una scheda già aperta non ha né confine né freno.
//
// Filo si rifiuta di scaricare un indirizzo che non è un sito pubblico: il
// router di casa, un pannello dell'ufficio, il computer stesso. Se però quella
// pagina è aperta in una scheda, la lettura la prende da lì e il rifiuto non
// arriva mai. E a chiedere la lettura può essere l'assistente che vive DENTRO
// un'altra pagina web, cioè il posto da cui arrivano le istruzioni di chi ha
// scritto quella pagina: il contenuto di una scheda qualunque gli torna
// indietro senza che nessuno chieda niente all'utente.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = '<!DOCTYPE html><html><head><title>Pannello</title></head><body><main>'
  + '<p>Chiave della rete di casa: 7781-SEGRETO-9920</p></main></body></html>';

test('un indirizzo della rete privata non si legge nemmeno quando è aperto in una scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA);

  // Senza la scheda aperta Filo rifiuta: non è un sito pubblico.
  const chiuso = await app.evaluate(
    (_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u }),
    url,
  );
  expect(chiuso.output.ok).toBe(false);
  expect(String(chiuso.output.detail || '')).toContain('non è un sito pubblico');

  // Stessa richiesta con la pagina aperta in una scheda.
  await openTab(url);
  const aperto = await app.evaluate(
    (_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u }),
    url,
  );
  expect(String(aperto.output.text || '')).not.toContain('7781-SEGRETO-9920');
  expect(aperto.output.ok).toBe(false);
});

test('l\'assistente di una pagina qualunque non deve poter leggere il contenuto di un\'altra scheda', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA);
  await openTab(url);

  // La richiesta arriva dall'assistente laterale, che vive dentro una pagina
  // web: l'indirizzo lo sceglie il modello, e il modello ha appena letto quella
  // pagina.
  const r = await app.evaluate(
    (_e, u) => globalThis.SN_HANDLE_MESSAGE({ type: 'read_page', url: u }, { url: 'https://ostile.example/articolo' }),
    url,
  );
  expect(String((r && r.text) || '')).not.toContain('7781-SEGRETO-9920');
});
