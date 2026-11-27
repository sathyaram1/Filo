// Verifica #2695.4, giro 2: la password detta nella frase dopo la virgola non arriva ai modelli anche con un verbo di
// supposizione o di cambio, con «e» al posto di «è» e in un elenco; le parole del discorso dopo la virgola restano intere.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
for (const m of ['guardianoStatico', 'urlExfil', 'riservatiNelTesto', 'pavimento']) require(`../../../src/shared/${m}.js`);
const P = globalThis.SN_PAVIMENTO;
const C = require('../../../src/main/services/correttoreRiservati.js');

for (const t of [
  'la password è sbagliata, forse è gattonero',
  'la password è sbagliata, credo sia gattonero',
  'la password è sbagliata, dovrebbe essere gattonero',
  'la password è sbagliata, devi mettere gattonero',
  'la password è sbagliata, prova a mettere gattonero',
  'la password scade, la cambio in gattonero',
  'la password scade, la metto gattonero',
  'the password is wrong, it should be gattonero',
  "the password is outdated, it's gattonero now",
  'la password scade, la nuova e gattonero',
  'la password è sbagliata, quella giusta e gattonero',
]) {
  test(`r1 «${t}»: «gattonero» non arriva al correttore`, () => {
    expect(C.oscura(t)).not.toContain('gattonero');
  });
}

for (const t of [
  'la password è sbagliata, prova gattonero, micio77 o topo99',
  'la password è sbagliata, prova gattonero, micio77',
]) {
  test(`r2 «${t}»: le password dell'elenco non arrivano a nessuno dei due cancelli`, () => {
    for (const o of [P.oscura(t), C.oscura(t)]) expect(o).not.toMatch(/micio77|topo99/);
  });
}

for (const [t, parola] of [
  ['password scaduta, nuova procedura', 'procedura'],
  ['password cambiata, nuova pagina', 'pagina'],
  ['password changed, now login', 'login'],
  ['the password expired, use yours', 'yours'],
]) {
  test(`r3 «${t}»: «${parola}» arriva intera al correttore`, () => {
    expect(C.oscura(t)).toBe(t);
  });
}
