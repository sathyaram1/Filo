// Verifica #2190, giro 1: la prova del giro sul server di un rilievo che esce in ogni esito la ferma la registrazione, come quella dell'app.

import { test, expect } from '@playwright/test';
import { proveDaToglierePrimaDelVerdetto } from '../../../scripts/lib/prove-tolte.mjs';

const APP = 'tests/verifica/2190/giro1-r1-x.spec.mjs';
const SERVER = 'functions/test/verifica-2190-giro1-r1-x.test.js';
const ESTERNO = [{ level: 1, sede: 'e', decision: false }];

test('r1 una prova del server di un rilievo esterno, rimasta sul ramo, si vede prima del verdetto come quella dell\'app', () => {
  expect(proveDaToglierePrimaDelVerdetto([APP], ESTERNO).map((f) => f.prova)).toEqual([APP]);
  expect(proveDaToglierePrimaDelVerdetto([SERVER], ESTERNO).map((f) => f.prova)).toEqual([SERVER]);
});
