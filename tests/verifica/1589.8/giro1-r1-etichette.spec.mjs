// #1589.8 giro 1, rilievo 1 — le password e i codici annunciati da un'etichetta li riconoscono ancora due elenchi: quello
// del pavimento e quello del correttore. Lo stesso testo deve uscire uguale dalle due pulizie.

import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/constants.js');
require('../../../src/shared/urlExfil.js');
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/riservatiNelTesto.js');
require('../../../src/shared/pavimento.js');
const Correttore = require('../../../src/main/services/correttoreRiservati.js');

const CASI = [
  'Passwort: Sonne2024',
  'mot de passe: Soleil2024',
  'contraseña: Sol2024!',
  'hasło: Slonce2024',
  'pass: Xy7!kq99',
  'Password\nhunter2',
  'DB_PASSWORD=hunter2xx',
  'secret: abcdEFGH1234ijkl',
  'cvv 123',
];

test('r1 un dato annunciato da un\'etichetta sparisce uguale dal campo del correttore e dalla pagina spiegata', () => {
  const P = globalThis.SN_PAVIMENTO;
  for (const t of CASI) {
    expect(P.oscura(t), `il pavimento: ${t}`).toContain('[dato riservato]');
    expect(Correttore.oscura(t), `il correttore: ${t}`).toBe(P.oscura(t));
  }
});
