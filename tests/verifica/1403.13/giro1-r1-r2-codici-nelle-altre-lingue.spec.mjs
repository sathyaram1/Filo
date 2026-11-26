// #1403.13 giro 1: i codici di accesso annunciati da un verbo in francese, tedesco e spagnolo si tolgono come in italiano,
// ma un identificativo che non apre niente (spedizione, ordine, errore, prodotto) resta, come «Il codice di ordine è …».
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../../../src/shared/pavimento.js');
const P = globalThis.SN_PAVIMENTO;

test('r1 il codice di una spedizione, di un ordine o di un errore resta, come in italiano', () => {
  for (const t of [
    'Le code de suivi est 482913',
    'Le code de la commande est 482913',
    "Le code d'erreur est 5003",
    'Le code produit est 482913',
    'El código de seguimiento es 482913',
    'El código del pedido es 482913',
    'Código de seguimiento: 482913',
    'Der Code der Bestellung ist 482913',
    'Su código de reserva es 482913',
    'Kod rabatowy to 4829',
  ]) {
    expect(P.oscura(t), t).toBe(t);
  }
  for (const t of ['Il codice di ordine è 482913', 'Il codice del prodotto è 482913']) expect(P.oscura(t), t).toBe(t);
  for (const t of ['Le code est 482913', 'el código de acceso es 482913', 'der Zugangscode ist 482913']) {
    expect(P.oscura(t), t).not.toContain('482913');
  }
});

test('r2 il codice annunciato al futuro o con l\'articolo davanti al numero si toglie', () => {
  for (const t of ['Votre code sera 482913', 'Tu código será 482913', 'El código es el 482913']) {
    expect(P.oscura(t), t).not.toContain('482913');
  }
});
