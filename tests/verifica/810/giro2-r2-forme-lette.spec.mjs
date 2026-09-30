// Verifica #810 giro 2, rilievo 2: codici di recupero e password scritti nelle forme più comuni,
// letti da una pagina, devono essere riconosciuti e fermare l'uscita che li contiene.

import { test, expect } from '../../fixtures/electron.mjs';

const RACCOLTA = 'https://raccolta.example/c';

for (const [nome, testo, url] of [
  ['i «Codici di backup» (la parola di Google in italiano)', 'Codici di backup\n1. 7563 0192\n2. 1122 3344\n3. 9988 7766', `${RACCOLTA}?v=11223344`],
  ['i «Recovery codes» in elenco sotto il titolo', 'Recovery codes\na1b2c-3d4e5\nf6g7h-8i9j0', `${RACCOLTA}?v=f6g7h-8i9j0`],
  ['un codice OTP scritto a gruppi di tre', 'Il tuo codice OTP è 482 913. Non condividerlo.', `${RACCOLTA}?v=482913`],
  ['un codice OTP scritto col trattino', 'Il tuo codice OTP è 482-913.', `${RACCOLTA}?v=482913`],
  ['una password temporanea con un simbolo', 'La tua password temporanea è Tr7#kq29Lm', `${RACCOLTA}?v=Tr7%23kq29Lm`],
  ['una password annunciata come tale', 'Nome utente: mario.rossi\nPassword: Tr7kq29Lm', `${RACCOLTA}?v=Tr7kq29Lm`],
]) {
  test(`${nome} letti dalla pagina non escono`, async ({ app }) => {
    const r = await app.evaluate((_e, { url, testo }) => globalThis.SN_URL_EXFIL.valutaUscita(
      { type: 'NAVIGA', url }, { pagina: { testo, host: 'banca.example' } },
    ), { url, testo });
    expect(r.blocca, `${url} è uscito`).toBe(true);
  });
}
