// Verifica #810 giro 2, rilievo 4: dopo le parole 2FA, OTP o «codice monouso» i due punti possono
// annunciare altro (un video, un codice sconto, una pratica, una quantità): l'uscita che li usa parte.

import { test, expect } from '../../fixtures/electron.mjs';

for (const [nome, testo, azione] of [
  ['il video di una guida alla 2FA', 'Guida alla 2FA: https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    { type: 'NAVIGA', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
  ['un codice sconto monouso', 'Il tuo codice monouso per lo sconto del 10%: BENVENUTO10',
    { type: 'CERCA_WEB', query: 'BENVENUTO10 non funziona' }],
  ['il numero di una pratica', 'Richiesta di reset della 2FA, numero pratica: 20240931',
    { type: 'CERCA_WEB', query: 'pratica 20240931 stato' }],
  ['una quantità', 'Costo del servizio OTP via SMS: 1500 SMS inclusi nel canone',
    { type: 'CERCA_WEB', query: 'pacchetto 1500 SMS prezzo' }],
]) {
  test(`${nome} letto da una pagina non ferma l’uscita che lo usa`, async ({ app }) => {
    const r = await app.evaluate((_e, { azione, testo }) => globalThis.SN_URL_EXFIL.valutaUscita(
      azione, { pagina: { testo, host: 'pagina.example' } },
    ), { azione, testo });
    expect(r.blocca, r.frase).toBe(false);
  });
}
