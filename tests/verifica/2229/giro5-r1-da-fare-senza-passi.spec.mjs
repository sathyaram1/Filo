// Giro 5 di #2229: un «da fare» senza i passi da fare (solo il titolo) non deve nascere.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SHARED = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'shared');
require(resolve(SHARED, 'feedbackAttese.js'));
require(resolve(SHARED, 'domande.js'));
const D = globalThis.SN_DOMANDE;

const base = { titolo: 'Rinnova il token di GitHub', priorita: 'importante', tipo: 'da_fare', opzioni: [{ testo: 'Fatto', azione: { tipo: 'nessuna' } }] };

test('r1 un «da fare» senza «Cosa fare» è rifiutato col campo, come le altre regole della forma', () => {
  for (const problema of [undefined, '', '   \n ']) {
    const r = D.validaDomanda(problema === undefined ? base : { ...base, problema }, { conOrigine: false });
    expect(r.ok, `problema ${JSON.stringify(problema)}`).toBe(false);
    expect(r.campo).toBe('problema');
  }
  expect(D.validaDomanda({ ...base, problema: 'Dalle impostazioni di GitHub rigenera il token.' }, { conOrigine: false }).ok).toBe(true);
});
