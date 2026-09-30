// Verifica #810 giro 1, rilievo 5: su una pagina lunghissima che nomina spesso OTP e 2FA il controllo
// di un'uscita non deve tenere ferma Filo per secondi (gira nel processo principale).

import { test, expect } from '../../fixtures/electron.mjs';

test('il controllo di un’uscita su una pagina di due milioni di caratteri sul 2FA dura meno di un secondo', async ({ app }) => {
  test.setTimeout(90_000);
  const ms = await app.evaluate(() => {
    const frasi = [
      'La 2FA richiede un secondo fattore, spesso un OTP generato da un\'app, secondo la RFC 6238 del 2011.',
      'Nel 2019 il 45% delle banche usava codici OTP via SMS; il costo medio era 0,05 euro per messaggio.',
      'Un token hardware one-time password come il modello RSA SecurID 700 mostra 6 cifre ogni 60 secondi.',
      'La MFA riduce del 99,9% gli attacchi automatizzati secondo uno studio su 1200000 account.',
    ];
    let testo = '';
    for (let i = 0; testo.length < 2_000_000; i++) testo += `${frasi[i % frasi.length]} Riferimento ${10000 + (i * 7919) % 90000}.\n`;
    const t = Date.now();
    globalThis.SN_URL_EXFIL.valutaUscita({ type: 'NAVIGA', url: 'https://example.org/guida' }, { pagina: { testo, host: 'forum.example' } });
    return Date.now() - t;
  });
  expect(ms, `il controllo ha tenuto fermo il processo principale per ${ms} ms`).toBeLessThan(1000);
});
