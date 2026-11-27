// Verifica #2695.1 giro 1: il nome di un campo senza i due punti toglie la cella dopo solo in una riga di due celle;
// con una terza cella (una nota, una cella vuota) o col nome in seconda colonna il valore arriva ai due cancelli.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('r1 il nome di un campo senza i due punti toglie la cella dopo anche in una riga con più di due celle', () => {
  // Una tabella che descrive i campi resta intera: il tipo nella cella dopo non è un valore.
  const schema = '| Campo | Tipo | Descrizione |\n|---|---|---|\n| login_password | string | La password di accesso |';
  expect(P.oscura(schema)).toBe(schema);
  const scappano = [];
  for (const [riga, v] of [
    ['| login_password | Nyckel!2024 | account di prova |', 'Nyckel!2024'],
    ['| login_password | Nyckel!2024 |  |', 'Nyckel!2024'],
    ['| api_key | sk-abc123def456ghi | produzione |', 'sk-abc123def456ghi'],
    ['| Gmail | login_password | Nyckel!2024 |', 'Nyckel!2024'],
  ]) {
    if (P.oscura(riga).includes(v)) scappano.push(`modelli: ${riga}`);
    if (alCorrettore(riga).includes(v)) scappano.push(`correttore: ${riga}`);
  }
  expect(scappano).toEqual([]);
});
