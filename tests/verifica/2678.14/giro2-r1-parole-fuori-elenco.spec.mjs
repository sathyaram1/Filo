// Verifica #2678.14, giro 2: la data o la misura della password si riconosce solo se ogni altra parola sta in un
// elenco fisso; una parola fuori elenco nasconde una descrizione, una dentro lascia passare una frase-password.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
const P = require(resolve(process.cwd(), 'src/shared/pavimento.js'));

test('r1 la riga che dice lo stato o le regole della password resta leggibile', () => {
  for (const riga of [
    'Password: la mia scade tra 30 giorni',
    'Password: riprova tra 5 minuti',
    'Password: try again in 5 minutes',
    'Password: account bloccato per 30 minuti',
    'Password: lunghezza minima 8 caratteri',
    'Password: 12 caratteri minimi',
    'Password: il sito vuole minimo 8 caratteri',
    'Password: OTP valido 5 minuti',
    'Password: temporanea, valida 24 ore',
    'Password: provvisoria per 7 giorni',
    'Password: me l\'hanno resettata 2 giorni fa',
    'Password: ho sbagliato 3 volte e ora aspetto 15 minuti',
    'Password: arriva tra 5 minuti via sms',
  ]) expect(P.oscura(riga), riga).toBe(riga);
});

test('r1 una frase-password fatta di numero, tempo e parole comuni non arriva al modello', () => {
  for (const [riga, frase] of [
    ['Password: venti anni dopo', 'venti anni dopo'],
    ['Password: tre anni dopo', 'tre anni dopo'],
    ['Password: dieci anni prima', 'dieci anni prima'],
    ['Password: nuova vita da 2 anni', 'nuova vita'],
  ]) expect(P.oscura(riga), riga).not.toContain(frase);
});
