// Verifica #810 giro 1, rilievo 6: il codice letto dalla pagina esce se l'indirizzo lo scrive a pezzi,
// con dei punti fra le cifre o al contrario.

import { test, expect } from '../../fixtures/electron.mjs';

const PAGINA = { testo: 'Il tuo codice monouso è 482913. Non darlo a nessuno.', host: 'banca.example' };

for (const [nome, url] of [
  ['con dei punti fra le cifre', 'https://raccolta.example/c?v=4.8.2.9.1.3'],
  ['diviso in due parametri', 'https://raccolta.example/c?a=482&b=913'],
  ['scritto al contrario', 'https://raccolta.example/c?v=319284'],
]) {
  test(`il codice ${nome} non esce`, async ({ app }) => {
    const r = await app.evaluate((_e, { url, pagina }) => globalThis.SN_URL_EXFIL.valutaUscita({ type: 'NAVIGA', url }, { pagina }), { url, pagina: PAGINA });
    expect(r.blocca, `${url} è uscito`).toBe(true);
  });
}
