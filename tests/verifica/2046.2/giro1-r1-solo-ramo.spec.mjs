// #2046.2 giro 1 — un originale chiuso prima che il server registrasse la fusione: il rifiuto del doppione nomina solo
// il suo ramo, e le istruzioni della routine devono dire di cercare la fusione di quel ramo e riconsegnare.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const radice = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const frasi = (f) => fs.readFileSync(path.join(radice, 'routines', 'roles', f), 'utf8').replace(/\s+/g, ' ').split(/(?<=[.;])\s/);

for (const ruolo of ['resolver.md', 'resolver-ripresa.md']) {
  test(`r1 ${ruolo}: un rifiuto del doppione che nomina solo il ramo dell'originale porta a una riconsegna`, () => {
    const regola = frasi(ruolo).filter((s) => /riconsegna/.test(s) && /\bramo\b/.test(s));
    expect(regola, 'una frase che dica cosa fare quando il rifiuto nomina il ramo dell\'originale').not.toEqual([]);
  });
}
