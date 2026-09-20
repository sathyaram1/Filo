// #553 giro 1 — il dato che sta nell'intestazione dell'articolo.
//
// La segnalazione chiede che Filo sappia leggere «un prezzo, un punteggio, un
// orario, una clausola» dentro una pagina. Su quasi tutti i siti di notizie e
// sui blog la data, l'ora e la firma stanno dentro l'intestazione
// dell'articolo, e le colonne di una tabella stanno in una riga di testata:
// sono esattamente le risposte alle domande «quando è uscito?», «a che ora?»,
// «di chi è?», «quanto costa il piano Base?».
//
// Qui la pagina è aperta in una scheda di Filo, quindi non serve la rete.

import { test, expect } from '../../fixtures/electron.mjs';

const ARTICOLO = `<!DOCTYPE html>
<html lang="it"><head><title>Rincaro del canone</title></head><body>
  <nav><ul><li>Cronaca</li><li>Economia</li></ul></nav>
  <main>
    <article>
      <header class="entry-header">
        <h1>Rincaro del canone</h1>
        <p class="meta">Pubblicato il 12 marzo 2026 alle 14:30 da Anna Bianchi</p>
      </header>
      <p>Il gestore ha annunciato l'aumento per tutti i profili domestici.</p>
      <table>
        <tr class="header"><td>Piano</td><td>Canone mensile</td></tr>
        <tr><td>Base</td><td>19,90 euro</td></tr>
        <tr><td>Fibra</td><td>34,50 euro</td></tr>
      </table>
    </article>
  </main>
  <footer class="site-footer">© 2026</footer>
</body></html>`;

const leggi = (app, url) =>
  app.evaluate((_e, u) => globalThis.SN_EXECUTE_FILO_ACTION({ type: 'LEGGI_PAGINA', url: u }), url);

test('data, ora e firma dell\'articolo arrivano a Filo', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(ARTICOLO);
  await openTab(url);

  const r = await leggi(app, url);
  expect(r.executed).toBe(true);
  const testo = String(r.output?.text || '');

  // Controllo: il corpo dell'articolo c'è davvero, quindi la lettura funziona.
  expect(testo).toContain('Il gestore ha annunciato');

  // Il dato che l'utente chiede quando domanda «quando?» e «a che ora?».
  expect(testo).toContain('12 marzo 2026');
  expect(testo).toContain('14:30');
  expect(testo).toContain('Anna Bianchi');
});

test('le colonne della tabella dei prezzi non spariscono', async ({ app, openTab, testServer }) => {
  test.setTimeout(60_000);
  const url = testServer.html(ARTICOLO);
  await openTab(url);

  const r = await leggi(app, url);
  const testo = String(r.output?.text || '');

  // Senza le intestazioni delle colonne i numeri restano numeri e basta: «19,90»
  // non si sa più se è il canone mensile o quello annuo.
  expect(testo).toContain('19,90');
  expect(testo).toContain('Canone mensile');
});
