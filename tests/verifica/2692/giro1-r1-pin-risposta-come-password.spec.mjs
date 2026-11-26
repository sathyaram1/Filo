// Verifica #2692, giro 1: il PIN dato in risposta in chat deve sparire nei casi in cui sparisce la password.
// Ogni caso ha la sua coppia con la password, che su main e sul ramo diventa già il segnaposto.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../../src/shared/pavimento.js');

const casi = [
  ['un altro del gruppo scrive in mezzo',
    'Marco: mi mandi la password?\nAnna: anche io la voglio\nLuc: Gatto2024',
    'Marco: qual è il pin della carta?\nAnna: anche io lo voglio\nLuc: 4821', '4821'],
  ['chi risponde scrive prima un attimo',
    'Marco: mi mandi la password?\nLuc: aspetta che controllo\nLuc: Gatto2024',
    'Marco: qual è il pin della carta?\nLuc: aspetta che controllo\nLuc: 4821', '4821'],
  ['chi risponde saluta in un messaggio a parte',
    'Marco: mi mandi la password?\nLuc: ciao\nLuc: Gatto2024',
    'Marco: qual è il pin della carta?\nLuc: ciao\nLuc: 4821', '4821'],
  ['la risposta presenta il dato con parole sue',
    'Marco: mi mandi la password?\nLuc: te lo scrivo qui: Gatto2024',
    'Marco: qual è il pin della carta?\nLuc: te lo scrivo qui: 4821', '4821'],
  ['conversazione copiata da Telegram',
    'Marco, [26.11.26 15:42]\nmi mandi la password?\n\nLuc, [26.11.26 15:43]\nGatto2024',
    'Marco, [26.11.26 15:42]\nqual è il pin della carta?\n\nLuc, [26.11.26 15:43]\n4821', '4821'],
  ['saluto col nome prima del numero',
    'Marco: mi mandi la password?\nLuc: ciao Marco! Gatto2024',
    'Marco: qual è il pin della carta?\nLuc: ciao Marco! 4821', '4821'],
  ['la domanda copiata senza il nome di chi la fa',
    'mi mandi la password?\nLuc: Gatto2024',
    'qual è il pin?\nLuc: 4821', '4821'],
];

for (const [nome, password, pin, valore] of casi) {
  test(`r1 ${nome}`, () => {
    expect(P.oscura(password), 'la coppia con la password').not.toContain('Gatto2024');
    const fuori = P.oscura(pin);
    expect(fuori).not.toContain(valore);
    expect(fuori).toContain(P.SEGNAPOSTO);
  });
}
