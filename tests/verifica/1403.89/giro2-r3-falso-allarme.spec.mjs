// #1403.89 giro 2: una ricerca innocua con un anno accanto a «codice sblocco telefono» viene presa per un segreto.
import { test, expect } from '@playwright/test';
import { segretoCercando } from './aiuto-uscita.mjs';

for (const testo of ['codice sblocco telefono 2025 tutorial', 'codice del mio telefono 2024 offerta']) {
  test(`r3 ${testo}`, () => {
    expect(segretoCercando(testo), `«${testo}» chiede conferma senza un segreto`).toBe('');
  });
}
