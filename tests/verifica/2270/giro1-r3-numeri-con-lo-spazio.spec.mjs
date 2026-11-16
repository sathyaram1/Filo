// #2270 giro 1, rilievo 3: `pacchetto 812, 815` (spazio dopo la virgola) è la forma nuova scritta in modo naturale, ma
// parte come la forma vecchia e il server risponde «il pacchetto su un feedback esistente non c'è più».
import { test, expect } from '@playwright/test';
import { datiDelPacchetto } from '../../../scripts/manutentore.mjs';

test('r3 i numeri separati da virgola e spazio sono un pacchetto nuovo', () => {
  for (const args of [['812,', '815'], ['812,', '815,', '816']]) {
    const d = datiDelPacchetto(args);
    expect(d.numero, args.join(' ')).toBeUndefined();
    expect(d.unisce.map(String), args.join(' ')).toEqual(args.map((a) => a.replace(',', '')));
  }
});
