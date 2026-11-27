// #1403.89 giro 2: la riga di novità promette il codice del cancello, che detto col «mio» esce da un'azione senza chiedere.
import { test, expect } from '@playwright/test';
import { segretoCercando, righeNovita } from './aiuto-uscita.mjs';

test('r2 quello che la novità promette sul cancello vale anche per «il mio cancello»', () => {
  const promesse = righeNovita(1403).filter((t) => /cancell/i.test(t) && /azion/i.test(t));
  for (const testo of ['Il codice del mio cancello è 4829', 'Il codice del cancello di casa mia è 4829']) {
    if (promesse.length) expect(segretoCercando(testo), `«${testo}» esce, e la novità dice di no`).not.toBe('');
  }
});
