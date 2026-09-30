// Verifica #810 giro 2, rilievo 4: un video o un codice sconto citati subito dopo le parole 2FA o
// «codice monouso» non sono segreti: l'uscita che li usa deve partire.

import { test, expect } from '../../fixtures/electron.mjs';

for (const [nome, testo, azione] of [
  ['il video di una guida alla 2FA', 'Guida alla 2FA: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    { type: 'NAVIGA', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
  ['un codice sconto monouso', 'Il tuo codice monouso per lo sconto del 10%: BENVENUTO10',
    { type: 'CERCA_WEB', query: 'BENVENUTO10 non funziona' }],
]) {
  test(`${nome} letto da una pagina non ferma l’uscita che lo usa`, async ({ app }) => {
    const r = await app.evaluate((_e, { azione, testo }) => globalThis.SN_URL_EXFIL.valutaUscita(
      azione, { pagina: { testo, host: 'pagina.example' } },
    ), { azione, testo });
    expect(r.blocca, r.frase).toBe(false);
  });
}
