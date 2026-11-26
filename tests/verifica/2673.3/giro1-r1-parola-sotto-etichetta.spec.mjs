// Verifica #2673.3, giro 1: sotto un'etichetta preceduta da altre parole il valore vale quanto sotto «Password:» da sola.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const P = require(join(resolve(process.cwd()), 'src', 'shared', 'pavimento.js'));

test('r1 una parola o un valore con una nota, sotto «Wi-Fi password:», non arriva al modello', () => {
  for (const [t, segreto] of [
    ['Password:\ntramontoblu\nSSID: Casa', 'tramontoblu'],
    ['Wi-Fi password:\ntramontoblu\nSSID: Casa', 'tramontoblu'],
    ['My password:\ntramontoblu', 'tramontoblu'],
    ['Wi-Fi password\ntramontoblu', 'tramontoblu'],
    ['Password:\nNyckel!2024 (5GHz)', 'Nyckel!2024'],
    ['Wi-Fi password:\nNyckel!2024 (5GHz)', 'Nyckel!2024'],
  ]) expect(P.oscura(t), t).not.toContain(segreto);
  for (const t of ['Wi-Fi password:\nchiedi al bancone', 'Il campo Wi-Fi password:\nObbligatorio']) {
    expect(P.oscura(t)).toBe(t);
  }
});
