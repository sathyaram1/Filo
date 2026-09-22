// #553 giro 10 — quello che il sito costruisce dentro un guscio non arriva.
//
// Quando la pagina è già aperta Filo la legge da lì, copiando l'albero della
// pagina. La copia non porta con sé i gusci in cui i componenti moderni
// tengono il proprio contenuto: il testo che sta là dentro sparisce, e Filo
// consegna quello che resta senza dire che manca qualcosa.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = `<!DOCTYPE html><html><head><title>Trattoria</title></head><body>
<main><h1>Trattoria da Gino</h1><p>Cucina emiliana dal 1974.</p>
<div id="guscio"></div></main>
<script>
  var g = document.getElementById('guscio').attachShadow({ mode: 'open' });
  g.innerHTML = '<p>Siamo aperti dalle 8:00 alle 19:30.</p>';
</script></body></html>`;

const leggiDaScheda = (app, url) => app.evaluate(
  async (_e, u) => (await globalThis.SN_EXECUTE_FILO_ACTION(
    { type: 'LEGGI_PAGINA', url: u },
    { sender: { url: 'filo://dashboard/dashboard.html' } },
  )).output,
  url,
);

test('l\'orario che il sito costruisce dentro un guscio arriva a Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(PAGINA);
  await openTab(url);
  const out = await leggiDaScheda(app, url);
  expect(out.ok).toBe(true);
  expect(String(out.text)).toContain('Trattoria da Gino');
  expect(String(out.text)).toContain('19:30');
});
