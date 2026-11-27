// #2695.2 giro 1 — il nome della password davanti a un'altra parola vale come dietro anche come colonna di un CSV (r1),
// e una parola che descrive la password («password_encryption», «password_forgotten») non fa sparire il valore (r2).
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.self = globalThis;
require('../../../src/shared/guardianoStatico.js');
require('../../../src/shared/urlExfil.js');
const P = require('../../../src/shared/pavimento.js');
const R = require('../../../src/main/services/correttoreRiservati.js');
const alCorrettore = (campo) => R.richiestaSenzaRiservati({ prima: '', nuovo: campo, dopo: '', campo, campoDa: 0 }).nuovo;

test('r1 nella colonna di un CSV il nome della password davanti a un\'altra parola toglie il valore come dietro', () => {
  for (const nome of ['password_login', 'password_db', 'PASSWORD_DB', 'pwd_login', 'passwordLogin']) {
    const csv = `url,username,${nome}\nhttps://x.example,mario,Nyckel!2024\nhttps://y.example,luca,Girasole2024`;
    for (const fuori of [P.oscura(csv), alCorrettore(csv)]) {
      expect(fuori, csv).not.toContain('Nyckel!2024');
      expect(fuori, csv).not.toContain('Girasole2024');
    }
  }
});

test('r2 un\'impostazione che descrive la password arriva intera al modello, come su main', () => {
  for (const riga of [
    'password_encryption = scram-sha-256', 'password_storage: database', 'password_backend: ldap', 'password_scheme: SSHA',
    'password_digest: sha256', 'password_store: keychain', 'password_provider: ldap', 'password_sync: yes',
    'password_autocomplete: off', 'password_reuse_time: 365', 'password_forgotten: Hai dimenticato la password?',
  ]) {
    expect(P.oscura(riga), riga).toBe(riga);
  }
  // Il valore vero sotto lo stesso tipo di nome resta tolto.
  expect(P.oscura('password_login: Nyckel!2024')).not.toContain('Nyckel!2024');
});
